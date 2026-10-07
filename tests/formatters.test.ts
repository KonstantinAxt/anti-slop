import { describe, expect, it } from "bun:test";
import { formatOutput } from "../src/formatters.js";
import type { AntiSlopResult } from "../src/types.js";

describe("Output Formatters", () => {
  const sampleResult: AntiSlopResult = {
    targetDir: "/test/project",
    totalFilesChecked: 2,
    passed: false,
    durationMs: 42,
    findings: [
      {
        check: "scars",
        rule: "no-service-rounding",
        severity: "error",
        message: "Math.round() called inside service/computation file.",
        file: "src/services/payroll.ts",
        line: 14,
        column: 10,
        excerpt: "return Math.round(hours * 10) / 10;",
        why: "Services compute, formatters round.",
        suggestion: "Return unrounded raw value.",
      },
    ],
  };

  it("formats valid JSON output with 2-space indentation", () => {
    const jsonOutput = formatOutput(sampleResult, "json");
    expect(jsonOutput).toBe(JSON.stringify(sampleResult, null, 2));
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.passed).toBe(false);
    expect(parsed.findings.length).toBe(1);
    expect(parsed.findings[0].rule).toBe("no-service-rounding");
  });
  it("formats Markdown findings output with code excerpts exactly", () => {
    const mdOutput = formatOutput(sampleResult, "llm");
    const expected =
      "# Anti-AI Slop Review Findings\n\n" +
      "**Status:** FAIL (1 errors, 0 warnings) across 2 files (42ms).\n\n" +
      "## Violations\n\n" +
      "### 1. [ERROR] `no-service-rounding` (scars)\n" +
      "- **Location:** `src/services/payroll.ts:14:10`\n" +
      "- **Problem:** Math.round() called inside service/computation file.\n" +
      "- **Code Excerpt:**\n" +
      "```typescript\n" +
      "return Math.round(hours * 10) / 10;\n" +
      "```\n" +
      "- **Why it matters:** Services compute, formatters round.\n" +
      "- **Remediation:** Return unrounded raw value.\n";

    expect(mdOutput).toBe(expected);
  });
  it("formats clean Terminal output by default and explicitly", () => {
    const defaultOutput = formatOutput(sampleResult);
    const termOutput = formatOutput(sampleResult, "terminal");

    expect(defaultOutput).toBe(termOutput);
    const expected =
      "\n\x1b[1m🛡️  anti-slop - Deterministic Code Review Gate\x1b[0m\n" +
      "\x1b[2mCatches structural defects and shortcuts before code review\x1b[0m\n\n" +
      "\x1b[1m\x1b[36msrc/services/payroll.ts\x1b[0m\n" +
      "  \x1b[2m14:10\x1b[0m  \x1b[31merror\x1b[0m  Math.round() called inside service/computation file.  \x1b[2m(no-service-rounding)\x1b[0m\n" +
      "    \x1b[2m│\x1b[0m  return Math.round(hours * 10) / 10;\n" +
      "    \x1b[2m↳ fix: Return unrounded raw value.\x1b[0m\n\n" +
      "\x1b[1m\x1b[31m✖ Found 1 error(s), 0 warning(s)\x1b[0m in 2 files (42ms)\n" +
      "\x1b[2mTip: Run with --format llm to generate review prompt for LLM tools (ocr, diffray, etc.)\x1b[0m\n";

    expect(termOutput).toBe(expected);
  });
  it("formats passing scan results in terminal and LLM", () => {
    const passResult: AntiSlopResult = {
      targetDir: "/test/pass",
      totalFilesChecked: 5,
      passed: true,
      durationMs: 120,
      findings: [],
    };

    const termOutput = formatOutput(passResult, "terminal");
    const expectedTerm =
      "\n\x1b[1m🛡️  anti-slop - Deterministic Code Review Gate\x1b[0m\n" +
      "\x1b[2mCatches structural defects and shortcuts before code review\x1b[0m\n\n" +
      "\x1b[32m✔ All checks passed!\x1b[0m Scanned 5 files in 120ms.\n";
    expect(termOutput).toBe(expectedTerm);

    const llmOutput = formatOutput(passResult, "llm");
    const expectedLlm =
      "# Anti-AI Slop Review Findings\n\n" +
      "**Status:** PASS (No anti-slop violations detected) across 5 files (120ms).\n\n" +
      "No deterministic anti-slop violations detected.";
    expect(llmOutput).toBe(expectedLlm);
    expect(llmOutput).toContain("**Status:** PASS (No anti-slop violations detected) across 5 files (120ms).");
    expect(llmOutput).toContain("No deterministic anti-slop violations detected.");
    expect(llmOutput).not.toContain("## Violations");
  });

  it("formats warning findings and colorizes warning-only summaries", () => {
    const warnResult: AntiSlopResult = {
      targetDir: "/test/warn",
      totalFilesChecked: 3,
      passed: false,
      durationMs: 50,
      findings: [
        {
          check: "style",
          rule: "prefer-named-exports",
          severity: "warning",
          message: "Use named exports instead of default export.",
          file: "src/utils.ts",
          line: 5,
          column: 1,
        },
      ],
    };

    const termOutput = formatOutput(warnResult, "terminal");
    expect(termOutput).toContain("warn");
    expect(termOutput).not.toContain("fix:");
    expect(termOutput).not.toContain("│");
    expect(termOutput).toContain("\x1b[1m\x1b[33m✖ Found 0 error(s), 1 warning(s)\x1b[0m in 3 files (50ms)");

    const llmOutput = formatOutput(warnResult, "llm");
    expect(llmOutput).toContain("FAIL (0 errors, 1 warnings)");
    expect(llmOutput).toContain("### 1. [WARN] `prefer-named-exports` (style)");
    expect(llmOutput).toContain("- **Location:** `src/utils.ts:5:1`");
    expect(llmOutput).toContain("- **Problem:** Use named exports instead of default export.");
    expect(llmOutput).not.toContain("- **Code Excerpt:**");
    expect(llmOutput).not.toContain("- **Why it matters:**");
    expect(llmOutput).not.toContain("- **Remediation:**");
  });

  it("formats CRAP report across all risk levels and sorts descending", () => {
    const resultWithCrap: AntiSlopResult = {
      ...sampleResult,
      crapEntries: [
        {
          functionName: "lowRiskFunc",
          file: "src/low.ts",
          line: 1,
          complexity: 1,
          coverage: 100.0,
          crap: 1.0,
        },
        {
          functionName: "boundaryLowFunc",
          file: "src/boundary-low.ts",
          line: 5,
          complexity: 2,
          coverage: 80.0,
          crap: 5.0, // Exactly 5.0 should be Low risk, not Moderate
        },
        {
          functionName: "boundaryModerateFunc",
          file: "src/boundary-mod.ts",
          line: 15,
          complexity: 10,
          coverage: 30.0,
          crap: 30.0, // Exactly 30.0 should be Moderate risk, not High
        },
        {
          functionName: "highRiskFunc",
          file: "src/high.ts",
          line: 10,
          complexity: 15,
          coverage: 20.0,
          crap: 45.5,
        },
        {
          functionName: "moderateRiskFunc",
          file: "src/mod.ts",
          line: 20,
          complexity: 5,
          coverage: 50.0,
          crap: 12.3,
        },
      ],
    };

    const termOutput = formatOutput(resultWithCrap, "terminal");
    expect(termOutput).toContain("CRAP Report");
    // useColor: true in formatCrapTerminal produces ANSI bold/color codes
    expect(termOutput).toContain("\x1b[");
    expect(termOutput).toContain("highRiskFunc");
    expect(termOutput).toContain("moderateRiskFunc");
    expect(termOutput).toContain("lowRiskFunc");

    const llmOutput = formatOutput(resultWithCrap, "llm");
    expect(llmOutput).toContain("## CRAP (Change Risk Anti-Pattern) Report");
    expect(llmOutput).toContain("| Function | File | CC | Cov% | CRAP | Risk |");
    expect(llmOutput).toContain("| `highRiskFunc` | `src/high.ts` | 15 | 20.0% | 45.5 | **High** |");
    expect(llmOutput).toContain("| `boundaryModerateFunc` | `src/boundary-mod.ts` | 10 | 30.0% | 30.0 | Moderate |");
    expect(llmOutput).toContain("| `moderateRiskFunc` | `src/mod.ts` | 5 | 50.0% | 12.3 | Moderate |");
    expect(llmOutput).toContain("| `boundaryLowFunc` | `src/boundary-low.ts` | 2 | 80.0% | 5.0 | Low |");
    expect(llmOutput).toContain("| `lowRiskFunc` | `src/low.ts` | 1 | 100.0% | 1.0 | Low |");
  });

  it("does not render CRAP report when crapEntries is empty", () => {
    const emptyCrapResult: AntiSlopResult = {
      ...sampleResult,
      crapEntries: [],
    };

    const termOutput = formatOutput(emptyCrapResult, "terminal");
    expect(termOutput).not.toContain("CRAP Report");

    const llmOutput = formatOutput(emptyCrapResult, "llm");
    expect(llmOutput).not.toContain("## CRAP");
  });
  it("formats mutation metrics with green for passing and red for failing", () => {
    const passMetricsResult: AntiSlopResult = {
      ...sampleResult,
      mutationMetrics: {
        total: 100,
        killed: 85,
        survived: 10,
        noCoverage: 5,
        timeout: 0,
        compileErrors: 0,
        runtimeErrors: 0,
        score: 85.0,
      },
    };

    const passTerm = formatOutput(passMetricsResult, "terminal");
    expect(passTerm).toContain("Mutation Score: \x1b[32m\x1b[1m85.0%\x1b[0m (85 killed, 10 survived, 5 uncovered, 0 timeout)");

    const passLlm = formatOutput(passMetricsResult, "llm");
    expect(passLlm).toContain("**Mutation Score:** 85.0% (85 killed, 10 survived, 5 uncovered, 0 timeout)");

    const failMetricsResult: AntiSlopResult = {
      ...sampleResult,
      mutationMetrics: {
        total: 50,
        killed: 30,
        survived: 15,
        noCoverage: 5,
        timeout: 0,
        compileErrors: 0,
        runtimeErrors: 0,
        score: 60.0,
      },
    };

    const failTerm = formatOutput(failMetricsResult, "terminal");
    expect(failTerm).toContain("Mutation Score: \x1b[31m\x1b[1m60.0%\x1b[0m (30 killed, 15 survived, 5 uncovered, 0 timeout)");

    const exactThresholdResult: AntiSlopResult = {
      ...sampleResult,
      mutationMetrics: {
        total: 10,
        killed: 8,
        survived: 2,
        noCoverage: 0,
        timeout: 0,
        compileErrors: 0,
        runtimeErrors: 0,
        score: 80.0,
      },
    };
    const exactTerm = formatOutput(exactThresholdResult, "terminal");
    expect(exactTerm).toContain("Mutation Score: \x1b[32m\x1b[1m80.0%\x1b[0m (8 killed, 2 survived, 0 uncovered, 0 timeout)");
  });

  it("groups multiple findings under the same file in terminal output", () => {
    const multiFindingResult: AntiSlopResult = {
      targetDir: "/test/multi",
      totalFilesChecked: 1,
      passed: false,
      durationMs: 30,
      findings: [
        {
          check: "lint",
          rule: "no-var",
          severity: "error",
          message: "Unexpected var, use let or const.",
          file: "src/app.ts",
          line: 2,
          column: 1,
        },
        {
          check: "lint",
          rule: "eqeqeq",
          severity: "warning",
          message: "Expected === instead of ==.",
          file: "src/app.ts",
          line: 10,
          column: 5,
        },
      ],
    };

    const term = formatOutput(multiFindingResult, "terminal");
    // File header should appear only once
    const occurrences = term.split("src/app.ts").length - 1;
    expect(occurrences).toBe(1);
    expect(term).toContain("2:1");
    expect(term).toContain("10:5");
    expect(term).toContain("✖ Found 1 error(s), 1 warning(s)");
  });
});
