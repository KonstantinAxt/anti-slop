import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { AntiSlopResult, CheckExecution, Finding } from "../types.js";
import { reviewWithJudge } from "./review.js";
import type { JudgeAbstainReason, JudgeFinding, JudgeProvider } from "./types.js";

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

// Reviews each code file in `targetFiles` whose `git diff <gitRange>` is non-empty, one request per file.
// Abstentions are counted in the check reason, so a failed request never reads as a clean review.
export async function runLlmReview(cwd: string, gitRange: string[], targetFiles: string[], provider: JudgeProvider): Promise<LlmReview> {
  const findings: Finding[] = [];
  const abstentions = new Map<JudgeAbstainReason, number>();
  let reviewed = 0;

  for (const absolutePath of targetFiles) {
    if (!REVIEWABLE_EXTENSIONS[path.extname(absolutePath)]) continue;
    const relativePath = path.relative(cwd, absolutePath);
    const fileDiff = execFileSync("git", ["diff", ...gitRange, "--", relativePath], { cwd, encoding: "utf-8" });
    if (fileDiff === "") continue;

    reviewed++;
    const content = readFileSync(absolutePath, "utf-8");
    const result = await reviewWithJudge({ diff: fileDiff, files: [{ path: relativePath, content }] }, { provider });
    if (result.abstainReason) {
      abstentions.set(result.abstainReason, (abstentions.get(result.abstainReason) ?? 0) + 1);
    }
    findings.push(...result.findings.map(toFinding));
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
