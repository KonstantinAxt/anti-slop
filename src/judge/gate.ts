import { execFileSync } from "node:child_process";
import * as path from "node:path";
import type { AntiSlopResult, CheckExecution, Finding } from "../types.js";
import { reviewWithJudge } from "./review.js";
import type { JudgeAbstainReason, JudgeFinding, JudgeProvider, ReviewSource } from "./types.js";

export const LLM_REVIEW_CHECK = "llm-review";

const REVIEWABLE_EXTENSIONS: Record<string, true> = { ".ts": true, ".tsx": true, ".js": true, ".jsx": true, ".mjs": true, ".cjs": true };

export interface LlmReview {
  findings: Finding[];
  check: CheckExecution;
}

function toFinding(judged: JudgeFinding): Finding {
  return {
    check: LLM_REVIEW_CHECK,
    rule: "unnecessary-under-invariant",
    severity: "warning",
    message: judged.reason,
    file: judged.file,
    line: judged.line_range.start,
    column: 1,
    confidence: judged.confidence,
    endLine: judged.line_range.end,
    suggestion: judged.suggested_fix,
  };
}

function describeAbstentions(abstentions: Map<JudgeAbstainReason, number>): string {
  const total = [...abstentions.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return "0 abstained";
  const parts = [...abstentions].map(([reason, count]) => `${reason} ${count}`);

  return `${total} abstained (${parts.join(", ")})`;
}

type ReviewDiffSource = { args: string[]; contentPrefix: "HEAD:" | ":" };

function resolveReviewDiffSource(source: ReviewSource): ReviewDiffSource {
  switch (source.kind) {
    case "since": return { args: [`${source.ref}...HEAD`], contentPrefix: "HEAD:" };
    case "staged": return { args: ["--cached"], contentPrefix: ":" };
  }
}

function readReviewFile(cwd: string, absolutePath: string, contentPrefix: ReviewDiffSource["contentPrefix"]): string {
  const relativePath = path.relative(cwd, absolutePath);

  return execFileSync("git", ["show", `${contentPrefix}./${relativePath}`], { cwd, encoding: "utf-8", maxBuffer: Infinity });
}

async function reviewChangedFile(cwd: string, absolutePath: string, diffSource: ReviewDiffSource, provider: JudgeProvider): Promise<{ findings: Finding[]; reviewed: boolean; droppedFindings: number; abstainReason?: JudgeAbstainReason }> {
  const relativePath = path.relative(cwd, absolutePath);
  const diff = execFileSync("git", ["diff", ...diffSource.args, "--", relativePath], { cwd, encoding: "utf-8", maxBuffer: Infinity });
  if (diff === "") return { findings: [], reviewed: false, droppedFindings: 0 };
  if (diff.split("\n").includes("+++ /dev/null")) return { findings: [], reviewed: false, droppedFindings: 0 };
  const content = readReviewFile(cwd, absolutePath, diffSource.contentPrefix);
  const result = await reviewWithJudge({ diff, files: [{ path: relativePath, content }] }, { provider });

  return { findings: result.findings.map(toFinding), reviewed: true, droppedFindings: result.provenance.droppedFindings, ...(result.abstainReason ? { abstainReason: result.abstainReason } : {}) };
}

// Reviews changed code files with content from the diff's new side, skipping files deleted there.
// Abstentions are counted in the check reason, so a failed request never reads as a clean review.
export async function runLlmReview(cwd: string, source: ReviewSource, targetFiles: string[], provider: JudgeProvider): Promise<LlmReview> {
  const findings: Finding[] = [];
  const abstentions = new Map<JudgeAbstainReason, number>();
  const diffSource = resolveReviewDiffSource(source);
  let reviewed = 0;
  let droppedFindings = 0;

  for (const absolutePath of targetFiles) {
    if (!REVIEWABLE_EXTENSIONS[path.extname(absolutePath)]) continue;
    const result = await reviewChangedFile(cwd, absolutePath, diffSource, provider);
    reviewed += Number(result.reviewed);
    droppedFindings += result.droppedFindings;
    if (result.abstainReason) abstentions.set(result.abstainReason, (abstentions.get(result.abstainReason) ?? 0) + 1);
    findings.push(...result.findings);
  }

  return {
    findings,
    check: {
      check: LLM_REVIEW_CHECK,
      status: "completed",
      findingsCount: findings.length,
      reason: `Reviewed ${reviewed} files with ${provider.model}: ${findings.length} findings, ${describeAbstentions(abstentions)}${droppedFindings > 0 ? `, ${droppedFindings} off-change dropped` : ""}`,
    },
  };
}

// Advisory merge: appends warnings and the check record; deterministic findings, `passed` and completion stay as they were.
export function withLlmReview(result: AntiSlopResult, review: LlmReview): AntiSlopResult {
  return {
    ...result,
    findings: [...result.findings, ...review.findings],
    checks: { ...result.checks, [LLM_REVIEW_CHECK]: review.check },
  };
}
