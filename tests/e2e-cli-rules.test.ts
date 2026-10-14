import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { runCli } from "../bin/cli.js";

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

async function runRuleCli(args: string[], options: { cwd?: string } = {}): Promise<CliResult> {
  const cwd = options.cwd || WORKSPACE_ROOT;
  const outcome = await runCli(args, cwd);
  const result: CliResult = { stdout: outcome.stdout, stderr: outcome.stderr, status: outcome.exitCode };
  if (args.includes("--json") && outcome.stdout) {
    try {
      result.json = JSON.parse(outcome.stdout);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }

  return result;
}

async function assertCliRuleHits(
  args: string[],
  expectedRules: string[],
  options: { cwd?: string; expectedStatus?: number; expectedPassed?: boolean } = {},
): Promise<CliResult> {
  const result = await runRuleCli(args, options);
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

async function assertCliClean(fixturePath: string): Promise<void> {
  const result = await runRuleCli(["--json", fixturePath]);

  expect(result.status).toBe(0);
  expect(result.json?.passed).toBe(true);
  expect(result.json?.findings).toEqual([]);
}

describe("E2E CLI Rules Suite across All Checks", () => {
  describe("Strict TypeScript Rules", () => {
    it("detects strict-mode in tsconfig.json via CLI sandbox", async () => {
      const sandbox = path.join(WORKSPACE_ROOT, "e2e-fixtures/strict-ts/strict-mode-fail");

      await assertCliRuleHits(["--json"], ["strict-mode"], { cwd: sandbox, expectedPassed: false });
    });

    it("detects no-unchecked-indexed-access in tsconfig.json via CLI sandbox", async () => {
      const sandbox = path.join(WORKSPACE_ROOT, "e2e-fixtures/strict-ts/unchecked-indexed-fail");

      await assertCliRuleHits(["--json"], ["no-unchecked-indexed-access"], { cwd: sandbox, expectedPassed: false });
    });

    it("detects exact-optional-property-types warning in tsconfig.json via CLI sandbox", async () => {
      const sandbox = path.join(WORKSPACE_ROOT, "e2e-fixtures/strict-ts/exact-optional-fail");

      await assertCliRuleHits(["--json"], ["exact-optional-property-types"], { cwd: sandbox, expectedStatus: 0, expectedPassed: true });
    });

    it("detects non-null assertion and explicit any syntax in syntax-violations.ts", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/strict-ts/syntax-violations.ts"], [
        "no-non-null-assertion",
        "no-explicit-any",
      ]);
    });

    it("detects all semantic strict-ts program checker rules in semantic-violations.ts", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/strict-ts/semantic-violations.ts"], [
        "no-implicit-any",
        "strict-null-checks",
        "strict-property-initialization",
        "no-implicit-this",
        "no-unused-locals",
        "exact-optional-property-types",
        "no-unchecked-indexed-access",
      ]);
    });
  });

  describe("Architectural Boundaries Rules", () => {
    it("detects ui-free-service, mock-leak, and isolated-utils in boundaries directory", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/boundaries/"], [
        "ui-free-service",
        "mock-leak",
        "isolated-utils",
      ]);
    });
  });

  describe("Fractal Architecture Framework Rules", () => {
    it("detects no-direct-fragment-import, peer-isolation, no-upward-dependency, and no-private-leak", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/fractal/"], [
        "no-direct-fragment-import",
        "peer-isolation",
        "no-upward-dependency",
        "no-private-leak",
      ]);
    });
  });

  describe("Codebase Scars Rules", () => {
    it("detects no-service-rounding, no-empty-catch, no-unvalidated-api-cast, no-trivial-object-wrapper, and no-async-array-callback", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/scars/"], [
        "no-service-rounding",
        "no-empty-catch",
        "no-unvalidated-api-cast",
        "no-trivial-object-wrapper",
        "no-async-array-callback",
      ]);
    });
  });

  describe("Hollow Tests Rules", () => {
    it("detects focused test, missing assertion, hollow assertions, calculation, sleep, and test logic", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/hollow-tests/src/suite.test.ts"], [
        "no-focused-test",
        "missing-assertion",
        "hollow-call-assertion",
        "hollow-shape-assertion",
        "tautological-assertion",
        "no-assertion-calculation",
        "no-static-sleep",
        "no-logic-in-test",
      ]);
    });

    it("detects focused test in Cypress fixture TodoList.cy.ts via CLI", async () => {
      await assertCliRuleHits(
        ["--json", "e2e-fixtures/hollow-tests/cypress/workflows/TodoList.cy.ts"],
        ["no-focused-test"],
        { expectedStatus: 1, expectedPassed: false },
      );
    });

    it("detects missing assertion in Cypress fixture TodoListAssertionFree.cy.ts via CLI", async () => {
      await assertCliRuleHits(
        ["--json", "e2e-fixtures/hollow-tests/cypress/workflows/TodoListAssertionFree.cy.ts"],
        ["missing-assertion"],
        { expectedStatus: 1, expectedPassed: false },
      );
    });

    it("passes cleanly on Cypress fixture TodoListClean.cy.ts via CLI without false positives", async () => {
      await assertCliClean("e2e-fixtures/hollow-tests/cypress/workflows/TodoListClean.cy.ts");
    });

    it("passes cleanly on Cypress fixture TodoListLookalike.cy.ts via CLI without false positives", async () => {
      await assertCliClean("e2e-fixtures/hollow-tests/cypress/workflows/TodoListLookalike.cy.ts");
    });
  });

  describe("Stale Mocks Rules", () => {
    it("detects stale-mock-export in stale.test.ts", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/stale-mocks/"], ["stale-mock-export"]);
    });
  });

  describe("Dead Code Rules", () => {
    it("detects unused-export and unused-file in dead-code directory", async () => {
      await assertCliRuleHits(
        ["--json", "e2e-fixtures/dead-code/"],
        ["unused-export", "unused-file"],
        { expectedStatus: 0, expectedPassed: true },
      );
    });
  });

  describe("Code Duplication Rules", () => {
    it("detects duplicate-code across duplicate files via jscpd", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/duplication/"], ["duplicate-code"]);
    });
  });

  describe("ESLint Bundled Rules", () => {
    it("detects all SonarJS rules in sonar.ts", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/eslint/sonar.ts"], [
        "sonarjs/cognitive-complexity",
        "sonarjs/no-identical-conditions",
        "sonarjs/no-duplicated-branches",
        "sonarjs/no-identical-expressions",
        "sonarjs/no-duplicate-string",
      ]);
    });

    it("detects slop, naming, and type assertion rules in slop.ts", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/eslint/slop.ts"], [
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
    });

    it("detects all Unicorn and De Morgan rules in unicorn-demorgan.ts", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/eslint/unicorn-demorgan.ts"], [
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
    });

    it("detects barrel-files rules in barrel-export-all.ts and barrel-module", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/eslint/barrel-export-all.ts"], [
        "barrel-files/avoid-re-export-all",
      ]);

      await assertCliRuleHits(
        ["--json", "e2e-fixtures/eslint/barrel-module/index.ts"],
        ["barrel-files/avoid-barrel-files"],
        { expectedStatus: 0, expectedPassed: true },
      );
    });

    it("detects React, hooks, perf, effect, and compiler rules in react-components.tsx", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/eslint/react-components.tsx"], [
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
    });

    it("detects accessibility rules in accessibility.tsx", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/eslint/accessibility.tsx"], [
        "jsx-a11y/alt-text",
        "jsx-a11y/aria-role",
      ]);
    });

    it("detects vitest and test-smells rules in vitest-test-smells.test.ts", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/eslint/vitest-test-smells.test.ts"], [
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
    });

    it("detects testing-library rules in testing-library.test.tsx", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/eslint/testing-library.test.tsx"], [
        "testing-library/no-node-access",
        "testing-library/no-container",
        "testing-library/prefer-screen-queries",
        "testing-library/prefer-presence-queries",
        "testing-library/await-async-queries",
        "testing-library/await-async-utils",
        "testing-library/no-await-sync-queries",
        "testing-library/no-unnecessary-act",
      ]);
    });

    it("detects playwright rules in playwright/flow.test.ts", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/eslint/playwright/flow.test.ts"], [
        "playwright/missing-playwright-await",
        "playwright/no-conditional-in-test",
        "playwright/no-element-handle",
        "playwright/no-eval",
        "playwright/prefer-web-first-assertions",
      ]);
    });

    it("detects JSDoc rules in jsdoc.ts", async () => {
      await assertCliRuleHits(
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
    });

    it("detects redundant presence checks in presence-check-invalid.ts", async () => {
      await assertCliRuleHits(["--json", "e2e-fixtures/eslint/presence-check-invalid.ts"], [
        "slop/no-redundant-presence-check",
      ]);
    });
  });

  describe("Clean Fixtures and CLI Flags Verification", () => {
    it("passes with exit code 0 and zero findings on clean test", async () => {
      await assertCliClean("e2e-fixtures/clean/clean.test.ts");
    });

    it("passes with exit code 0 and zero findings on clean presence check fixture", async () => {
      await assertCliClean("e2e-fixtures/clean/clean-presence-check.test.ts");
    });

    it("formats markdown output when --llm is supplied", async () => {
      const result = await runRuleCli(["--llm", "e2e-fixtures/strict-ts/syntax-violations.ts"]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("# Anti-AI Slop Review Findings");
      expect(result.stdout).toContain("no-non-null-assertion");
    });

    it("supports --allow-loose-tsconfig to bypass tsconfig strictness errors", async () => {
      const sandbox = path.join(WORKSPACE_ROOT, "e2e-fixtures/strict-ts/strict-mode-fail");
      const result = await runRuleCli(["--json", "--allow-loose-tsconfig"], { cwd: sandbox });

      expect(result.status).toBe(0);
      expect(result.json?.passed).toBe(true);

      const rules = result.json?.findings.map((finding) => finding.rule) || [];

      expect(rules).not.toContain("strict-mode");
    });
  });

  describe("Default Discovery Scope", () => {
    it("discovers files in scripts directory by default without blanket exemption", async () => {
      const result = await runRuleCli(["--json"]);

      expect(result.json?.totalFilesChecked).toBeGreaterThanOrEqual(45);
    });
  });
});
