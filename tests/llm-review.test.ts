import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStaticProvider, runAntiSlop } from "../src/index.js";
import { LLM_REVIEW_CHECK, runLlmReview, withLlmReview } from "../src/judge/gate.js";
import { JudgeProviderError } from "../src/judge/provider.js";

const TEST_MODEL = "test-judge-model";
const CHANGED_FILE = "src/u.ts";
const SECOND_CHANGED_FILE = "src/v.ts";
const RANGE = ["HEAD~1...HEAD"];
const FLAGGED_LINE = 3;
const BASE_SCAN_TIMEOUT_MS = 30000;
const CLI_PATH = path.resolve(import.meta.dirname, "../bin/anti-slop");

// Synthetic fixture: a redundant null check under a non-null parameter type.
const BEFORE = "interface User { name: string; }\nfunction get(u: User): string {\n  return u.name;\n}\nexport { get };\n";
const AFTER = "interface User { name: string; }\nfunction get(u: User): string {\n  if (!u) return 'none';\n  return u.name;\n}\nexport { get };\n";

const FLAG_RESPONSE = JSON.stringify({
  verdict: "FLAG",
  findings: [{ file: CHANGED_FILE, line_range: { start: FLAGGED_LINE, end: FLAGGED_LINE }, problem_category: "unnecessary_under_invariant", reason: "Redundant null check: User is non-null.", confidence: 0.9 }],
});

let repoDir = "";

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: repoDir, stdio: "ignore" });
}

// Two commits, so RANGE covers two changed code files, one changed non-code file and one unchanged code file.
function createRepo(): string[] {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "anti-slop-llm-review-"));
  fs.mkdirSync(path.join(repoDir, "src"));
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  for (const file of [CHANGED_FILE, SECOND_CHANGED_FILE, "src/same.ts"]) fs.writeFileSync(path.join(repoDir, file), BEFORE);
  fs.writeFileSync(path.join(repoDir, "notes.md"), "before\n");
  git("add", ".");
  git("commit", "-qm", "base");
  for (const file of [CHANGED_FILE, SECOND_CHANGED_FILE]) fs.writeFileSync(path.join(repoDir, file), AFTER);
  fs.writeFileSync(path.join(repoDir, "notes.md"), "after\n");
  git("commit", "-qam", "change");

  return ["notes.md", "src/same.ts", CHANGED_FILE].map((file) => path.join(repoDir, file));
}

afterEach(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe("LLM review", () => {
  it("reviews only changed code files and reports a FLAG finding as an advisory warning at the flagged line", async () => {
    const targets = createRepo();

    const review = await runLlmReview(repoDir, RANGE, targets, createStaticProvider([FLAG_RESPONSE], TEST_MODEL));

    expect(review.findings).toEqual([
      { check: LLM_REVIEW_CHECK, rule: "unnecessary-under-invariant", severity: "warning", message: "Redundant null check: User is non-null.", file: CHANGED_FILE, line: FLAGGED_LINE, column: 1, suggestion: undefined },
    ]);

    expect(review.check).toEqual({ check: LLM_REVIEW_CHECK, status: "completed", findingsCount: 1, reason: `Reviewed 1 files with ${TEST_MODEL}: 1 findings, 0 abstained` });
  });

  it("counts provider timeouts and malformed output as abstentions, not a clean review", async () => {
    createRepo();
    const targets = [CHANGED_FILE, SECOND_CHANGED_FILE].map((file) => path.join(repoDir, file));
    const timeout = new JudgeProviderError("Request timed out", "TIMEOUT");

    const review = await runLlmReview(repoDir, RANGE, targets, createStaticProvider([timeout, "not json"], TEST_MODEL));

    expect(review.check.reason).toBe(`Reviewed 2 files with ${TEST_MODEL}: 0 findings, 2 abstained (TIMEOUT 1, MALFORMED_OUTPUT 1)`);
  });

  it("keeps deterministic findings and the pass state when merging a review", async () => {
    const targets = createRepo();
    const scan = await runAntiSlop({ cwd: repoDir, since: "HEAD~1" });
    const review = await runLlmReview(repoDir, RANGE, targets, createStaticProvider([FLAG_RESPONSE], TEST_MODEL));

    const merged = withLlmReview(scan, review);

    // Precondition: the comparison below is only meaningful if the deterministic scan finds something.
    expect(scan.findings.length).toBeGreaterThan(0);

    expect(merged.findings).toEqual([...scan.findings, ...review.findings]);

    expect(merged.passed).toBe(scan.passed);

    expect(merged.checks?.[LLM_REVIEW_CHECK]).toBe(review.check);
  }, BASE_SCAN_TIMEOUT_MS);

  it("refuses with exit code 2 before scanning when there is no diff to review", () => {
    createRepo();

    const run = spawnSync("node", [CLI_PATH, "--llm-review"], { cwd: repoDir, encoding: "utf-8", env: { ...process.env, ANTI_SLOP_JUDGE_BASE_URL: "http://127.0.0.1:9", ANTI_SLOP_JUDGE_API_KEY: "unused" } });

    expect(run.status).toBe(2);

    expect(run.stderr).toContain("--llm-review needs a diff");
  }, BASE_SCAN_TIMEOUT_MS);
});
