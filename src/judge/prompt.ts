import { createHash } from "node:crypto";

export const JUDGE_SCHEMA_VERSION = "2026-10-01";

const JUDGE_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "AntiSlopJudgeOutput",
  type: "object",
  additionalProperties: false,
  required: ["verdict", "findings"],
  properties: {
    verdict: {
      type: "string",
      enum: ["FLAG", "ALLOW", "NEEDS_HUMAN_ATTENTION"],
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "line_range", "problem_category", "reason", "confidence"],
        properties: {
          file: { type: "string" },
          line_range: {
            type: "object",
            additionalProperties: false,
            required: ["start", "end"],
            properties: {
              start: { type: "integer", minimum: 1 },
              end: { type: "integer", minimum: 1 },
            },
          },
          problem_category: {
            type: "string",
            enum: ["unnecessary_under_invariant"],
          },
          reason: {
            type: "string",
            minLength: 10,
            maxLength: 1000,
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
          suggested_fix: {
            type: "string",
          },
        },
      },
    },
    notes: {
      type: "string",
    },
  },
} as const;

const JUDGE_SCHEMA_STRING = JSON.stringify(JUDGE_JSON_SCHEMA);

export const SYSTEM_PROMPT = `You are an expert code review semantic judge in the anti-slop review gate.
Your task is to review added code changes for a single semantic defect category: "unnecessary_under_invariant".

## Evaluation Rubric: unnecessary_under_invariant
Code that existing invariants make unnecessary. This includes defensive checks, redundant guards, fast paths, null/undefined checks, copies, or fallbacks that types, call sites, or earlier guards already rule out.

Candidates:
- Consider ONLY newly added lines in the diff as candidate findings. Existing unchanged code is context.

Boundaries:
1. Positive Boundary (FLAG):
   - An invariant ruling out the added code is visible in the diff or in the provided file contents.
   - Examples: A TypeScript non-null type signature already guarantees presence; a preceding guard or validation in the same function already handled the case; a private helper whose only caller already guarantees non-empty values.
   - If confirmed, verdict is "FLAG" and findings array lists the defect(s).

2. Benign Lookalike Boundary (ALLOW):
   - A defensive check occurs at a real trust boundary.
   - Examples: Parsing external or untrusted user input, deserializing unknown JSON, data typed as unknown or any, untyped JavaScript boundaries, or external library data at a public API boundary.
   - If all added lines are necessary or benign lookalikes, verdict is "ALLOW" with findings: [].

3. Insufficient Context Boundary (NEEDS_HUMAN_ATTENTION):
   - The code appears possibly redundant, but the invariant that would make it unnecessary would live only outside the provided files (e.g. caller in another unprovided file, remote API guarantees).
   - Do not guess or assume unobserved code.
   - If context is insufficient to prove the invariant, verdict is "NEEDS_HUMAN_ATTENTION" with findings: [].

## Output Requirements
You must respond with valid JSON adhering strictly to the following schema:
- Top-level keys: "verdict" ("FLAG" | "ALLOW" | "NEEDS_HUMAN_ATTENTION"), "findings" (array), and optional "notes" (string). No other keys are allowed.
- Each finding object must contain:
  - "file": path of the file matching one of the provided files.
  - "line_range": {"start": number, "end": number} where start <= end, within the candidate file.
  - "problem_category": exactly "unnecessary_under_invariant".
  - "reason": concise explanation between 10 and 1000 characters.
  - "confidence": number between 0.0 and 1.0.
  - "suggested_fix": optional string with recommended fix.
- If verdict is "FLAG", findings must NOT be empty.
- If verdict is "ALLOW" or "NEEDS_HUMAN_ATTENTION", findings MUST be empty [].
- Output ONLY the JSON object, optionally wrapped in a single \`\`\`json fenced block. No other prose.`;

const USER_TEMPLATE = `Please review the following git diff and associated files.

<git_diff>
{{DIFF}}
</git_diff>

<files>
{{FILES}}
</files>`;

function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export const SYSTEM_PROMPT_SHA256 = computeSha256(SYSTEM_PROMPT);
export const USER_TEMPLATE_SHA256 = computeSha256(USER_TEMPLATE);
export const SCHEMA_SHA256 = computeSha256(JUDGE_SCHEMA_STRING);

export function buildUserPrompt(diff: string, files: { path: string; content: string }[]): string {
  const formattedFiles = files
    .map((file) => `--- File: ${file.path} ---\n${file.content}`)
    .join("\n\n");

  return USER_TEMPLATE
    .replace("{{DIFF}}", diff)
    .replace("{{FILES}}", formattedFiles);
}
