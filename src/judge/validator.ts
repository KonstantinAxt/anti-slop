import type { JudgeFinding } from "./types.js";

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 1000;
const MIN_CONFIDENCE = 0;
const MAX_CONFIDENCE = 1;
const CODE_FENCE_TRIM_LENGTH = 3;

const TOP_LEVEL_ALLOWED_KEYS: Record<string, true> = {
  verdict: true,
  findings: true,
  notes: true,
};

const FINDING_ALLOWED_KEYS: Record<string, true> = {
  file: true,
  line_range: true,
  problem_category: true,
  reason: true,
  confidence: true,
  suggested_fix: true,
};

const LINE_RANGE_ALLOWED_KEYS: Record<string, true> = {
  start: true,
  end: true,
};

export interface ValidatedJudgeOutput {
  verdict: "FLAG" | "ALLOW" | "NEEDS_HUMAN_ATTENTION";
  findings: JudgeFinding[];
  notes?: string;
}

export interface ValidationSuccess {
  ok: true;
  data: ValidatedJudgeOutput;
}

export interface ValidationFailure {
  ok: false;
  error: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

function extractJsonText(rawText: string): string | null {
  const trimmed = rawText.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    const innerContent = trimmed.slice(CODE_FENCE_TRIM_LENGTH, -CODE_FENCE_TRIM_LENGTH);

    if (innerContent.includes("```")) {
      return null;
    }

    const withoutLanguageTag = innerContent.replace(/^[a-zA-Z0-9_-]*\s*\n?/, "").trim();

    if (withoutLanguageTag.startsWith("{") && withoutLanguageTag.endsWith("}")) {
      return withoutLanguageTag;
    }
  }

  return null;
}

function validateLineRange(
  range: unknown,
  lineCount: number
): { ok: true; start: number; end: number } | { ok: false; error: string } {
  if (typeof range !== "object" || range === null || Array.isArray(range)) {
    return { ok: false, error: "line_range must be an object" };
  }

  const keys = Object.keys(range);

  for (const key of keys) {
    if (!LINE_RANGE_ALLOWED_KEYS[key]) {
      return { ok: false, error: `Extra key in line_range: ${key}` };
    }
  }

  if (!("start" in range) || !("end" in range)) {
    return { ok: false, error: "line_range missing start or end" };
  }

  const start = range.start;
  const end = range.end;

  if (typeof start !== "number" || !Number.isInteger(start) || start < 1) {
    return { ok: false, error: "line_range.start must be an integer >= 1" };
  }

  if (typeof end !== "number" || !Number.isInteger(end) || end < 1) {
    return { ok: false, error: "line_range.end must be an integer >= 1" };
  }

  if (start > end) {
    return { ok: false, error: "line_range start must be <= end" };
  }

  if (start > lineCount || end > lineCount) {
    return { ok: false, error: "line_range outside file bounds" };
  }

  return { ok: true, start, end };
}

function validateFinding(
  finding: unknown,
  fileLineCounts: Map<string, number>
): { ok: true; finding: JudgeFinding } | { ok: false; error: string } {
  if (typeof finding !== "object" || finding === null || Array.isArray(finding)) {
    return { ok: false, error: "finding must be an object" };
  }

  const keys = Object.keys(finding);

  for (const key of keys) {
    if (!FINDING_ALLOWED_KEYS[key]) {
      return { ok: false, error: `Extra key in finding: ${key}` };
    }
  }

  if (!("file" in finding) || typeof finding.file !== "string") {
    return { ok: false, error: "finding.file must be a string" };
  }

  const filePath = finding.file;
  const lineCount = fileLineCounts.get(filePath);

  if (lineCount === undefined) {
    return { ok: false, error: `finding.file not among sent files: ${filePath}` };
  }

  if (!("line_range" in finding)) {
    return { ok: false, error: "finding missing line_range" };
  }

  const rangeValidation = validateLineRange(finding.line_range, lineCount);

  if (!rangeValidation.ok) {
    return rangeValidation;
  }

  return validateFindingPayload(finding, filePath, rangeValidation);
}

function validateFindingPayload(
  finding: object,
  filePath: string,
  rangeValidation: { start: number; end: number }
): { ok: true; finding: JudgeFinding } | { ok: false; error: string } {
  if (
    !("problem_category" in finding) ||
    finding.problem_category !== "unnecessary_under_invariant"
  ) {
    return { ok: false, error: "problem_category must be unnecessary_under_invariant" };
  }

  if (!("reason" in finding)) {
    return { ok: false, error: "finding missing reason" };
  }

  const reason = finding.reason;

  if (
    typeof reason !== "string" ||
    reason.length < MIN_REASON_LENGTH ||
    reason.length > MAX_REASON_LENGTH
  ) {
    return { ok: false, error: "reason length must be between 10 and 1000 characters" };
  }

  if (!("confidence" in finding)) {
    return { ok: false, error: "finding missing confidence" };
  }

  const confidence = finding.confidence;

  if (
    typeof confidence !== "number" ||
    Number.isNaN(confidence) ||
    confidence < MIN_CONFIDENCE ||
    confidence > MAX_CONFIDENCE
  ) {
    return { ok: false, error: "confidence must be a number between 0 and 1" };
  }

  const suggestedFix = "suggested_fix" in finding ? finding.suggested_fix : undefined;

  if ("suggested_fix" in finding && typeof suggestedFix !== "string") {
    return { ok: false, error: "suggested_fix must be a string" };
  }

  const resultFinding: JudgeFinding = {
    file: filePath,
    line_range: {
      start: rangeValidation.start,
      end: rangeValidation.end,
    },
    problem_category: "unnecessary_under_invariant",
    reason,
    confidence,
  };

  if (typeof suggestedFix === "string") {
    resultFinding.suggested_fix = suggestedFix;
  }

  return { ok: true, finding: resultFinding };
}

function parseAndCheckTopLevel(
  rawText: string
): { ok: true; record: Record<string, unknown> } | { ok: false; error: string } {
  const jsonText = extractJsonText(rawText);

  if (jsonText === null) {
    return { ok: false, error: "Output text is not valid JSON" };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return { ok: false, error: `JSON parse error: ${String(error)}` };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "Output must be a JSON object" };
  }

  const keys = Object.keys(parsed);

  for (const key of keys) {
    if (!TOP_LEVEL_ALLOWED_KEYS[key]) {
      return { ok: false, error: `Extra top-level key: ${key}` };
    }
  }

  if (!("verdict" in parsed) || !("findings" in parsed)) {
    return { ok: false, error: "Missing required top-level key verdict or findings" };
  }

  const record: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(parsed)) {
    record[key] = value;
  }

  return { ok: true, record };
}

function validateVerdict(
  verdict: unknown,
  findingsCount: number
): { ok: true; verdict: "FLAG" | "ALLOW" | "NEEDS_HUMAN_ATTENTION" } | { ok: false; error: string } {
  if (verdict !== "FLAG" && verdict !== "ALLOW" && verdict !== "NEEDS_HUMAN_ATTENTION") {
    return { ok: false, error: `Invalid verdict: ${String(verdict)}` };
  }

  if (verdict === "FLAG" && findingsCount === 0) {
    return { ok: false, error: "FLAG verdict requires at least one finding" };
  }

  if ((verdict === "ALLOW" || verdict === "NEEDS_HUMAN_ATTENTION") && findingsCount > 0) {
    return { ok: false, error: `${verdict} verdict requires empty findings array` };
  }

  return { ok: true, verdict };
}

function validateFindingsList(
  rawFindings: unknown[],
  fileLineCounts: Map<string, number>
): { ok: true; findings: JudgeFinding[] } | { ok: false; error: string } {
  const findings: JudgeFinding[] = [];

  for (const rawFinding of rawFindings) {
    const findingResult = validateFinding(rawFinding, fileLineCounts);

    if (!findingResult.ok) {
      return findingResult;
    }

    findings.push(findingResult.finding);
  }

  return { ok: true, findings };
}

export function validateJudgeOutput(
  rawText: string,
  sentFiles: { path: string; content: string }[]
): ValidationResult {
  const parsed = parseAndCheckTopLevel(rawText);

  if (!parsed.ok) {
    return parsed;
  }

  const record = parsed.record;
  const rawFindings = record["findings"];

  if (!Array.isArray(rawFindings)) {
    return { ok: false, error: "findings must be an array" };
  }

  const verdictCheck = validateVerdict(record["verdict"], rawFindings.length);

  if (!verdictCheck.ok) {
    return verdictCheck;
  }

  const notes = record["notes"];

  if ("notes" in record && typeof notes !== "string") {
    return { ok: false, error: "notes must be a string" };
  }

  const fileLineCounts = new Map<string, number>();

  for (const file of sentFiles) {
    const lineCount = file.content.length === 0 ? 0 : file.content.split("\n").length;
    fileLineCounts.set(file.path, lineCount);
  }

  const findingsCheck = validateFindingsList(rawFindings, fileLineCounts);

  if (!findingsCheck.ok) {
    return findingsCheck;
  }

  const output: ValidatedJudgeOutput = {
    verdict: verdictCheck.verdict,
    findings: findingsCheck.findings,
  };

  if (typeof notes === "string") {
    output.notes = notes;
  }

  return { ok: true, data: output };
}
