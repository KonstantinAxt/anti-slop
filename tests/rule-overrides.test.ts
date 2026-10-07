import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runAntiSlop } from "../src/index.js";
import {
  applyRepoRuleGuard,
  getRepoOverrideForRule,
  getRepoRulesForFile,
  loadRepoConfig,
  type RepoConfig,
} from "../src/rule-overrides.js";
import type { Finding } from "../src/types.js";

describe("Repository Rule Priority Guard", () => {
  it("resolves direct rule overrides correctly", () => {
    const rules = {
      "react/no-array-index-key": "off",
      "no-warning-comments": 0,
      "sonarjs/no-identical-conditions": "warn",
      "react-perf/jsx-no-new-object-as-prop": "error",
      "array-callback-return": "off",
      "slop/no-env-shell-command": "off",
    };

    expect(getRepoOverrideForRule(rules, "react/no-array-index-key")?.severity).toBe("off");
    expect(getRepoOverrideForRule(rules, "no-warning-comments")?.severity).toBe("off");
    expect(getRepoOverrideForRule(rules, "sonarjs/no-identical-conditions")?.severity).toBe("warning");
    expect(getRepoOverrideForRule(rules, "react-perf/jsx-no-new-object-as-prop")?.severity).toBe("error");
    expect(getRepoOverrideForRule(rules, "array-callback-return")?.severity).toBe("off");
    expect(getRepoOverrideForRule(rules, "slop/no-env-shell-command")?.severity).toBe("off");
    expect(getRepoOverrideForRule(rules, "react/jsx-key")).toBeNull();
  });

  it("resolves rule aliases between ESLint and dedicated anti-slop checks", () => {
    const rules = {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-unused-vars": "off",
      "boundaries/element-types": "off",
      "vitest/expect-expect": "off",
    };

    expect(getRepoOverrideForRule(rules, "no-explicit-any")?.severity).toBe("off");
    expect(getRepoOverrideForRule(rules, "no-non-null-assertion")?.severity).toBe("warning");
    expect(getRepoOverrideForRule(rules, "no-unused-locals")?.severity).toBe("off");
    expect(getRepoOverrideForRule(rules, "@typescript-eslint/no-unused-vars")?.severity).toBe("off");
    expect(getRepoOverrideForRule(rules, "boundaries/layer-boundary-violation")?.severity).toBe("off");
    expect(getRepoOverrideForRule(rules, "hollow-tests/hollow-call-assertion")?.severity).toBe("off");
  });

  it("suppresses findings when repository rule is set to off", () => {
    const findings: Finding[] = [
      {
        check: "react",
        rule: "react/no-array-index-key",
        severity: "warning",
        message: "Do not use Array index in keys",
        file: "src/List.tsx",
        line: 5,
        column: 10,
      },
      {
        check: "strict-ts",
        rule: "no-explicit-any",
        severity: "error",
        message: "Unexpected any",
        file: "src/service.ts",
        line: 10,
        column: 5,
      },
      {
        check: "react",
        rule: "react/jsx-key",
        severity: "error",
        message: "Missing key",
        file: "src/List.tsx",
        line: 12,
        column: 5,
      },
    ];

    const repoRules = {
      "react/no-array-index-key": "off",
      "@typescript-eslint/no-explicit-any": "off",
    };

    const guarded = applyRepoRuleGuard(findings, repoRules);

    expect(guarded.length).toBe(1);
    expect(guarded[0]?.rule).toBe("react/jsx-key");
  });

  it("suppresses both unused-vars and no-unused-locals when no-unused-locals is set to off (#105)", () => {
    const findings: Finding[] = [
      {
        check: "@typescript-eslint",
        rule: "@typescript-eslint/no-unused-vars",
        severity: "warning",
        message: "'x' is assigned a value but never used",
        file: "src/calc.ts",
        line: 2,
        column: 5,
      },
      {
        check: "strict-ts",
        rule: "no-unused-locals",
        severity: "warning",
        message: "'x' is declared but its value is never read",
        file: "src/calc.ts",
        line: 2,
        column: 5,
      },
      {
        check: "sonarjs",
        rule: "sonarjs/no-identical-conditions",
        severity: "error",
        message: "Identical condition",
        file: "src/calc.ts",
        line: 10,
        column: 5,
      },
    ];

    const repoRules = {
      "no-unused-locals": "off",
    };

    const guarded = applyRepoRuleGuard(findings, repoRules);

    expect(guarded).toHaveLength(1);

    expect(guarded.at(0)?.rule).toBe("sonarjs/no-identical-conditions");
  });

  it("adjusts finding severity to match repository priority", () => {
    const findings: Finding[] = [
      {
        check: "react-perf",
        rule: "react-perf/jsx-no-new-object-as-prop",
        severity: "warning",
        message: "Avoid inline object",
        file: "src/Component.tsx",
        line: 4,
        column: 5,
      },
      {
        check: "react",
        rule: "react/no-unstable-nested-components",
        severity: "error",
        message: "Unstable component",
        file: "src/Parent.tsx",
        line: 6,
        column: 5,
      },
    ];

    const repoRules = {
      "react-perf/jsx-no-new-object-as-prop": "error",
      "react/no-unstable-nested-components": "warn",
    };

    const guarded = applyRepoRuleGuard(findings, repoRules);

    expect(guarded.find((f) => f.rule === "react-perf/jsx-no-new-object-as-prop")?.severity).toBe("error");
    expect(guarded.find((f) => f.rule === "react/no-unstable-nested-components")?.severity).toBe("warning");
  });

  it("respects custom cognitive complexity threshold from repository options", () => {
    const findings: Finding[] = [
      {
        check: "sonarjs",
        rule: "sonarjs/cognitive-complexity",
        severity: "warning",
        message: "Function has a cognitive complexity of 18 (commands/threshold: 15)",
        file: "src/parser.ts",
        line: 10,
        column: 1,
      },
      {
        check: "sonarjs",
        rule: "sonarjs/cognitive-complexity",
        severity: "warning",
        message: "Function has a cognitive complexity of 32 (commands/threshold: 15)",
        file: "src/complex.ts",
        line: 20,
        column: 1,
      },
    ];

    const repoRules = {
      "sonarjs/cognitive-complexity": ["warn", 25],
    };

    const guarded = applyRepoRuleGuard(findings, repoRules);

    expect(guarded.length).toBe(1);
    expect(guarded[0]?.file).toBe("src/complex.ts");
  });

  it("applies file pattern overrides to targeted files only", () => {
    const config: RepoConfig = {
      globalRules: {
        "react/no-array-index-key": "error",
      },
      fileOverrides: [
        {
          files: ["src/legacy/**"],
          rules: {
            "react/no-array-index-key": "off",
          },
        },
      ],
    };

    const legacyRules = getRepoRulesForFile(config, "src/legacy/Table.tsx");
    const modernRules = getRepoRulesForFile(config, "src/features/Table.tsx");

    expect(legacyRules["react/no-array-index-key"]).toBe("off");
    expect(modernRules["react/no-array-index-key"]).toBe("error");
  });

  it("loads repository rules from .eslintrc.json and package.json", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repo-guard-unit-"));

    try {
      fs.writeFileSync(
        path.join(tmp, ".eslintrc.json"),
        JSON.stringify({
          rules: {
            "react/no-array-index-key": "off",
          },
          overrides: [
            {
              files: ["**/*.test.ts"],
              rules: {
                "sonarjs/cognitive-complexity": "off",
              },
            },
          ],
        }),
      );

      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({
          name: "test-repo",
          "anti-slop": {
            rules: {
              "no-explicit-any": "off",
            },
          },
        }),
      );

      const loaded = await loadRepoConfig(tmp);

      expect(loaded.globalRules["react/no-array-index-key"]).toBe("off");
      expect(loaded.globalRules["no-explicit-any"]).toBe("off");
      expect(loaded.fileOverrides.length).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it("suppresses violations end-to-end when repository disables the rule", async () => {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-guard-e2e-"));

    try {
      fs.mkdirSync(path.join(sandboxDir, "src"), { recursive: true });

      // tsconfig
      fs.writeFileSync(
        path.join(sandboxDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noUncheckedIndexedAccess: true,
          },
        }),
      );

      // Component with array index key
      fs.writeFileSync(
        path.join(sandboxDir, "src/List.tsx"),
        `
        import React from "react";
        export function List({ items }: { items: string[] }) {
          return (
            <ul>
              {items.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          );
        }
        `,
      );

      // Repository config disabling react/no-array-index-key
      fs.writeFileSync(
        path.join(sandboxDir, ".eslintrc.json"),
        JSON.stringify({
          rules: {
            "react/no-array-index-key": "off",
          },
        }),
      );

      const result = await runAntiSlop({ cwd: sandboxDir });

      const indexKeyFindings = result.findings.filter(
        (f) => f.rule === "react/no-array-index-key",
      );

      expect(indexKeyFindings.length).toBe(0);
      expect(result.passed).toBe(true);
    } finally {
      fs.rmSync(sandboxDir, { recursive: true });
    }
  });

  it("loads repository rules from flat config files (eslint.config.js)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repo-flat-config-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "eslint.config.js"),
        `export default [
          {
            rules: {
              "react/no-array-index-key": "off",
            },
          },
          {
            files: ["src/**/*.tsx"],
            ignores: ["**/*.test.tsx"],
            rules: {
              "react/jsx-key": "warn",
            },
          },
        ];`
      );

      const loaded = await loadRepoConfig(tmp);

      expect(loaded.globalRules["react/no-array-index-key"]).toBe("off");
      expect(loaded.fileOverrides.length).toBe(1);
      expect(loaded.fileOverrides[0]?.rules["react/jsx-key"]).toBe("warn");
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});
