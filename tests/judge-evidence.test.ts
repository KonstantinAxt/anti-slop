import { describe, expect, it } from "vitest";
import { createStaticProvider, reviewWithJudge } from "../src/index.js";

const TEST_CEILING = 5;

describe("LLM Judge Evidence Checks and Token Ceiling", () => {
  it("unknown file in findings -> ABSTAIN MALFORMED_OUTPUT", async () => {
    // Synthetic fixture: finding targeting file not among sent files
    const payload = JSON.stringify({
      verdict: "FLAG",
      findings: [{ file: "src/unseen.ts", line_range: { start: 1, end: 1 }, problem_category: "unnecessary_under_invariant", reason: "Redundant defensive check.", confidence: 0.9 }],
    });

    const res = await reviewWithJudge({ diff: "+x", files: [{ path: "src/known.ts", content: "export {};" }] }, { provider: createStaticProvider([payload]) });

    expect(res.disposition).toBe("ABSTAIN");

    expect(res.abstainReason).toBe("MALFORMED_OUTPUT");
  });

  it("inverted line range start > end -> ABSTAIN MALFORMED_OUTPUT", async () => {
    // Synthetic fixture: finding with start greater than end
    const payload = JSON.stringify({
      verdict: "FLAG",
      findings: [{ file: "src/f.ts", line_range: { start: 5, end: 2 }, problem_category: "unnecessary_under_invariant", reason: "Invalid inverted line bounds.", confidence: 0.8 }],
    });

    const res = await reviewWithJudge({ diff: "+x", files: [{ path: "src/f.ts", content: "a\nb\nc\nd\ne\n" }] }, { provider: createStaticProvider([payload]) });

    expect(res.disposition).toBe("ABSTAIN");

    expect(res.abstainReason).toBe("MALFORMED_OUTPUT");
  });

  it("line range outside file bounds -> ABSTAIN MALFORMED_OUTPUT", async () => {
    // Synthetic fixture: line numbers exceeding total file line count
    const payload = JSON.stringify({
      verdict: "FLAG",
      findings: [{ file: "src/f.ts", line_range: { start: 20, end: 25 }, problem_category: "unnecessary_under_invariant", reason: "Lines outside candidate file bounds.", confidence: 0.8 }],
    });

    const res = await reviewWithJudge({ diff: "+x", files: [{ path: "src/f.ts", content: "const a = 1;\n" }] }, { provider: createStaticProvider([payload]) });

    expect(res.disposition).toBe("ABSTAIN");

    expect(res.abstainReason).toBe("MALFORMED_OUTPUT");
  });

  it("input exceeding token ceiling -> ABSTAIN TOKEN_CEILING without calling provider", async () => {
    // Synthetic fixture: prompt exceeding configured token ceiling
    let called = false;
    const provider = {
      name: "stub",
      model: "stub",
      endpoint: "stub://",
      async complete(): Promise<{ text: string }> {
        called = true;

        return { text: JSON.stringify({ verdict: "ALLOW", findings: [] }) };
      },
    };

    const res = await reviewWithJudge(
      { diff: "+long diff text that easily exceeds token limit", files: [{ path: "src/f.ts", content: "x\n".repeat(50) }] },
      { provider, inputTokenCeiling: TEST_CEILING }
    );

    expect(res.disposition).toBe("ABSTAIN");

    expect(res.abstainReason).toBe("TOKEN_CEILING");

    expect(called).toBe(false);
  });
});
