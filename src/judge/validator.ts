import type { JudgeFinding } from "./types.js";

const MIN_REASON_LEN = 10;
const MAX_REASON_LEN = 1000;
const CODE_FENCE_TRIM = 3;
const ROOT_KEYS: Record<string, true> = { verdict: true, findings: true, notes: true };
const ITEM_KEYS: Record<string, true> = { file: true, line_range: true, problem_category: true, reason: true, confidence: true, suggested_fix: true };
const RANGE_KEYS: Record<string, true> = { start: true, end: true };

export interface ValidatedJudgeOutput {
  verdict: "FLAG" | "ALLOW" | "NEEDS_HUMAN_ATTENTION";
  findings: JudgeFinding[];
  notes?: string;
}

export type ValidationResult = { ok: true; data: ValidatedJudgeOutput } | { ok: false; error: string };

function parseJson(raw: string): { ok: true; val: Record<string, unknown> } | { ok: false; error: string } {
  let text = raw.trim();

  if (text.startsWith("```") && text.endsWith("```")) {
    const inner = text.slice(CODE_FENCE_TRIM, -CODE_FENCE_TRIM);

    if (inner.includes("```")) return { ok: false, error: "Multiple fences" };
    text = inner.replace(/^[a-zA-Z0-9_-]*\s*\n?/, "").trim();
  }

  if (!text.startsWith("{") || !text.endsWith("}")) return { ok: false, error: "Not JSON" };

  try {
    const parsed: unknown = JSON.parse(text);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, error: "Not object" };

    for (const key of Object.keys(parsed)) if (!ROOT_KEYS[key]) return { ok: false, error: `Extra root key: ${key}` };

    if (!("verdict" in parsed) || !("findings" in parsed)) return { ok: false, error: "Missing keys" };

    const val: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(parsed)) val[key] = value;

    return { ok: true, val };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function parseFindingRange(range: unknown, lineCount: number): { ok: true; start: number; end: number } | { ok: false; error: string } {
  if (typeof range !== "object" || range === null || Array.isArray(range)) return { ok: false, error: "Bad range" };

  for (const key of Object.keys(range)) if (!RANGE_KEYS[key]) return { ok: false, error: `Extra range key: ${key}` };

  if (!("start" in range) || !("end" in range)) return { ok: false, error: "Range missing start/end" };
  const start = range.start;
  const end = range.end;

  if (typeof start !== "number" || !Number.isInteger(start) || start < 1 || typeof end !== "number" || !Number.isInteger(end) || end < 1) {
    return { ok: false, error: "Invalid start/end" };
  }

  if (start > end) return { ok: false, error: "start > end" };
  if (start > lineCount || end > lineCount) return { ok: false, error: "Lines outside file" };

  return { ok: true, start, end };
}

function parseFindingTextAndConfidence(
  obj: object
): { ok: true; reason: string; confidence: number; fix?: string } | { ok: false; error: string } {
  if (!("reason" in obj) || typeof obj.reason !== "string" || obj.reason.length < MIN_REASON_LEN || obj.reason.length > MAX_REASON_LEN) {
    return { ok: false, error: "Bad reason" };
  }

  if (!("confidence" in obj) || typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) {
    return { ok: false, error: "Bad confidence" };
  }

  const fix = "suggested_fix" in obj && typeof obj.suggested_fix === "string" ? obj.suggested_fix : undefined;

  return { ok: true, reason: obj.reason, confidence: obj.confidence, ...(fix ? { fix } : {}) };
}

function parseFinding(obj: unknown, fileLineCounts: Map<string, number>): { ok: true; finding: JudgeFinding } | { ok: false; error: string } {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return { ok: false, error: "Bad finding" };

  for (const key of Object.keys(obj)) if (!ITEM_KEYS[key]) return { ok: false, error: `Extra key: ${key}` };

  if (!("file" in obj) || typeof obj.file !== "string") return { ok: false, error: "Bad file" };
  const lineCount = fileLineCounts.get(obj.file);

  if (lineCount === undefined) return { ok: false, error: `Unknown file: ${obj.file}` };
  if (!("line_range" in obj)) return { ok: false, error: "Missing line_range" };

  const range = parseFindingRange(obj.line_range, lineCount);

  if (!range.ok) return range;

  if (!("problem_category" in obj) || obj.problem_category !== "unnecessary_under_invariant") return { ok: false, error: "Bad category" };
  const tc = parseFindingTextAndConfidence(obj);

  if (!tc.ok) return tc;

  return { ok: true, finding: { file: obj.file, line_range: { start: range.start, end: range.end }, problem_category: "unnecessary_under_invariant", reason: tc.reason, confidence: tc.confidence, ...(tc.fix ? { suggested_fix: tc.fix } : {}) } };
}

export function validateJudgeOutput(raw: string, sentFiles: { path: string; content: string }[]): ValidationResult {
  const parsed = parseJson(raw);

  if (!parsed.ok) return parsed;
  const { val } = parsed;
  const verdict = val["verdict"];

  if (verdict !== "FLAG" && verdict !== "ALLOW" && verdict !== "NEEDS_HUMAN_ATTENTION") return { ok: false, error: `Bad verdict: ${String(verdict)}` };

  const list = val["findings"];

  if (!Array.isArray(list)) return { ok: false, error: "findings not array" };
  if (verdict === "FLAG" && list.length === 0) return { ok: false, error: "FLAG needs findings" };
  if ((verdict === "ALLOW" || verdict === "NEEDS_HUMAN_ATTENTION") && list.length > 0) return { ok: false, error: `${verdict} requires empty findings` };

  const fileLineCounts = new Map<string, number>();

  for (const file of sentFiles) {
    const lineCount = file.content.length === 0 ? 0 : file.content.split("\n").length;
    fileLineCounts.set(file.path, lineCount);
  }

  const findings: JudgeFinding[] = [];

  for (const item of list) {
    const res = parseFinding(item, fileLineCounts);

    if (!res.ok) return res;
    findings.push(res.finding);
  }

  const out: ValidatedJudgeOutput = { verdict, findings };

  if (typeof val["notes"] === "string") out.notes = val["notes"];

  return { ok: true, data: out };
}
