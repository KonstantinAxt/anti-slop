import { createHash } from "node:crypto";
import * as ts from "typescript";
import { createSourceFile } from "../checks/ast.js";
import { parseDiffLineNumbers } from "../git.js";

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
The change summary states intent; only the numbered file is evidence for a finding.

## Evaluation Rubric: unnecessary_under_invariant
Code that existing invariants make unnecessary (defensive checks, redundant guards, fast paths, null/undefined checks, copies, or fallbacks that types, call sites, or earlier guards rule out).
Candidates: Consider ONLY lines marked + in the numbered view as candidate findings. Unmarked lines are context. A removed line is not part of the new file and has no line number. The view may omit unchanged lines and entire declarations. Treat each omission marker as missing evidence. If an invariant could be in omitted lines, return NEEDS_HUMAN_ATTENTION rather than guessing.
Boundaries:
1. Positive Boundary (FLAG): Invariant ruling out added code is visible in the numbered view.
2. Benign Lookalike Boundary (ALLOW): Defensive checks at real trust boundaries (parsed user input, unknown/any data, untyped JS).
3. Insufficient Context Boundary (NEEDS_HUMAN_ATTENTION): Invariant lives only outside the numbered view, including omitted lines. Do not guess.

## Output Requirements
Respond with valid JSON:
- Top-level keys: "verdict" ("FLAG" | "ALLOW" | "NEEDS_HUMAN_ATTENTION"), "findings" (array), optional "notes" (string). No other keys.
- Each finding has exactly these keys: "file" (a path from the numbered file), "line_range" ({"start": integer, "end": integer}, 1-based line numbers from the left column of the numbered file, start <= end), "problem_category" ("unnecessary_under_invariant"), "reason" (10 to 1000 characters naming the invariant and where it is visible), "confidence" (number from 0 to 1), optional "suggested_fix" (string). No other keys.
- If verdict is "FLAG", findings must NOT be empty. If verdict is "ALLOW" or "NEEDS_HUMAN_ATTENTION", findings MUST be empty [].
- Output ONLY the JSON object, optionally wrapped in a single \`\`\`json fenced block.`;

const USER_TEMPLATE = `{{SUMMARY_BLOCK}}Please review the numbered file below. The left column gives line numbers in the new file. A + marker identifies an added line. A - marker identifies a removed line, which has no line number.

{{FILES}}`;


function numberedFile(file: { path: string; content: string }, addedLines: Set<number> | undefined, removedLines: Map<number, string[]> | undefined, includedLines?: Set<number>): string {
  const lines = file.content === "" ? [] : file.content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const width = String(Math.max(lines.length, 1)).length;
  const numbered = [`<file path="${file.path}">`];
  let omittedStart = 0;

  for (let line = 1; line <= lines.length; line++) {
    if (includedLines !== undefined && !includedLines.has(line)) {
      omittedStart ||= line;
      continue;
    }
    if (omittedStart !== 0) {
      numbered.push(`... lines ${omittedStart}-${line - 1} unchanged, omitted`);
      omittedStart = 0;
    }
    if (removedLines !== undefined) {
      const removedAtLine = removedLines.get(line);
      if (removedAtLine !== undefined) {
        for (const removed of removedAtLine) numbered.push(`\t${" ".repeat(width)} - | ${removed}`);
      }
    }
    const marker = addedLines?.has(line) ? "+" : " ";
    numbered.push(`\t${String(line).padStart(width)} ${marker} | ${lines[line - 1]}`);
  }

  if (omittedStart !== 0) numbered.push(`... lines ${omittedStart}-${lines.length} unchanged, omitted`);
  if (removedLines !== undefined) {
    for (const [position, removedAtLine] of removedLines) {
      if (position <= lines.length) continue;
      for (const removed of removedAtLine) numbered.push(`\t${" ".repeat(width)} - | ${removed}`);
    }
  }

  numbered.push("</file>");
  return numbered.join("\n");
}

function declarationWindowLines(file: { path: string; content: string }, addedLines: Set<number> | undefined, removedLines: Map<number, string[]> | undefined): Set<number> {
  const sourceFile = createSourceFile(file.path, file.content);
  const included = new Set<number>();
  const changed = new Set(addedLines ?? []);
  for (const line of removedLines?.keys() ?? []) changed.add(line);
  let outsideDeclaration = false;

  for (const statement of sourceFile.statements) {
    const required = ts.isImportDeclaration(statement)
      || ts.isImportEqualsDeclaration(statement)
      || ts.isExportDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement);
    const start = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
    const end = sourceFile.getLineAndCharacterOfPosition(statement.getEnd()).line + 1;
    let containsChange = false;
    for (const line of changed) {
      if (line < start || line > end) continue;
      containsChange = true;
      break;
    }
    if (required || containsChange) {
      for (let line = start; line <= end; line++) included.add(line);
    }
  }

  for (const line of changed) {
    const inDeclaration = sourceFile.statements.some((statement) => {
      const start = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
      const end = sourceFile.getLineAndCharacterOfPosition(statement.getEnd()).line + 1;
      return line >= start && line <= end;
    });
    if (inDeclaration) continue;
    outsideDeclaration = true;
    break;
  }
  if (outsideDeclaration) {
    for (let line = 1; line <= sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1; line++) included.add(line);
  }
  return included;
}

function formatPrompt(diff: string, files: { path: string; content: string }[], summary: string | undefined, window: boolean): string {
  const lineNumbers = parseDiffLineNumbers(diff);
  const formatted = files.map((file) => {
    const added = lineNumbers.added.get(file.path) ?? lineNumbers.added.get(file.path.replace(/^src\//, "")) ?? lineNumbers.added.get("");
    const removed = lineNumbers.removed.get(file.path) ?? lineNumbers.removed.get(file.path.replace(/^src\//, ""));
    const included = window && /\.tsx?$/.test(file.path) ? declarationWindowLines(file, added, removed) : undefined;
    return numberedFile(file, added, removed, included);
  }).join("\n\n");
  const summaryBlock = summary === undefined ? "" : `<change_summary>\n${summary}\n</change_summary>\n\n`;
  return USER_TEMPLATE.replace("{{SUMMARY_BLOCK}}", () => summaryBlock).replace("{{FILES}}", () => formatted);
}

export function buildDeclarationWindowPrompt(diff: string, files: { path: string; content: string }[], summary?: string): string {
  return formatPrompt(diff, files, summary, true);
}

export function buildUserPrompt(diff: string, files: { path: string; content: string }[], summary?: string): string {
  return formatPrompt(diff, files, summary, false);
}

function sha256(str: string): string {
  return createHash("sha256").update(str, "utf8").digest("hex");
}

export const SYSTEM_PROMPT_SHA256 = sha256(SYSTEM_PROMPT);
export const USER_TEMPLATE_SHA256 = sha256(USER_TEMPLATE);
export const SCHEMA_SHA256 = sha256(JSON.stringify(JUDGE_SCHEMA));
