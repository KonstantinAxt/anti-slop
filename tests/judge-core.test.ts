import { describe, expect, it } from "vitest";
import { createStaticProvider, reviewWithJudge, runAntiSlop } from "../src/index.js";

const TEST_MODEL = "test-judge-model";
const CONFIDENCE = 0.95;

describe("LLM Judge Core Public API", () => {
  it("observed violation -> FLAG with expected file and lines", async () => {
    // Synthetic fixture: observed violation under visible invariant
    const diff = "@@ -2,3 +2,5 @@\n function get(u: User): string {\n+  if (!u) return 'none';\n }";
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
});
