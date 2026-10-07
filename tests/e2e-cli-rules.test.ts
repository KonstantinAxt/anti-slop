import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import * as path from "node:path";
const CLI_PATH = path.resolve(import.meta.dir, "../bin/anti-slop");
const WORKSPACE_ROOT = path.resolve(import.meta.dir, "..");

interface CliResult {
  stdout: string;
  stderr: string;
  status: number;
  json?: {
    passed: boolean;
    findings: Array<{
      check: string;
      rule: string;
      severity: string;
      message: string;
      file: string;
    }>;
    totalFilesChecked: number;
  };
}

function runCli(args: string[], options: { cwd?: string } = {}): CliResult {
  const cwd = options.cwd || WORKSPACE_ROOT;
  return runCliSubprocess(args, cwd);
}

function runCliSubprocess(args: string[], cwd: string): CliResult {
  const cmd = `node "${CLI_PATH}" ${args.map((arg) => `"${arg}"`).join(" ")}`;
  try {
    const stdout = execSync(cmd, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    let json: CliResult["json"];
    if (args.includes("--json")) {
      try { json = JSON.parse(stdout); } catch (parseErr: unknown) { void parseErr; }
    }
    const result: CliResult = { stdout, stderr: "", status: 0 };
    if (json !== undefined) result.json = json;
    return result;
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    const stdout = execErr.stdout?.toString() || "";
    const stderr = execErr.stderr?.toString() || "";
    const status = execErr.status ?? 1;
    let json: CliResult["json"];
    if (args.includes("--json") && stdout) {
      try { json = JSON.parse(stdout); } catch (parseErr: unknown) { void parseErr; }
    }
    const result: CliResult = { stdout, stderr, status };
    if (json !== undefined) result.json = json;
    return result;
  }
}

function assertCliRuleHits(
  args: string[],
  expectedRules: string[],
  options: { cwd?: string; expectedStatus?: number; expectedPassed?: boolean } = {},
): CliResult {
  const result = runCli(args, options);
  const expectedStatus = options.expectedStatus ?? 1;

  expect(result.status).toBe(expectedStatus);

  if (options.expectedPassed !== undefined) {
    expect(result.json?.passed).toBe(options.expectedPassed);
  }

  const rules = result.json?.findings.map((finding) => finding.rule) || [];

  for (const expectedRule of expectedRules) {
    expect(rules).toContain(expectedRule);
  }

  return result;
}

function assertCliClean(fixturePath: string): void {
  const result = runCli(["--json", fixturePath]);

  expect(result.status).toBe(0);
  expect(result.json?.passed).toBe(true);
  expect(result.json?.findings).toEqual([]);
}

describe("E2E CLI Rules Suite across All Checks", () => {
  describe("Strict TypeScript Rules", () => {
    it("detects strict-mode in tsconfig.json via CLI sandbox", () => {
      const sandbox = path.join(WORKSPACE_ROOT, "e2e-fixtures/strict-ts/strict-mode-fail");

      assertCliRuleHits(["--json"], ["strict-mode"], { cwd: sandbox, expectedPassed: false });
    }, 30000);

    it("detects no-unchecked-indexed-access in tsconfig.json via CLI sandbox", () => {
      const sandbox = path.join(WORKSPACE_ROOT, "e2e-fixtures/strict-ts/unchecked-indexed-fail");

      assertCliRuleHits(["--json"], ["no-unchecked-indexed-access"], { cwd: sandbox, expectedPassed: false });
    }, 30000);

    it("detects exact-optional-property-types warning in tsconfig.json via CLI sandbox", () => {
      const sandbox = path.join(WORKSPACE_ROOT, "e2e-fixtures/strict-ts/exact-optional-fail");

      assertCliRuleHits(["--json"], ["exact-optional-property-types"], { cwd: sandbox, expectedStatus: 0, expectedPassed: true });
    }, 30000);

    it("detects non-null assertion and explicit any syntax in syntax-violations.ts", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/strict-ts/syntax-violations.ts"], [
        "no-non-null-assertion",
        "no-explicit-any",
      ]);
    }, 30000);

    it("detects all semantic strict-ts program checker rules in semantic-violations.ts", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/strict-ts/semantic-violations.ts"], [
        "no-implicit-any",
        "strict-null-checks",
        "strict-property-initialization",
        "no-implicit-this",
        "no-unused-locals",
        "exact-optional-property-types",
        "no-unchecked-indexed-access",
      ]);
    }, 30000);
  });

  describe("Architectural Boundaries Rules", () => {
    it("detects ui-free-service, mock-leak, and isolated-utils in boundaries directory", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/boundaries/"], [
        "ui-free-service",
        "mock-leak",
        "isolated-utils",
      ]);
    }, 30000);
  });

  describe("Fractal Architecture Framework Rules", () => {
    it("detects no-direct-fragment-import, peer-isolation, no-upward-dependency, and no-private-leak", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/fractal/"], [
        "no-direct-fragment-import",
        "peer-isolation",
        "no-upward-dependency",
        "no-private-leak",
      ]);
    }, 30000);
  });

  describe("Codebase Scars Rules", () => {
    it("detects no-service-rounding, no-empty-catch, no-unvalidated-api-cast, no-trivial-object-wrapper, and no-async-array-callback", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/scars/"], [
        "no-service-rounding",
        "no-empty-catch",
        "no-unvalidated-api-cast",
        "no-trivial-object-wrapper",
        "no-async-array-callback",
      ]);
    }, 30000);
  });

  describe("Hollow Tests Rules", () => {
    it("detects focused test, missing assertion, hollow assertions, calculation, sleep, and test logic", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/hollow-tests/src/suite.test.ts"], [
        "no-focused-test",
        "missing-assertion",
        "hollow-call-assertion",
        "hollow-shape-assertion",
        "tautological-assertion",
        "no-assertion-calculation",
        "no-static-sleep",
        "no-logic-in-test",
      ]);
    }, 30000);

    it("detects focused test in Cypress fixture TodoList.cy.ts via CLI", () => {
      assertCliRuleHits(
        ["--json", "e2e-fixtures/hollow-tests/cypress/workflows/TodoList.cy.ts"],
        ["no-focused-test"],
        { expectedStatus: 1, expectedPassed: false },
      );
    }, 30000);

    it("detects missing assertion in Cypress fixture TodoListAssertionFree.cy.ts via CLI", () => {
      assertCliRuleHits(
        ["--json", "e2e-fixtures/hollow-tests/cypress/workflows/TodoListAssertionFree.cy.ts"],
        ["missing-assertion"],
        { expectedStatus: 1, expectedPassed: false },
      );
    }, 30000);

    it("passes cleanly on Cypress fixture TodoListClean.cy.ts via CLI without false positives", () => {
      assertCliClean("e2e-fixtures/hollow-tests/cypress/workflows/TodoListClean.cy.ts");
    }, 30000);

    it("passes cleanly on Cypress fixture TodoListLookalike.cy.ts via CLI without false positives", () => {
      assertCliClean("e2e-fixtures/hollow-tests/cypress/workflows/TodoListLookalike.cy.ts");
    }, 30000);
  });

  describe("Stale Mocks Rules", () => {
    it("detects stale-mock-export in stale.test.ts", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/stale-mocks/"], ["stale-mock-export"]);
    }, 30000);
  });

  describe("Dead Code Rules", () => {
    it("detects unused-export and unused-file in dead-code directory", () => {
      assertCliRuleHits(
        ["--json", "e2e-fixtures/dead-code/"],
        ["unused-export", "unused-file"],
        { expectedStatus: 0, expectedPassed: true },
      );
    }, 30000);
  });

  describe("Code Duplication Rules", () => {
    it("detects duplicate-code across duplicate files via jscpd", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/duplication/"], ["duplicate-code"]);
    }, 20000);
  });

  describe("ESLint Bundled Rules", () => {
    it("detects all SonarJS rules in sonar.ts", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/eslint/sonar.ts"], [
        "sonarjs/cognitive-complexity",
        "sonarjs/no-identical-conditions",
        "sonarjs/no-duplicated-branches",
        "sonarjs/no-identical-expressions",
        "sonarjs/no-duplicate-string",
      ]);
    }, 30000);

    it("detects slop, naming, and type assertion rules in slop.ts", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/eslint/slop.ts"], [
        "no-warning-comments",
        "slop/no-jargon",
        "slop/no-trivial-type-aliases",
        "slop/no-static-only-class",
        "slop/no-trivial-functions",
        "id-length",
        "@typescript-eslint/consistent-type-assertions",
        "@typescript-eslint/no-magic-numbers",
        "slop/no-chained-type-assertions",
      ]);
    }, 30000);

    it("detects all Unicorn and De Morgan rules in unicorn-demorgan.ts", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/eslint/unicorn-demorgan.ts"], [
        "unicorn/no-single-promise-in-promise-methods",
        "unicorn/no-await-in-promise-methods",
        "unicorn/no-useless-fallback-in-spread",
        "unicorn/no-useless-length-check",
        "unicorn/no-negation-in-equality-check",
        "unicorn/no-invalid-fetch-options",
        "unicorn/prefer-logical-operator-over-ternary",
        "de-morgan/no-negated-conjunction",
        "de-morgan/no-negated-disjunction",
        "unicorn/no-useless-promise-resolve-reject",
      ]);
    }, 30000);

    it("detects barrel-files rules in barrel-export-all.ts and barrel-module", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/eslint/barrel-export-all.ts"], [
        "barrel-files/avoid-re-export-all",
      ]);

      assertCliRuleHits(
        ["--json", "e2e-fixtures/eslint/barrel-module/index.ts"],
        ["barrel-files/avoid-barrel-files"],
        { expectedStatus: 0, expectedPassed: true },
      );
    }, 30000);

    it("detects React, hooks, perf, effect, and compiler rules in react-components.tsx", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/eslint/react-components.tsx"], [
        "use-client/require-use-client",
        "react/no-direct-mutation-state",
        "react/jsx-key",
        "react/no-array-index-key",
        "react/no-unstable-nested-components",
        "react/jsx-no-constructed-context-values",
        "react/no-danger-with-children",
        "react/void-dom-elements-no-children",
        "react/jsx-no-useless-fragment",
        "react-hooks/rules-of-hooks",
        "react-hooks/exhaustive-deps",
        "react-hooks/immutability",
        "react-hooks/purity",
        "react-hooks/set-state-in-render",
        "react-perf/jsx-no-new-object-as-prop",
        "react-perf/jsx-no-new-array-as-prop",
        "react-perf/jsx-no-new-function-as-prop",
        "react-refresh/only-export-components",
        "@eslint-react/web-api-no-leaked-timeout",
        "@eslint-react/web-api-no-leaked-interval",
        "@eslint-react/web-api-no-leaked-event-listener",
        "@eslint-react/dom-no-dangerously-set-innerhtml-with-children",
        "@eslint-react/dom-no-void-elements-with-children",
        "react-you-might-not-need-an-effect/no-derived-state",
        "react-you-might-not-need-an-effect/no-chain-state-updates",
        "react-you-might-not-need-an-effect/no-adjust-state-on-prop-change",
      ]);
    }, 20000);

    it("detects accessibility rules in accessibility.tsx", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/eslint/accessibility.tsx"], [
        "jsx-a11y/alt-text",
        "jsx-a11y/aria-role",
      ]);
    }, 30000);

    it("detects vitest and test-smells rules in vitest-test-smells.test.ts", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/eslint/vitest-test-smells.test.ts"], [
        "vitest/no-conditional-in-test",
        "vitest/no-conditional-expect",
        "vitest/no-identical-title",
        "vitest/no-standalone-expect",
        "vitest/valid-expect",
        "vitest/prefer-called-with",
        "vitest/prefer-to-have-length",
        "vitest/padding-around-all",
        "test-smells/redundant-print",
        "test-smells/sleepy-test",
      ]);
    }, 30000);

    it("detects testing-library rules in testing-library.test.tsx", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/eslint/testing-library.test.tsx"], [
        "testing-library/no-node-access",
        "testing-library/no-container",
        "testing-library/prefer-screen-queries",
        "testing-library/prefer-presence-queries",
        "testing-library/await-async-queries",
        "testing-library/await-async-utils",
        "testing-library/no-await-sync-queries",
        "testing-library/no-unnecessary-act",
      ]);
    }, 30000);

    it("detects playwright rules in playwright/flow.test.ts", () => {
      assertCliRuleHits(["--json", "e2e-fixtures/eslint/playwright/flow.test.ts"], [
        "playwright/missing-playwright-await",
        "playwright/no-conditional-in-test",
        "playwright/no-element-handle",
        "playwright/no-eval",
        "playwright/prefer-web-first-assertions",
      ]);
    }, 30000);

    it("detects JSDoc rules in jsdoc.ts", () => {
      assertCliRuleHits(
        ["--json", "e2e-fixtures/eslint/jsdoc.ts"],
        [
          "jsdoc/check-alignment",
          "jsdoc/check-param-names",
          "jsdoc/check-property-names",
          "jsdoc/check-tag-names",
          "jsdoc/no-bad-blocks",
          "jsdoc/require-asterisk-prefix",
        ],
        { expectedStatus: 0, expectedPassed: true },
      );
    }, 30000);
  });

  describe("Clean Fixtures and CLI Flags Verification", () => {
    it("passes with exit code 0 and zero findings on clean test", () => {
      assertCliClean("e2e-fixtures/clean/clean.test.ts");
    }, 30000);

    it("formats markdown output when --llm is supplied", () => {
      const result = runCli(["--llm", "e2e-fixtures/strict-ts/syntax-violations.ts"]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("# Anti-AI Slop Review Findings");
      expect(result.stdout).toContain("no-non-null-assertion");
    }, 30000);

    it("supports --allow-loose-tsconfig to bypass tsconfig strictness errors", () => {
      const sandbox = path.join(WORKSPACE_ROOT, "e2e-fixtures/strict-ts/strict-mode-fail");
      const result = runCli(["--json", "--allow-loose-tsconfig"], { cwd: sandbox });

      expect(result.status).toBe(0);
      expect(result.json?.passed).toBe(true);

      const rules = result.json?.findings.map((finding) => finding.rule) || [];

      expect(rules).not.toContain("strict-mode");
    }, 30000);
  });

  describe("Default Discovery Scope", () => {
    it("discovers files in scripts directory by default without blanket exemption", () => {
      const result = runCli(["--json"]);

      expect(result.json?.totalFilesChecked).toBeGreaterThanOrEqual(45);
    }, 20000);
  });
});
