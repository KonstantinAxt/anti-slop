import { describe, expect, it } from "vitest";
import { createStaticProvider, reviewWithJudge, runAntiSlop } from "../src/index.js";

const TEST_MODEL = "test-judge-model";
const CONFIDENCE = 0.95;

describe("LLM Judge Core Public API", () => {
  it("observed violation -> FLAG with expected file and lines", async () => {
    // Synthetic fixture: observed violation under visible invariant
    const diff = ["diff --git a/src/u.ts b/src/u.ts", "--- a/src/u.ts", "+++ b/src/u.ts", "@@ -2,3 +2,5 @@", " function get(u: User): string {", "+  if (!u) return 'none';", " }"].join("\n");
    const file = "interface User { name: string; }\nfunction get(u: User): string {\n  if (!u) return 'none';\n  return u.name;\n}";
    const payload = JSON.stringify({
      verdict: "FLAG",
      findings: [{ file: "src/u.ts", line_range: { start: 3, end: 3 }, problem_category: "unnecessary_under_invariant", reason: "Redundant null check under non-null User type.", confidence: CONFIDENCE }],
      notes: "Visible invariant in type signature.",
    });

    const res = await reviewWithJudge({ diff, files: [{ path: "src/u.ts", content: file }] }, { provider: createStaticProvider([payload], TEST_MODEL) });

    expect(res.disposition).toBe("FLAG");

    expect(res.abstainReason).toBeUndefined();

    expect(res.findings).toHaveLength(1);

    expect(res.findings[0]?.line_range).toEqual({ start: 3, end: 3 });

    expect(res.findings[0]?.confidence).toBe(CONFIDENCE);

    expect(res.notes).toBe("Visible invariant in type signature.");
  });

  it("benign lookalike -> ALLOW", async () => {
    // Synthetic fixture: benign lookalike at trust boundary
    const diff = "@@ -2,3 +2,5 @@\n function parse(raw: unknown) {\n+  if (!raw) throw new Error();\n }";
    const payload = JSON.stringify({ verdict: "ALLOW", findings: [], notes: "Valid trust boundary guard." });

    const res = await reviewWithJudge({ diff, files: [{ path: "src/p.ts", content: "function parse(raw: unknown) {}" }] }, { provider: createStaticProvider([payload], TEST_MODEL) });

    expect(res.disposition).toBe("ALLOW");

    expect(res.abstainReason).toBeUndefined();

    expect(res.findings).toHaveLength(0);

    expect(res.notes).toBe("Valid trust boundary guard.");
  });

  it("insufficient context -> ABSTAIN NEEDS_HUMAN_ATTENTION", async () => {
    // Synthetic fixture: invariant lives outside provided files
    const diff = "@@ -1,3 +1,5 @@\n export function run(ctx: Context) {\n+  if (ctx.s) ctx.s.touch();\n }";
    const payload = JSON.stringify({ verdict: "NEEDS_HUMAN_ATTENTION", findings: [] });

    const res = await reviewWithJudge({ diff, files: [{ path: "src/r.ts", content: "export function run(ctx: Context) {}" }] }, { provider: createStaticProvider([payload], TEST_MODEL) });

    expect(res.disposition).toBe("ABSTAIN");

    expect(res.abstainReason).toBe("NEEDS_HUMAN_ATTENTION");

    expect(res.findings).toHaveLength(0);
  });

  it("malformed output -> ABSTAIN MALFORMED_OUTPUT for invalid schema shapes", async () => {
    // Synthetic fixture: malformed model outputs
    const sample = [{ path: "src/f.ts", content: "export {};" }];
    const provider1 = createStaticProvider([JSON.stringify({ verdict: "ALLOW", findings: [], extra: true })]);
    const res1 = await reviewWithJudge({ diff: "+x", files: sample }, { provider: provider1 });

    expect(res1.disposition).toBe("ABSTAIN");

    expect(res1.abstainReason).toBe("MALFORMED_OUTPUT");

    const provider2 = createStaticProvider([JSON.stringify({ verdict: "FLAG", findings: [] })]);
    const res2 = await reviewWithJudge({ diff: "+x", files: sample }, { provider: provider2 });

    expect(res2.disposition).toBe("ABSTAIN");

    expect(res2.abstainReason).toBe("MALFORMED_OUTPUT");

    const provider3 = createStaticProvider(["not valid json"]);
    const res3 = await reviewWithJudge({ diff: "+x", files: sample }, { provider: provider3 });

    expect(res3.disposition).toBe("ABSTAIN");

    expect(res3.abstainReason).toBe("MALFORMED_OUTPUT");
  });

  it("fenced output -> parses one block after prose, abstains on two blocks, keeps fences inside bare JSON strings", async () => {
    // Synthetic fixture: model wraps its JSON answer in prose and code fences
    const sample = [{ path: "src/f.ts", content: "export {};" }];
    const allow = JSON.stringify({ verdict: "ALLOW", findings: [] });
    const review = async (text: string) => reviewWithJudge({ diff: "+x", files: sample }, { provider: createStaticProvider([text]) });

    const prose = await review(`The guards are justified.\n\n\`\`\`json\n${allow}\n\`\`\``);

    expect(prose.disposition).toBe("ALLOW");

    const twoBlocks = await review(`\`\`\`json\n${allow}\n\`\`\`\nOr:\n\`\`\`json\n${allow}\n\`\`\``);

    expect(twoBlocks.abstainReason).toBe("MALFORMED_OUTPUT");

    const fenceInString = await review(JSON.stringify({ verdict: "ALLOW", findings: [], notes: "Use ```ts code``` here." }));

    expect(fenceInString.disposition).toBe("ALLOW");
  });

  it("provider Error -> ABSTAIN PROVIDER_ERROR", async () => {
    // Synthetic fixture: provider throwing operational error
    const res = await reviewWithJudge({ diff: "+x", files: [{ path: "src/f.ts", content: "export {};" }] }, { provider: createStaticProvider([new Error("offline failure")]) });

    expect(res.disposition).toBe("ABSTAIN");

    expect(res.abstainReason).toBe("PROVIDER_ERROR");

    expect(res.findings).toHaveLength(0);
  });

  it("provenance records deterministic hashes, model, and provider", async () => {
    // Synthetic fixture: verifying provenance determinism
    const payload = JSON.stringify({ verdict: "ALLOW", findings: [] });
    const input = { diff: "+x", files: [{ path: "src/f.ts", content: "export {};" }] };
    const res1 = await reviewWithJudge(input, { provider: createStaticProvider([payload], "model-1") });
    const res2 = await reviewWithJudge(input, { provider: createStaticProvider([payload], "model-1") });

    expect(res1.provenance.systemPromptSha256).toBe(res2.provenance.systemPromptSha256);

    expect(res1.provenance.userTemplateSha256).toBe(res2.provenance.userTemplateSha256);

    expect(res1.provenance.schemaSha256).toBe(res2.provenance.schemaSha256);

    expect(res1.provenance.schemaVersion).toBe("2026-10-01");

    expect(res1.provenance.provider).toBe("static");
  });

  it("runAntiSlop yields identical findings whether failing judge ran or not", async () => {
    const before = await runAntiSlop({ cwd: process.cwd(), files: ["src/checks/boundaries.ts"] });

    await reviewWithJudge({ diff: "+x", files: [{ path: "src/checks/boundaries.ts", content: "export {};" }] }, { provider: createStaticProvider([new Error("boom")]) });

    const after = await runAntiSlop({ cwd: process.cwd(), files: ["src/checks/boundaries.ts"] });

    expect(after.findings).toEqual(before.findings);

    expect(after.passed).toBe(before.passed);
  });

  it("allows a response when every finding targets an unchanged line", async () => {
    const payload = JSON.stringify({ verdict: "FLAG", findings: [
      { file: "src/u.ts", line_range: { start: 4, end: 4 }, problem_category: "unnecessary_under_invariant", reason: "Unchanged line outside candidate findings.", confidence: 0.9 },
    ] });
    const diff = ["diff --git a/src/u.ts b/src/u.ts", "--- a/src/u.ts", "+++ b/src/u.ts", "@@ -1,3 +1,4 @@", " first", "+added", " third", " last"].join("\n");
    const res = await reviewWithJudge({ diff, files: [{ path: "src/u.ts", content: "first\nadded\nthird\nlast" }] }, { provider: createStaticProvider([payload], TEST_MODEL) });

    expect(res.disposition).toBe("ALLOW");
    expect(res.findings).toEqual([]);
    expect(res.provenance.droppedFindings).toBe(1);
  });

  it("keeps ranges touching an added line and drops adjacent ranges", async () => {
    const diff = ["diff --git a/u.ts b/u.ts", "--- a/u.ts", "+++ b/u.ts", "@@ -1,3 +1,4 @@", " first", "+added", " third", " fourth"].join("\n");
    const payload = JSON.stringify({ verdict: "FLAG", findings: [
      { file: "u.ts", line_range: { start: 1, end: 2 }, problem_category: "unnecessary_under_invariant", reason: "The range ends on an added line.", confidence: 0.9 },
      { file: "u.ts", line_range: { start: 2, end: 4 }, problem_category: "unnecessary_under_invariant", reason: "The range starts on an added line.", confidence: 0.9 },
      { file: "u.ts", line_range: { start: 1, end: 1 }, problem_category: "unnecessary_under_invariant", reason: "This range is just before the added line.", confidence: 0.9 },
      { file: "u.ts", line_range: { start: 3, end: 3 }, problem_category: "unnecessary_under_invariant", reason: "This range is just after the added line.", confidence: 0.9 },
    ] });

    const result = await reviewWithJudge({ diff, files: [{ path: "u.ts", content: "first\nadded\nthird\nfourth" }] }, { provider: createStaticProvider([payload], TEST_MODEL) });

    expect(result.disposition).toBe("FLAG");
    expect(result.findings.map((finding) => finding.line_range)).toEqual([{ start: 1, end: 2 }, { start: 2, end: 4 }]);
    expect(result.provenance.droppedFindings).toBe(2);
  });

  it("drops a finding for a file outside the diff", async () => {
    const diff = ["diff --git a/u.ts b/u.ts", "--- a/u.ts", "+++ b/u.ts", "@@ -3 +3 @@", "+added"].join("\n");
    const payload = JSON.stringify({ verdict: "FLAG", findings: [
      { file: "u.ts", line_range: { start: 3, end: 3 }, problem_category: "unnecessary_under_invariant", reason: "The hunk adds line three.", confidence: 0.9 },
      { file: "other.ts", line_range: { start: 3, end: 3 }, problem_category: "unnecessary_under_invariant", reason: "This file is not in the diff.", confidence: 0.9 },
    ] });

    const result = await reviewWithJudge({ diff, files: [{ path: "u.ts", content: "one\ntwo\nadded" }, { path: "other.ts", content: "one\ntwo\nthree" }] }, { provider: createStaticProvider([payload], TEST_MODEL) });

    expect(result.disposition).toBe("FLAG");
    expect(result.findings.map((finding) => finding.file)).toEqual(["u.ts"]);
    expect(result.provenance.droppedFindings).toBe(1);
  });
  it("matches a named-file finding against a pathless added-line hunk", async () => {
    const diff = "@@ -3 +3 @@\n+added";
    const payload = JSON.stringify({ verdict: "FLAG", findings: [{ file: "u.ts", line_range: { start: 3, end: 3 }, problem_category: "unnecessary_under_invariant", reason: "The pathless hunk adds line three.", confidence: 0.9 }] });

    const result = await reviewWithJudge({ diff, files: [{ path: "u.ts", content: "one\ntwo\nadded" }] }, { provider: createStaticProvider([payload], TEST_MODEL) });

    expect(result.disposition).toBe("FLAG");
    expect(result.findings.map((finding) => finding.line_range)).toEqual([{ start: 3, end: 3 }]);
    expect(result.provenance.droppedFindings).toBe(0);
  });

  it("preserves notes when the judge requests human attention", async () => {
    const payload = JSON.stringify({ verdict: "NEEDS_HUMAN_ATTENTION", findings: [], notes: "The invariant is outside the supplied context." });
    const result = await reviewWithJudge({ diff: "@@ -1 +1 @@\n+added", files: [{ path: "u.ts", content: "added" }] }, { provider: createStaticProvider([payload], TEST_MODEL) });

    expect(result.disposition).toBe("ABSTAIN");
    expect(result.notes).toBe("The invariant is outside the supplied context.");
  });

});
