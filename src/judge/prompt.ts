import { createHash } from "node:crypto";

export const JUDGE_SCHEMA_VERSION = "2026-10-01";

const JUDGE_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "AntiSlopJudgeOutput",
  type: "object",
  additionalProperties: false,
  required: ["verdict", "findings"],
  properties: {
    verdict: { type: "string", enum: ["FLAG", "ALLOW", "NEEDS_HUMAN_ATTENTION"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "line_range", "problem_category", "reason", "confidence"],
        properties: {
          file: { type: "string" },
          line_range: { type: "object", additionalProperties: false, required: ["start", "end"], properties: { start: { type: "integer", minimum: 1 }, end: { type: "integer", minimum: 1 } } },
          problem_category: { type: "string", enum: ["unnecessary_under_invariant"] },
          reason: { type: "string", minLength: 10, maxLength: 1000 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          suggested_fix: { type: "string" },
        },
      },
    },
    notes: { type: "string" },
  },
} as const;

export const SYSTEM_PROMPT = `You are an expert code review semantic judge in the anti-slop review gate.
Your task is to review added code changes for a single semantic defect category: "unnecessary_under_invariant".

## Evaluation Rubric: unnecessary_under_invariant
Code that existing invariants make unnecessary (defensive checks, redundant guards, fast paths, null/undefined checks, copies, or fallbacks that types, call sites, or earlier guards rule out).
Candidates: Consider ONLY newly added lines in the diff as candidate findings. Existing unchanged code is context.
Boundaries:
1. Positive Boundary (FLAG): Invariant ruling out added code is visible in diff or provided files.
2. Benign Lookalike Boundary (ALLOW): Defensive checks at real trust boundaries (parsed user input, unknown/any data, untyped JS).
3. Insufficient Context Boundary (NEEDS_HUMAN_ATTENTION): Invariant lives only outside provided files. Do not guess.

## Output Requirements
Respond with valid JSON:
- Top-level keys: "verdict" ("FLAG" | "ALLOW" | "NEEDS_HUMAN_ATTENTION"), "findings" (array), optional "notes" (string). No other keys.
- Each finding has exactly these keys: "file" (a path from the provided files), "line_range" ({"start": integer, "end": integer}, 1-based line numbers in that file, start <= end), "problem_category" ("unnecessary_under_invariant"), "reason" (10 to 1000 characters naming the invariant and where it is visible), "confidence" (number from 0 to 1), optional "suggested_fix" (string). No other keys.
- If verdict is "FLAG", findings must NOT be empty. If verdict is "ALLOW" or "NEEDS_HUMAN_ATTENTION", findings MUST be empty [].
- Output ONLY the JSON object, optionally wrapped in a single \`\`\`json fenced block.`;

const USER_TEMPLATE = `Please review the following git diff and associated files.\n\n<git_diff>\n{{DIFF}}\n</git_diff>\n\n<files>\n{{FILES}}\n</files>`;

function sha256(str: string): string {
  return createHash("sha256").update(str, "utf8").digest("hex");
}

export const SYSTEM_PROMPT_SHA256 = sha256(SYSTEM_PROMPT);
export const USER_TEMPLATE_SHA256 = sha256(USER_TEMPLATE);
export const SCHEMA_SHA256 = sha256(JSON.stringify(JUDGE_SCHEMA));

export function buildUserPrompt(diff: string, files: { path: string; content: string }[]): string {
  const formatted = files.map((file) => `--- File: ${file.path} ---\n${file.content}`).join("\n\n");

  return USER_TEMPLATE.replace("{{DIFF}}", diff).replace("{{FILES}}", formatted);
}
