import { describe, expect, it } from "vitest";
import { createStaticProvider, reviewWithJudge } from "../src/index.js";
import type { JudgeProvider } from "../src/judge/types.js";

const TEST_CEILING = 5;

const WINDOWED_FILE = [
  "import { read } from \"./read.js\";",
  "interface Entry { name: string; }",
  "type EntryId = string;",
  ...Array.from({ length: 80 }, (_, index) => `const unrelated${index} = ${index};`),
  "function changed(value: string): string {",
  "  const copy = value;",
  "  if (!value) return \"fallback\";",
  "  return copy;",
  "}",
  ...Array.from({ length: 80 }, (_, index) => `const after${index} = ${index};`),
].join("\n");

const WINDOWED_DIFF = [
  "diff --git a/src/f.ts b/src/f.ts",
  "--- a/src/f.ts",
  "+++ b/src/f.ts",
  "@@ -87 +86 @@",
  "-  return value;",
  "+  if (!value) return \"fallback\";",
].join("\n");
function captureWindowProvider(prompts: string[], line: number): JudgeProvider {
  return {
    name: "capture",
    model: "capture",
    endpoint: "capture://",
    async complete(request) {
      prompts.push(request.user);
      return { text: JSON.stringify({ verdict: "FLAG", findings: [{ file: "src/f.ts", line_range: { start: line, end: line }, problem_category: "unnecessary_under_invariant", reason: "The string parameter is non-null by its type.", confidence: 0.9 }] }) };
    },
  };
}

function oversizedPrefix(count: number): string[] {
  return [
    "import { read } from \"./read.js\";",
    "interface Entry { name: string; }",
    "type EntryId = string;",
    ...Array.from({ length: count }, (_, index) => `const unrelated${index} = ${index};`),
  ];
}
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
  it("reviews an oversized TypeScript file with whole declarations around its hunk", async () => {
    const prompts: string[] = [];
    const provider = {
      name: "capture",
      model: "capture",
      endpoint: "capture://",
      async complete(request: { user: string }): Promise<{ text: string }> {
        prompts.push(request.user);
        return { text: JSON.stringify({ verdict: "FLAG", findings: [{ file: "src/f.ts", line_range: { start: 86, end: 86 }, problem_category: "unnecessary_under_invariant", reason: "The string parameter is non-null by its type.", confidence: 0.9 }] }) };
      },
    };

    const result = await reviewWithJudge({ diff: WINDOWED_DIFF, files: [{ path: "src/f.ts", content: WINDOWED_FILE }] }, { provider, inputTokenCeiling: 180 });

    expect(result.disposition).toBe("FLAG");
    expect(result.findings.map((finding) => finding.line_range.start)).toEqual([86]);
    expect(prompts[0]).toContain("... lines 4-83 unchanged, omitted");
    expect(prompts[0]).toContain("... lines 89-168 unchanged, omitted");
    expect(prompts[0]).toContain("\t 86 + |   if (!value) return \"fallback\";");
    expect(prompts[0]).toContain("\t 84   | function changed(value: string): string {\n\t 85   |   const copy = value;\n\t    - |   return value;\n\t 86 + |   if (!value) return \"fallback\";\n\t 87   |   return copy;\n\t 88   | }");
    expect(prompts[0]).toContain("interface Entry { name: string; }");
    expect(prompts[0]).toContain("type EntryId = string;");
    expect(prompts[0]).toContain("import { read } from \"./read.js\";");
    expect(prompts[0]).not.toContain("const unrelated0 = 0;");
  });

  it("keeps an oversized TypeScript declaration whole and abstains if it remains over budget", async () => {
    let called = false;
    const provider = {
      name: "capture",
      model: "capture",
      endpoint: "capture://",
      async complete(): Promise<{ text: string }> {
        called = true;
        return { text: JSON.stringify({ verdict: "ALLOW", findings: [] }) };
      },
    };
    const content = `function changed() { return \"${"x".repeat(500)}\"; }`;

    const diff = ["diff --git a/src/f.ts b/src/f.ts", "--- a/src/f.ts", "+++ b/src/f.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n");
    const result = await reviewWithJudge({ diff, files: [{ path: "src/f.ts", content }] }, { provider, inputTokenCeiling: 20 });

    expect(result.abstainReason).toBe("TOKEN_CEILING");
    expect(called).toBe(false);
  });

  it("keeps an oversized non-TypeScript file unchanged and abstains", async () => {
    let called = false;
    const provider = {
      name: "capture",
      model: "capture",
      endpoint: "capture://",
      async complete(): Promise<{ text: string }> {
        called = true;
        return { text: JSON.stringify({ verdict: "ALLOW", findings: [] }) };
      },
    };

    const diff = ["diff --git a/src/file.json b/src/file.json", "--- a/src/file.json", "+++ b/src/file.json", "@@ -1 +1 @@", "-old", "+new"].join("\n");
    const content = `{
  "value": "${"x".repeat(500)}"
}`;
    const result = await reviewWithJudge({ diff, files: [{ path: "src/file.json", content }] }, { provider, inputTokenCeiling: 20 });

    expect(result.abstainReason).toBe("TOKEN_CEILING");
    expect(called).toBe(false);
  });

  it("keeps the full file when a changed line is outside every top-level declaration", async () => {
    let called = false;
    const provider = {
      name: "capture",
      model: "capture",
      endpoint: "capture://",
      async complete(): Promise<{ text: string }> {
        called = true;
        return { text: JSON.stringify({ verdict: "ALLOW", findings: [] }) };
      },
    };
    const content = `// changed comment\n${"// unchanged context\n".repeat(100)}`;
    const diff = ["diff --git a/src/f.ts b/src/f.ts", "--- a/src/f.ts", "+++ b/src/f.ts", "@@ -1 +1 @@", "-// old comment", "+// changed comment"].join("\n");

    const result = await reviewWithJudge({ diff, files: [{ path: "src/f.ts", content }] }, { provider, inputTokenCeiling: 20 });

    expect(result.abstainReason).toBe("TOKEN_CEILING");
    expect(called).toBe(false);
  });

  it("includes a new function after an added blank separator", async () => {
    const prompts: string[] = [];
    const content = [...oversizedPrefix(60), "", "export function added(value: string): string {", "  const copy = value;", "  if (!value) return \"fallback\";", "  return copy;", "}"].join("\n");
    const diff = ["diff --git a/src/f.ts b/src/f.ts", "--- a/src/f.ts", "+++ b/src/f.ts", "@@ -63,0 +64,6 @@", "+", "+export function added(value: string): string {", "+  const copy = value;", "+  if (!value) return \"fallback\";", "+  return copy;", "+}"].join("\n");

    const result = await reviewWithJudge({ diff, files: [{ path: "src/f.ts", content }] }, { provider: captureWindowProvider(prompts, 67), inputTokenCeiling: 200 });

    expect(result.findings.map((finding) => finding.line_range.start)).toEqual([67]);
    expect(prompts[0]).toContain("\t64 + | ");
    expect(prompts[0]).toContain("\t65 + | export function added(value: string): string {");
    expect(prompts[0]).not.toContain("const unrelated0 = 0;");
  });

  it("includes JSDoc changed with its function body", async () => {
    const prompts: string[] = [];
    const content = [...oversizedPrefix(60), "/** @param value remains valid */", "export function changed(value: string): string {", "  const copy = value;", "  if (!value) return \"fallback\";", "  return copy;", "}", ...Array.from({ length: 60 }, (_, index) => `const after${index} = ${index};`)].join("\n");
    const diff = [
      "diff --git a/src/f.ts b/src/f.ts",
      "--- a/src/f.ts",
      "+++ b/src/f.ts",
      "@@ -64 +64 @@",
      "-/** @param value was valid */",
      "+/** @param value remains valid */",
      "@@ -67 +67,2 @@",
      "-  return copy;",
      "+  if (!value) return \"fallback\";",
      "+  return copy;",
    ].join("\n");

    const result = await reviewWithJudge({ diff, files: [{ path: "src/f.ts", content }] }, { provider: captureWindowProvider(prompts, 67), inputTokenCeiling: 200 });

    expect(result.findings.map((finding) => finding.line_range.start)).toEqual([67]);
    expect(prompts[0]).toContain("\t    - | /** @param value was valid */\n\t 64 + | /** @param value remains valid */");
    expect(prompts[0]).toContain("\t 65   | export function changed(value: string): string {");
    expect(prompts[0]).not.toContain("const after0 = 0;");
  });
});

