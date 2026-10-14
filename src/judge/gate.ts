import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    suggestion: judged.suggested_fix,
  };
}

function describeAbstentions(abstentions: Map<JudgeAbstainReason, number>): string {
  const total = [...abstentions.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return "0 abstained";
  const parts = [...abstentions].map(([reason, count]) => `${reason} ${count}`);

  return `${total} abstained (${parts.join(", ")})`;
}
type ReviewDiffSource = { args: string[]; revision: "HEAD" | ":" | null };

function resolveReviewDiffSource(source: ReviewSource): ReviewDiffSource {
  switch (source.kind) {
    case "since": return { args: [`${source.ref}...HEAD`], revision: "HEAD" };
    case "staged": return { args: ["--cached"], revision: ":" };
    case "working-tree": return { args: [], revision: null };
  }
}
function readReviewFile(cwd: string, absolutePath: string, revision: ReviewDiffSource["revision"]): string | undefined {
  if (revision === null) return readFileSync(absolutePath, "utf-8");
  const relativePath = path.relative(cwd, absolutePath);
  const gitRevision = revision === "HEAD" ? `HEAD:${relativePath}` : `:${relativePath}`;
  try {
    return execFileSync("git", ["show", gitRevision], { cwd, encoding: "utf-8" });
  } catch {
    return undefined;
  }
}
async function reviewChangedFile(cwd: string, absolutePath: string, diffSource: ReviewDiffSource, provider: JudgeProvider): Promise<{ finding: Finding[]; reviewed: boolean; abstainReason?: JudgeAbstainReason }> {
  const relativePath = path.relative(cwd, absolutePath);
  const diff = execFileSync("git", ["diff", ...diffSource.args, "--", relativePath], { cwd, encoding: "utf-8" });
  if (diff === "") return { finding: [], reviewed: false };
  const content = readReviewFile(cwd, absolutePath, diffSource.revision);
  if (content === undefined) return { finding: [], reviewed: false };
  const result = await reviewWithJudge({ diff, files: [{ path: relativePath, content }] }, { provider });

  return { finding: result.findings.map(toFinding), reviewed: true, ...(result.abstainReason ? { abstainReason: result.abstainReason } : {}) };
}

// Reviews changed code files with content from the diff's new side, skipping files deleted there.
// Abstentions are counted in the check reason, so a failed request never reads as a clean review.
export async function runLlmReview(cwd: string, source: ReviewSource, targetFiles: string[], provider: JudgeProvider): Promise<LlmReview> {
  const findings: Finding[] = [];
  const abstentions = new Map<JudgeAbstainReason, number>();
  const diffSource = resolveReviewDiffSource(source);
  let reviewed = 0;

  for (const absolutePath of targetFiles) {
    if (!REVIEWABLE_EXTENSIONS[path.extname(absolutePath)]) continue;
    const result = await reviewChangedFile(cwd, absolutePath, diffSource, provider);
    reviewed += Number(result.reviewed);
    if (result.abstainReason) abstentions.set(result.abstainReason, (abstentions.get(result.abstainReason) ?? 0) + 1);
    findings.push(...result.finding);
  }

  return {
    findings,
    check: {
      check: LLM_REVIEW_CHECK,
      status: "completed",
      findingsCount: findings.length,
      reason: `Reviewed ${reviewed} files with ${provider.model}: ${findings.length} findings, ${describeAbstentions(abstentions)}`,
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
