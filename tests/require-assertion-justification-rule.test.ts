import { describe, expect, it } from "vitest";
import { ESLint, type Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { checkWithEslint } from "../src/checks/eslint-runner.js";
import {
  extractCleanComment,
  hasValidJustification,
  isAstNode,
  isPrecedingComment,
  requireAssertionJustificationRule,
} from "../src/checks/require-assertion-justification-rule.js";
import type { Finding } from "../src/types.js";

const RULE_NAME = "comment-discipline/require-assertion-justification";
const EXPECTED_MESSAGE =
  "Type assertion requires an invariant justification comment (e.g. '// SAFETY: <reason>') on the same line or immediately preceding line.";

async function checkRule(filePath: string, code: string): Promise<Finding[]> {
  const findings = await checkWithEslint(filePath, code);

  return findings.filter((finding) => finding.rule === RULE_NAME);
}

interface RuleOptions {
  markers?: string[];
}

async function lintWithCustomOptions(code: string, options?: RuleOptions): Promise<ESLint.LintResult[]> {
  const ruleConfig: Linter.RuleEntry = options ? ["warn", options] : "warn";
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.ts"],
        languageOptions: { parser: tsParser },
        plugins: {
          "comment-discipline": {
            rules: { "require-assertion-justification": requireAssertionJustificationRule },
          },
        },
        rules: { "comment-discipline/require-assertion-justification": ruleConfig },
      },
    ],
  });

  return eslint.lintText(code, { filePath: "src/example.ts" });
}

describe("comment-discipline/require-assertion-justification", () => {
  describe("acceptance criteria", () => {
    it("flags bare 'as Foo' assertions without a justification comment", async () => {
      const findings = await checkRule("src/example.ts", "const x = value as Foo;");

      expect(findings).toHaveLength(1);

      const finding = findings[0];

      expect(finding?.line).toBe(1);
      expect(finding?.column).toBe(11);
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toBe(EXPECTED_MESSAGE);
      expect(finding?.why).toContain("Type assertions bypass TypeScript's static type checker");
      expect(finding?.suggestion).toContain("SAFETY:");
    });

    it("does not flag 'as const' assertions", async () => {
      const findings = await checkRule(
        "src/example.ts",
        "const a = 'hello' as const;\nconst b = 42 as const;\nconst c = [1, 2] as const;",
      );

      expect(findings).toHaveLength(0);
    });

    it("passes when '// SAFETY: reason' is on the immediately preceding line", async () => {
      const findings = await checkRule("src/example.ts", "// SAFETY: validated\nconst x = value as Foo;");

      expect(findings).toHaveLength(0);
    });

    it("passes when '// SAFETY: reason' is a trailing comment on the same line", async () => {
      const findings = await checkRule("src/example.ts", "const x = value as Foo; // SAFETY: validated");

      expect(findings).toHaveLength(0);
    });

    it("flags empty marker with no explanation following the marker", async () => {
      const preceding = await checkRule("src/example.ts", "// SAFETY:\nconst a = first as Foo;");

      expect(preceding).toHaveLength(1);
      expect(preceding[0]?.line).toBe(2);
      expect(preceding[0]?.message).toBe(EXPECTED_MESSAGE);

      const sameLine = await checkRule("src/example.ts", "const b = second as Bar; // SAFETY:");

      expect(sameLine).toHaveLength(1);
      expect(sameLine[0]?.line).toBe(1);
      expect(sameLine[0]?.message).toBe(EXPECTED_MESSAGE);

      const whitespace = await checkRule("src/example.ts", "const c = third as Baz; // SAFETY:   ");

      expect(whitespace).toHaveLength(1);
      expect(whitespace[0]?.line).toBe(1);
      expect(whitespace[0]?.message).toBe(EXPECTED_MESSAGE);
    });

    it("supports custom marker configuration via rule options", async () => {
      const customConfig: RuleOptions = { markers: ["INVARIANT:"] };

      const validResult = await lintWithCustomOptions("const x = value as Foo; // INVARIANT: guard", customConfig);
      const validMessages = validResult[0]?.messages.filter((msg) => msg.ruleId === RULE_NAME);

      expect(validMessages).toHaveLength(0);

      const defaultResult = await lintWithCustomOptions("const x = value as Foo; // SAFETY: guard", customConfig);
      const defaultMessages = defaultResult[0]?.messages.filter((msg) => msg.ruleId === RULE_NAME);

      expect(defaultMessages).toHaveLength(1);
      expect(defaultMessages?.[0]?.message).toBe(EXPECTED_MESSAGE);

      const emptyResult = await lintWithCustomOptions("const x = value as Foo; // INVARIANT:", customConfig);
      const emptyMessages = emptyResult[0]?.messages.filter((msg) => msg.ruleId === RULE_NAME);

      expect(emptyMessages).toHaveLength(1);
      expect(emptyMessages?.[0]?.message).toBe(EXPECTED_MESSAGE);
    });

    it("flags bare angle-bracket assertions and passes when justified", async () => {
      const bare = await checkRule("src/example.ts", "const x = <Foo>value;");

      expect(bare).toHaveLength(1);
      expect(bare[0]?.line).toBe(1);
      expect(bare[0]?.column).toBe(11);
      expect(bare[0]?.message).toBe(EXPECTED_MESSAGE);

      const justified = await checkRule("src/example.ts", "// SAFETY: schema\nconst x = <Foo>value;");

      expect(justified).toHaveLength(0);

      const constAssertion = await checkRule("src/example.ts", "const x = <const>'fixed';");

      expect(constAssertion).toHaveLength(0);
    });
  });

  describe("additional formatting, boundaries, and kill mutants", () => {
    it("passes with single-character justification text (kills > 1 length mutant)", async () => {
      const findings = await checkRule("src/example.ts", "const x = value as Foo; // SAFETY: x");

      expect(findings).toHaveLength(0);
    });

    it("passes with single-line and multi-line block comments", async () => {
      const single = await checkRule("src/example.ts", "/* SAFETY: invariant */ const x = value as Foo;");

      expect(single).toHaveLength(0);

      const multi = await checkRule("src/example.ts", "/**\n * SAFETY: normalized\n */\nconst y = value as Foo;");

      expect(multi).toHaveLength(0);
    });

    it("passes when comment immediately precedes enclosing multiline statement", async () => {
      const findings = await checkRule("src/example.ts", "// SAFETY: verified\nconst x =\n  value as Foo;");

      expect(findings).toHaveLength(0);
    });

    it("flags assertion when comment is separated by a blank line", async () => {
      const findings = await checkRule("src/example.ts", "// SAFETY: verified\n\nconst x = value as Foo;");

      expect(findings).toHaveLength(1);
      expect(findings[0]?.line).toBe(3);
    });

    it("flags assertion inside function even if preceding comment is above function declaration", async () => {
      const findings = await checkRule("src/example.ts", "// SAFETY: outside\nfunction p() {\n  return v as Foo;\n}");

      expect(findings).toHaveLength(1);
      expect(findings[0]?.line).toBe(3);
    });

    it("is disabled for test files matching test file globs", async () => {
      const testFile = await checkRule("tests/example.test.ts", "const x = value as Foo;");

      expect(testFile).toHaveLength(0);

      const specFile = await checkRule("src/example.spec.ts", "const x = value as Foo;");

      expect(specFile).toHaveLength(0);
    });

    it("supports multiple custom markers in array", async () => {
      const customConfig: RuleOptions = { markers: ["SAFETY:", "INVARIANT:", "UNSAFE:"] };
      const code = [
        "const a = v1 as Foo; // INVARIANT: invariant holds",
        "const b = v2 as Bar; // UNSAFE: audited legacy migration",
        "const c = v3 as Baz; // SAFETY: bounded range",
        "const d = v4 as Qux; // OTHER: not configured",
      ].join("\n");
      const result = await lintWithCustomOptions(code, customConfig);
      const messages = result[0]?.messages.filter((msg) => msg.ruleId === RULE_NAME);

      expect(messages).toHaveLength(1);
      expect(messages?.[0]?.line).toBe(4);
    });

    it("flags assertion when comment is placed on line after assertion", async () => {
      const findings = await checkRule("src/example.ts", "const x = value as Foo;\n// SAFETY: below");

      expect(findings).toHaveLength(1);
      expect(findings[0]?.line).toBe(1);
    });

    it("passes when comment is indented on preceding line", async () => {
      const findings = await checkRule("src/example.ts", "function inner() {\n  // SAFETY: indent\n  return v as Foo;\n}");

      expect(findings).toHaveLength(0);
    });

    it("flags assertion when preceding line contains code before the comment", async () => {
      const findings = await checkRule("src/example.ts", "const a = 1; // SAFETY: a\nconst b = value as Foo;");

      expect(findings).toHaveLength(1);
      expect(findings[0]?.line).toBe(2);
    });

    it("passes when comment immediately precedes inner node of multiline expression", async () => {
      const findings = await checkRule("src/example.ts", "const x =\n  // SAFETY: inner\n  value as Foo;");

      expect(findings).toHaveLength(0);
    });

    it("flags various AST type targets without justification: qualified names, primitives, unions", async () => {
      const qualified = await checkRule("src/example.ts", "const x = val as Namespace.CustomType;");

      expect(qualified).toHaveLength(1);

      const primitive = await checkRule("src/example.ts", "const y = val as number;");

      expect(primitive).toHaveLength(1);

      const union = await checkRule("src/example.ts", "const z = val as (string | number);");

      expect(union).toHaveLength(1);
    });

    it("passes when comment is on the second line of a multiline assertion", async () => {
      const findings = await checkRule("src/example.ts", "const x = value\n  as Foo; // SAFETY: trailing");

      expect(findings).toHaveLength(0);
    });
  });

  describe("internal rule helpers unit coverage", () => {
    it("isAstNode verifies AST object structure", () => {
      expect(isAstNode(null)).toBe(false);
      expect(isAstNode(undefined)).toBe(false);
      expect(isAstNode("not-an-object")).toBe(false);
      expect(isAstNode(123)).toBe(false);
      expect(isAstNode({})).toBe(false);
      expect(isAstNode({ type: "Identifier" })).toBe(true);
    });

    it("extractCleanComment handles asterisk and whitespace edge cases", () => {
      expect(extractCleanComment("  * SAFETY: reason")).toBe("SAFETY: reason");
      expect(extractCleanComment("  ** SAFETY: reason")).toBe("SAFETY: reason");
      expect(extractCleanComment("SAFETY: a * b")).toBe("SAFETY: a * b");
      expect(extractCleanComment("SAFETY:   multiple   spaces")).toBe("SAFETY: multiple spaces");
      expect(extractCleanComment("")).toBe("");
    });

    it("hasValidJustification verifies marker presence and length", () => {
      expect(hasValidJustification(" SAFETY: reason", ["SAFETY:"])).toBe(true);
      expect(hasValidJustification(" SAFETY:", ["SAFETY:"])).toBe(false);
      expect(hasValidJustification(" UNRELATED: text", ["SAFETY:"])).toBe(false);
    });

    it("isPrecedingComment verifies loc and column boundaries", () => {
      expect(isPrecedingComment({ type: "Line", value: "test" }, [2], [""])).toBe(false);
      expect(
        isPrecedingComment(
          { type: "Line", value: "test", loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 4 } } },
          [2],
          ["// test"],
        ),
      ).toBe(true);
      expect(
        isPrecedingComment(
          { type: "Line", value: "test", loc: { start: { line: 1, column: 7 }, end: { line: 1, column: 11 } } },
          [2],
          ["code(); // test"],
        ),
      ).toBe(false);
    });
  });
});
