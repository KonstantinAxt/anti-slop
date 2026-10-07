import { describe, expect, it } from "bun:test";
import { checkWithEslint } from "../src/checks/eslint-runner.js";


const USE_CLIENT_RULE = "use-client/require-use-client";
const REACT_PERF_NO_NEW_OBJECT = "react-perf/jsx-no-new-object-as-prop";

describe("ESLint Bundled Plugins Runner (sonarjs, effects, boundaries, vitest, slop, unicorn)", () => {
  it("catches identical conditions and branches via sonarjs", async () => {
    const code = `
      function testBranch(x: number) {
        if (x > 0) {
          return 1;
        } else if (x > 0) {
          return 1;
        }
        return 0;
      }
    `;

    const findings = await checkWithEslint("src/calc.ts", code);

    expect(findings.some((f) => f.rule.includes("sonarjs"))).toBe(true);
  });

  it("catches identical expressions via sonarjs/no-identical-expressions", async () => {
    const code = `
      function compute(a: number) {
        return a / a;
      }
    `;

    const findings = await checkWithEslint("src/compute.ts", code);

    expect(findings.some((f) => f.rule === "sonarjs/no-identical-expressions")).toBe(true);
  });

  it("throws when induced failure marker is present", async () => {
    const marker = ["__ANTI", "SLOP_INDUCED_ESLINT_FAILURE__"].join("_");

    await expect(
      checkWithEslint("src/test.ts", `/* ${marker} */`)
    ).rejects.toThrow("Induced ESLint checker execution failure");
  });

  it("warns on 'as' type casting via @typescript-eslint/consistent-type-assertions but allows 'as const'", async () => {
    const code = `
      interface User { id: string; }
      const raw = { id: "1" };
      const user = raw as User;
      const modes = ["dark", "light"] as const;
    `;

    const findings = await checkWithEslint("src/theme.ts", code);
    const typeAssertionFindings = findings.filter(
      (f) => f.rule === "@typescript-eslint/consistent-type-assertions"
    );

    expect(typeAssertionFindings.length).toBe(1);
    expect(typeAssertionFindings[0]?.severity).toBe("warning");
  });

  it.each([
    "tests/theme.test.ts",
    "src/mocks/handler.ts",
    "src/__mocks__/api.ts",
    "src/__fixtures__/user.ts",
    "src/snapshots/state.ts",
    "e2e/flow.spec.ts",
  ])("skips 'as' type casting warning in %s", async (testPath) => {
    const code = `
      interface User { id: string; }
      const raw = { id: "1" };
      const user = raw as User;
    `;

    const findings = await checkWithEslint(testPath, code);
    const typeAssertionFindings = findings.filter(
      (f) => f.rule === "@typescript-eslint/consistent-type-assertions"
    );

    expect(typeAssertionFindings.length).toBe(0);
  });

  it("catches unused variables via @typescript-eslint/no-unused-vars in source and test files", async () => {
    const code = `
      export function compute(a: number) {
        const unusedVariable = 42;

        return a + 1;
      }
    `;

    const findings = await checkWithEslint("tests/compute.perf.ts", code);

    const unusedFindings = findings.filter(
      (f) => f.rule === "@typescript-eslint/no-unused-vars"
    );

    expect(unusedFindings).toHaveLength(1);

    expect(unusedFindings.at(0)?.severity).toBe("warning");

    expect(unusedFindings.at(0)?.line).toBe(3);

    expect(unusedFindings.at(0)?.message).toContain("'unusedVariable' is assigned a value but never used");
  });

  it("catches duplicate test titles via vitest/no-identical-title", async () => {
    const code = `
      it("loads profile", () => {
        expect(1).toBe(1);
      });
      it("loads profile", () => {
        expect(2).toBe(2);
      });
    `;

    const findings = await checkWithEslint("tests/profile.test.ts", code);

    expect(findings.some((f) => f.rule === "vitest/no-identical-title")).toBe(true);
  });

  it("catches empty test titles via vitest/valid-title", async () => {
    const code = `
      it("", () => {
        expect(1).toBe(1);
      });
    `;

    const findings = await checkWithEslint("tests/empty-title.test.ts", code);

    expect(findings.some((f) => f.rule === "vitest/valid-title")).toBe(true);
  });

  it("catches element handle usage via playwright/no-element-handle", async () => {
    const code = `
      test("uses element handle", async ({ page }) => {
        const handle = await page.$("button");
        return handle;
      });
    `;

    const findings = await checkWithEslint("e2e/login.spec.ts", code);

    expect(findings.some((f) => f.rule === "playwright/no-element-handle")).toBe(true);
  });

  it("catches AI chained type assertions and static-only classes via slop", async () => {
    const code = `
      class CalculationHelper {
        static add(a: number, b: number): number {
          return a + b;
        }
      }
      export const value = "test" as unknown as number;
    `;

    const findings = await checkWithEslint("src/math.ts", code);

    expect(findings.some((f) => f.rule === "slop/no-static-only-class")).toBe(true);
    expect(findings.some((f) => f.rule === "slop/no-chained-type-assertions")).toBe(true);
  });

  it("allows chained type assertions in test files", async () => {
    const code = `
      export const mock = {} as unknown as { id: string };
    `;

    const findings = await checkWithEslint("tests/math.test.ts", code);

    expect(findings.some((f) => f.rule === "slop/no-chained-type-assertions")).toBe(false);
  });

  it("flags AI jargon in comments via slop/no-jargon", async () => {
    const code = `
      // We utilize a robust and comprehensive strategy
      export const compute = () => 42;
    `;

    const findings = await checkWithEslint("src/strategy.ts", code);

    expect(findings.some((f) => f.rule === "slop/no-jargon")).toBe(true);
  });

  it("flags child_process commands built from environment variables via slop/no-env-shell-command", async () => {
    const code = `
      import { exec, execSync, spawn, execFile } from "node:child_process";

      export function runExamples() {
        exec(\`\${process.env.ComSpec} /c dir\`);

        const cmd = process.env.SHELL;
        execSync(cmd);

        spawn(process.env.SHELL, ["-l"]);

        const shell = process.env.SHELL ?? "/bin/sh";
        execFile(shell, []);

        const { ComSpec } = process.env;
        exec(ComSpec);

        spawn("cmd", { shell: process.env.SHELL });

        spawn("sh", ["-c", process.env.COMMAND], { shell: true });

        const opts = { cmd: process.env.SHELL };
        exec(opts.cmd);
      }
    `;

    const findings = await checkWithEslint("src/runner.ts", code);
    const envFindings = findings.filter((f) => f.rule === "slop/no-env-shell-command");

    expect(envFindings.length).toBe(8);
  });

  it("does not flag interprocedural patterns that require data-flow analysis", async () => {
    const code = `
      import { spawnSync } from "node:child_process";

      export function getCommandInvocation(
        platform: string,
        command: string,
        args: string[],
        commandInterpreter = "cmd.exe"
      ) {
        if (platform === "win32") {
          return {
            command: commandInterpreter,
            args: ["/d", "/s", "/c", command, ...args],
          };
        }

        return { command, args };
      }

      export function runCommand(
        command: string,
        args: string[],
        platform = process.platform,
        commandInterpreter = process.env.ComSpec ?? "cmd.exe"
      ) {
        const invocation = getCommandInvocation(platform, command, args, commandInterpreter);
        const result = spawnSync(invocation.command, invocation.args, {
          stdio: "inherit",
        });

        return result;
      }
    `;

    const findings = await checkWithEslint("scripts/npm-auth-refresh.mjs", code);
    const envFindings = findings.filter((f) => f.rule === "slop/no-env-shell-command");

    expect(envFindings.length).toBe(0);
  });

  it("allows safe child_process invocations, local spawn, and non-child_process objects", async () => {
    const code = `
      import { exec, execSync, spawn, execFile, execFileSync } from "node:child_process";

      export function runSafe() {
        exec("ls -la");

        execSync("npm test");

        spawn("node", ["server.js"]);

        execFile("git", ["status"]);

        execFileSync("node", ["--version"]);

        spawn("git", ["status"], { env: process.env });

        exec("npm test", { env: { ...process.env, CI: "true" } });

        execFile("git", ["commit", "-m", process.env.COMMIT_MSG]);

        spawn("echo", [process.env.USER]);

        const pattern = /test/;
        pattern.exec(process.env.INPUT_VAL ?? "");

        function localSpawn(cmd: string) {
          return cmd;
        }
        localSpawn(process.env.SHELL ?? "");

        const docker = {
          spawn(cmd: string) {
            return cmd;
          },
        };
        docker.spawn(process.env.SHELL ?? "");
      }
    `;

    const findings = await checkWithEslint("src/safe-runner.ts", code);
    const envFindings = findings.filter((f) => f.rule === "slop/no-env-shell-command");

    expect(envFindings.length).toBe(0);
  });

  it("flags destructured CommonJS require calls via slop/no-env-shell-command", async () => {
    const code = `
      const { execSync: runSync } = require("node:child_process");

      export function runRequire() {
        const cmd = process.env.SHELL ?? "/bin/sh";
        runSync(cmd);
      }
    `;

    const findings = await checkWithEslint("src/require-runner.ts", code);
    const envFindings = findings.filter((f) => f.rule === "slop/no-env-shell-command");

    expect(envFindings.length).toBe(1);
  });

  it("catches async defects and useless spread fallbacks via unicorn", async () => {
    const code = `
      export async function runAll(tasks: Promise<void>[]) {
        await Promise.all([await tasks[0]]);
      }
      export function mergeObjects(a: Record<string, string>, b?: Record<string, string>) {
        return { ...a, ...(b || {}) };
      }
    `;

    const findings = await checkWithEslint("src/tasks.ts", code);

    expect(findings.some((f) => f.rule === "unicorn/no-await-in-promise-methods")).toBe(true);
    expect(findings.some((f) => f.rule === "unicorn/no-useless-fallback-in-spread")).toBe(true);
  });

  it("flags unnecessary 'use client' directive on server-compatible components", async () => {
    const code = `
      "use client";
      import React from "react";
      export const CalendarLink = () => <div>Calendar</div>;
    `;

    const findings = await checkWithEslint("src/components/CalendarLink.tsx", code);

    expect(findings.some((f) => f.rule === USE_CLIENT_RULE)).toBe(true);

    const finding = findings.find((f) => f.rule === USE_CLIENT_RULE);

    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("does not use any client-only React feature");
    expect(finding?.suggestion).toContain("Remove 'use client'");
  });

  it("flags unnecessary 'use client' on .ts files as warning", async () => {
    const code = `
      "use client";
      export const helper = (x: number) => x * 2;
    `;

    const findings = await checkWithEslint("src/utils/math.ts", code);
    const finding = findings.find((f) => f.rule === USE_CLIENT_RULE);

    expect(finding?.rule).toBe(USE_CLIENT_RULE);
    expect(finding?.severity).toBe("warning");
  });

  it("flags AI test plan and scratchpad comments", async () => {
    const code = `
      // Test plan: spd/calendar-parity-plan.md - CAL-20; supports CAL-01, CAL-02.
      export const value = 42;
    `;

    const findings = await checkWithEslint("src/features/__tests__/item.test.ts", code);

    expect(findings.some((f) => f.rule === "no-warning-comments")).toBe(true);

    const finding = findings.find((f) => f.rule === "no-warning-comments");

    expect(finding?.message).toContain("Unexpected 'test plan' comment");
  });

  it("does not flag em dashes in comments", async () => {
    const code = `
      // Feature rollout \u2014 calendar phase 2
      export const enabled = true;
    `;

    const findings = await checkWithEslint("src/features/config.ts", code);
    const rules = findings.map((finding) => finding.rule);

    expect(rules).not.toContain("slop/no-em-dash");
  });

  it("allows test files to access DOM globals without requiring 'use client'", async () => {
    const code = `
      export function testDom() {
        const el = document.getElementById("root");
        return el?.innerHTML;
      }
    `;

    const findings = await checkWithEslint("src/__tests__/dom.test.ts", code);

    expect(findings.some((f) => f.rule === USE_CLIENT_RULE)).toBe(false);
  });

  it("flags wildcard re-exports via barrel-files/avoid-re-export-all", async () => {
    const code = `
      export * from "./Button.js";
    `;

    const findings = await checkWithEslint("src/components/index.ts", code);

    expect(findings.some((f) => f.rule === "barrel-files/avoid-re-export-all")).toBe(true);

    const finding = findings.find((f) => f.rule === "barrel-files/avoid-re-export-all");

    expect(finding?.severity).toBe("error");
    expect(finding?.why).toContain("tree-shaking");
  });

  it("warns on barrel files with excessive re-exports via barrel-files/avoid-barrel-files", async () => {
    const code = `
      export { a } from "./a.js";
      export { b } from "./b.js";
      export { c } from "./c.js";
      export { d } from "./d.js";
      export { e } from "./e.js";
      export { f } from "./f.js";
    `;
    const findings = await checkWithEslint("src/components/index.ts", code);

    expect(findings.some((f) => f.rule === "barrel-files/avoid-barrel-files")).toBe(true);

    const finding = findings.find((f) => f.rule === "barrel-files/avoid-barrel-files");

    expect(finding?.severity).toBe("warning");
    expect(finding?.suggestion).toContain("Import directly from specific module paths");
  });

  it("warns on small barrel files with two re-exports via barrel-files/avoid-barrel-files", async () => {
    const smallBarrelSource = `
      export { Header } from "./Header.js";
      export { HeaderProps } from "./HeaderProps.js";
    `;
    const results = await checkWithEslint("src/components/header-barrel.ts", smallBarrelSource);
    const barrelFinding = results.find((item) => item.rule === "barrel-files/avoid-barrel-files");

    expect(barrelFinding?.rule).toBe("barrel-files/avoid-barrel-files");
    expect(barrelFinding?.severity).toBe("warning");
  });

  it("allows test files to use re-exports without barrel warnings", async () => {
    const code = `
      export * from "./test-fixtures.js";
    `;

    const findings = await checkWithEslint("src/__tests__/helpers.ts", code);

    expect(findings.some((f) => f.rule === "barrel-files/avoid-re-export-all")).toBe(false);
  });

  it("warns on missing empty line before return via @stylistic/padding-line-between-statements", async () => {
    const code = `
      export function testSpacing() {
        const a = 1;
        return a;
      }
    `;

    const findings = await checkWithEslint("src/utils.ts", code);

    expect(findings.some((f) => f.rule === "@stylistic/padding-line-between-statements")).toBe(true);
  });

  it("warns on missing blank line before expect via vitest/padding-around-all", async () => {
    const code = `
      import { it, expect } from "vitest";
      it("has no padding", () => {
        const a = 1;
        expect(a).toBe(1);
      });
    `;

    const findings = await checkWithEslint("src/__tests__/spacing.test.ts", code);

    expect(findings.some((f) => f.rule === "vitest/padding-around-all")).toBe(true);
  });

  it("flags direct node access in tests via testing-library/no-node-access", async () => {
    const code = `
      import { render } from "@testing-library/react";

      it("accesses children directly", () => {
        const { container } = render(<div />);

        expect(container.firstChild).toBeNull();
      });
    `;

    const findings = await checkWithEslint("src/__tests__/dom.test.tsx", code);

    expect(findings.some((f) => f.rule === "testing-library/no-node-access")).toBe(true);
  });

  it("warns on console.log in test files via test-smells/redundant-print", async () => {
    const code = `
      import { it, expect } from "vitest";
      it("prints debug log", () => {
        console.log("debugging test");
        expect(1).toBe(1);
      });
    `;

    const findings = await checkWithEslint("src/__tests__/print.test.ts", code);

    expect(findings.some((f) => f.rule === "test-smells/redundant-print")).toBe(true);
  });

  it("warns on setTimeout in test files via test-smells/sleepy-test", async () => {
    const code = `
      import { it, expect } from "vitest";
      it("sleeps in test", () => {
        setTimeout(() => {}, 100);
        expect(1).toBe(1);
      });
    `;

    const findings = await checkWithEslint("src/__tests__/sleep.test.ts", code);

    expect(findings.some((f) => f.rule === "test-smells/sleepy-test")).toBe(true);
  });

  it("flags unstable nested components via react/no-unstable-nested-components", async () => {
    const code = `
      import React from "react";

      export function Parent() {
        function Nested() {
          return <div>Nested</div>;
        }

        return <div><Nested /></div>;
      }
    `;

    const findings = await checkWithEslint("src/Parent.tsx", code);

    expect(findings.some((f) => f.rule === "react/no-unstable-nested-components")).toBe(true);
  });

  it("flags array index keys via react/no-array-index-key", async () => {
    const code = `
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
    `;

    const findings = await checkWithEslint("src/List.tsx", code);

    expect(findings.some((f) => f.rule === "react/no-array-index-key")).toBe(true);
  });

  it("flags conditional hook calls via react-hooks/rules-of-hooks", async () => {
    const code = `
      "use client";
      import React, { useEffect } from "react";

      export function BadHook({ flag }: { flag: boolean }) {
        if (flag) {
          useEffect(() => {}, []);
        }

        return <div>Hook</div>;
      }
    `;

    const findings = await checkWithEslint("src/BadHook.tsx", code);

    expect(findings.some((f) => f.rule === "react-hooks/rules-of-hooks")).toBe(true);
  });

  it("flags inline object props via react-perf/jsx-no-new-object-as-prop", async () => {
    const code = `
      import React from "react";

      declare const Card: React.ComponentType<{ options: { color: string } }>;

      export function Perf({ title }: { title: string }) {
        return <Card options={{ color: "red" }}>{title}</Card>;
      }
    `;

    const findings = await checkWithEslint("src/Perf.tsx", code);

    expect(findings.some((f) => f.rule === REACT_PERF_NO_NEW_OBJECT)).toBe(true);
  });

  it("flags leaked timers in effects via @eslint-react/web-api-no-leaked-interval", async () => {
    const code = `
      "use client";
      import React, { useEffect } from "react";

      export function Timer() {
        useEffect(() => {
          setInterval(() => {}, 1000);
        }, []);

        return <div>Timer</div>;
      }
    `;

    const findings = await checkWithEslint("src/Timer.tsx", code);

    expect(findings.some((f) => f.rule === "@eslint-react/web-api-no-leaked-interval")).toBe(true);
  });

  it("does not force JSDoc comments on clean exported functions", async () => {
    const code = `
      export function useActiveEventId(): string | undefined {
        return undefined;
      }
    `;

    const findings = await checkWithEslint("src/hooks/useActiveEventId.ts", code);

    expect(findings.some((f) => f.rule === "jsdoc/require-jsdoc")).toBe(false);
  });

  it("allows exported functions with proper JSDoc comments", async () => {
    const code = `
      /**
       * Return the selected event identifier while the detail panel is open.
       *
       * @returns The selected event identifier or undefined.
       */
      export function useActiveEventId(): string | undefined {
        return undefined;
      }
    `;

    const findings = await checkWithEslint("src/hooks/useActiveEventId.ts", code);
    const jsdocFindings = findings.filter((f) => f.rule.startsWith("jsdoc/"));

    expect(jsdocFindings.length).toBe(0);
  });

  it("flags misaligned JSDoc comment blocks via jsdoc/check-alignment", async () => {
    const code = `
      /**
      * Misaligned asterisk in JSDoc block.
       */
      export function calculateTotal(a: number, b: number): number {
        return a + b;
      }
    `;

    const findings = await checkWithEslint("src/math.ts", code);

    expect(findings.some((f) => f.rule === "jsdoc/check-alignment")).toBe(true);
  });

  it("flags parameter name mismatches via jsdoc/check-param-names", async () => {
    const code = `
      /**
       * Add two numbers.
       *
       * @param x First number.
       * @param y Second number.
       * @returns The sum.
       */
      export function add(a: number, b: number): number {
        return a + b;
      }
    `;

    const findings = await checkWithEslint("src/calc.ts", code);

    expect(findings.some((f) => f.rule === "jsdoc/check-param-names")).toBe(true);
  });

  it("flags bad block comments that emulate JSDoc without double asterisks via jsdoc/no-bad-blocks", async () => {
    const code = `
      /*
       * Block comment with JSDoc tags using single asterisk.
       * @param a The parameter.
       */
      export function processItem(a: string): string {
        return a;
      }
    `;

    const findings = await checkWithEslint("src/item.ts", code);

    expect(findings.some((f) => f.rule === "jsdoc/no-bad-blocks")).toBe(true);
  });

  it("exempts test files from jsdoc/require-jsdoc", async () => {
    const code = `
      export function setupTestContext() {
        return { user: "test" };
      }
    `;

    const findings = await checkWithEslint("src/hooks/__tests__/useActiveEventId.test.tsx", code);
    const requireJsdoc = findings.filter((f) => f.rule === "jsdoc/require-jsdoc");

    expect(requireJsdoc.length).toBe(0);
  });

  it("flags magic numbers in production code via @typescript-eslint/no-magic-numbers", async () => {
    const code = `
      export function calculateTax(amount: number): number {
        return amount * 1.19;
      }
    `;

    const findings = await checkWithEslint("src/tax.ts", code);

    expect(findings.some((f) => f.rule === "@typescript-eslint/no-magic-numbers")).toBe(true);
  });

  it("allows declared constants and ignored numbers like -1, 0, 1 in production code", async () => {
    const code = `
      export const TAX_RATE = 1.19;

      export function calculateOffset(index: number): number {
        return index + 1 - 1 + 0;
      }
    `;

    const findings = await checkWithEslint("src/rates.ts", code);
    const magicNumbers = findings.filter((f) => f.rule === "@typescript-eslint/no-magic-numbers");

    expect(magicNumbers.length).toBe(0);
  });

  it("allows numbers that build a module-level SCREAMING_CASE constant or JSON indentation", async () => {
    const code = `
      declare function createColor(r: number, g: number, b: number, a: number): string;
      export const RESTART_INTERVAL_MS = 10 * 60 * 1000;
      const WHITE = createColor(255, 255, 255, 0);
      export function serialize(value: unknown): string {
        return JSON.stringify(value, null, 2) + WHITE;
      }
    `;

    const findings = await checkWithEslint("src/config.ts", code);
    const magicLines = findings.filter((f) => f.rule === "@typescript-eslint/no-magic-numbers").map((f) => f.line);

    expect(magicLines).toEqual([]);
  });

  it("still flags magic numbers in logic, lowercase constants, and function-local constants", async () => {
    const code = `
      declare function respond(status: number): void;
      export const ttlSeconds = 60 * 5;
      export function handle(ms: number): number {
        const LOCAL_LIMIT = 30 * 60;
        respond(200);
        return JSON.stringify(ms, null) === "x" ? LOCAL_LIMIT : ms / 1000;
      }
    `;

    const findings = await checkWithEslint("src/handler.ts", code);
    const magicMessages = findings
      .filter((f) => f.rule === "@typescript-eslint/no-magic-numbers")
      .map((f) => f.message.match(/No magic number: (-?\d+)/)?.[1]);

    expect(magicMessages).toEqual(["60", "5", "30", "60", "200", "1000"]);
  });

  it("exempts test files from @typescript-eslint/no-magic-numbers", async () => {
    const code = `
      import { expect, it } from "vitest";

      it("verifies HTTP status code", () => {
        expect(200).toBe(200);
      });
    `;

    const findings = await checkWithEslint("tests/status.test.ts", code);
    const magicNumbers = findings.filter((f) => f.rule === "@typescript-eslint/no-magic-numbers");

    expect(magicNumbers.length).toBe(0);
  });

  it("flags single-letter variable and parameter names via id-length", async () => {
    const code = `
      export function add(a: number, b: number): number {
        const c = a + b;
        return c;
      }
    `;

    const findings = await checkWithEslint("src/math.ts", code);
    const idLengthFindings = findings.filter((f) => f.rule === "id-length");

    expect(idLengthFindings.length).toBeGreaterThanOrEqual(3);
    expect(idLengthFindings.every((f) => f.severity === "warning")).toBe(true);
  });

  it("allows configured exceptions and exception patterns for id-length", async () => {
    const code = `
      export function loopAndPlot(x: number, y: number, _unused: string): number {
        let sum = 0;
        for (let i = 0; i < 10; i++) {
          sum += x + y + i;
        }
        return sum;
      }
    `;

    const findings = await checkWithEslint("src/plot.ts", code);
    const idLengthFindings = findings.filter((f) => f.rule === "id-length");

    expect(idLengthFindings.length).toBe(0);
  });

  it("exempts test files from id-length", async () => {
    const code = `
      import { expect, it } from "vitest";

      it("tests addition", () => {
        const a = 1;
        const b = 2;
        expect(a + b).toBe(3);
      });
    `;

    const findings = await checkWithEslint("tests/math.test.ts", code);
    const idLengthFindings = findings.filter((f) => f.rule === "id-length");

    expect(idLengthFindings.length).toBe(0);
  });

  it("allows inline style objects on native HTML elements via react-perf nativeAllowList", async () => {
    const code = `
      import React from "react";

      export const Gutter = ({ size }: { size: number }) => {
        return <div style={{ width: \`\${size}px\` }} aria-hidden />;
      };
    `;

    const findings = await checkWithEslint("src/Gutter.tsx", code);
    const perfFindings = findings.filter(
      (f) => f.rule === REACT_PERF_NO_NEW_OBJECT
    );

    expect(perfFindings.length).toBe(0);
  });

  it("still warns on inline object props passed to custom components", async () => {
    const code = `
      import React from "react";

      declare const CustomCard: React.ComponentType<{ config: { id: string } }>;

      export const CardWrapper = ({ id }: { id: string }) => {
        return <CustomCard config={{ id }} />;
      };
    `;

    const findings = await checkWithEslint("src/CardWrapper.tsx", code);
    const perfFindings = findings.filter(
      (f) => f.rule === REACT_PERF_NO_NEW_OBJECT
    );

    expect(perfFindings.length).toBe(1);
  });

  it("suppresses react-perf inline object warnings when inside useMemo or useCallback", async () => {
    const code = `
      import React, { useMemo } from "react";

      declare const EventCard: React.ComponentType<{
        eventCardData: { cardLink?: string; listing: unknown; typename?: string };
      }>;

      export const EventList = ({
        listings,
        calendarItem,
        typename,
      }: {
        listings: unknown[];
        calendarItem?: { cardLink?: string };
        typename?: string;
      }) => {
        const list = useMemo(() => {
          return listings.map((listing) => (
            <EventCard
              key="test"
              eventCardData={{ cardLink: calendarItem?.cardLink, listing, typename }}
            />
          ));
        }, [listings, calendarItem?.cardLink, typename]);

        return <div>{list}</div>;
      };
    `;

    const findings = await checkWithEslint("src/EventList.tsx", code);
    const perfFindings = findings.filter(
      (f) => f.rule === REACT_PERF_NO_NEW_OBJECT
    );

    expect(perfFindings.length).toBe(0);
  });

  it("still flags complicated inline objects inside useMemo (template strings, nesting, calculations)", async () => {
    const code = `
      import React, { useMemo } from "react";

      declare const SlotItem: React.ComponentType<{
        style: React.CSSProperties;
      }>;

      export const VirtualRow = ({ start, size }: { start: number; size: number }) => {
        const content = useMemo(() => {
          return (
            <SlotItem
              style={{
                left: 0,
                transform: \`translateX(\${start}px)\`,
                width: \`\${size}px\`,
              }}
            />
          );
        }, [start, size]);

        return <div>{content}</div>;
      };
    `;

    const findings = await checkWithEslint("src/VirtualRow.tsx", code);
    const perfFindings = findings.filter(
      (f) => f.rule === REACT_PERF_NO_NEW_OBJECT
    );

    expect(perfFindings.length).toBe(1);
  });

  it("still flags deeply nested inline objects inside useMemo", async () => {
    const code = `
      import React, { useMemo } from "react";

      declare const NestedCard: React.ComponentType<{
        config: { theme: { primary: string } };
      }>;

      export const CardContainer = ({ color }: { color: string }) => {
        const card = useMemo(() => {
          return <NestedCard config={{ theme: { primary: color } }} />;
        }, [color]);

        return <div>{card}</div>;
      };
    `;

    const findings = await checkWithEslint("src/CardContainer.tsx", code);
    const perfFindings = findings.filter(
      (f) => f.rule === REACT_PERF_NO_NEW_OBJECT
    );

    expect(perfFindings.length).toBe(1);
  });

  it("flags negated conjunction via de-morgan/no-negated-conjunction", async () => {
    const code = `
      export function checkCondition(a: boolean, b: boolean): boolean {
        return !(a && b);
      }
    `;

    const findings = await checkWithEslint("src/de-morgan-test.ts", code);
    const deMorganFindings = findings.filter(
      (f) => f.rule === "de-morgan/no-negated-conjunction"
    );

    expect(deMorganFindings.length).toBe(1);
  });

  it("flags negated disjunction via de-morgan/no-negated-disjunction", async () => {
    const code = `
      export function checkCondition(a: boolean, b: boolean): boolean {
        return !(a || b);
      }
    `;

    const findings = await checkWithEslint("src/de-morgan-test.ts", code);
    const deMorganFindings = findings.filter(
      (f) => f.rule === "de-morgan/no-negated-disjunction"
    );

    expect(deMorganFindings.length).toBe(1);
  });

  it("flags bare node module import missing node: protocol via unicorn/prefer-node-protocol", async () => {
    const code = `
      import fs from "fs";
      export function readFile() {
        return fs.readFileSync("foo");
      }
    `;

    const findings = await checkWithEslint("src/reader.ts", code);
    const unicornFindings = findings.filter(
      (f) => f.rule === "unicorn/prefer-node-protocol"
    );

    expect(unicornFindings.length).toBe(1);
    expect(unicornFindings[0]?.severity).toBe("warning");
  });

  it("flags new Date().getTime() in favor of Date.now() via unicorn/prefer-date-now", async () => {
    const code = `
      export function getTimestamp(): number {
        return new Date().getTime();
      }
    `;

    const findings = await checkWithEslint("src/time.ts", code);
    const unicornFindings = findings.filter(
      (f) => f.rule === "unicorn/prefer-date-now"
    );

    expect(unicornFindings.length).toBe(1);
  });

  it("flags JSON.parse(JSON.stringify(x)) in favor of structuredClone via unicorn/prefer-structured-clone", async () => {
    const code = `
      export function cloneObject(item: Record<string, unknown>): Record<string, unknown> {
        return JSON.parse(JSON.stringify(item));
      }
    `;

    const findings = await checkWithEslint("src/clone.ts", code);
    const unicornFindings = findings.filter(
      (f) => f.rule === "unicorn/prefer-structured-clone"
    );

    expect(unicornFindings.length).toBe(1);
  });

  it("flags nested ternary operators via no-nested-ternary", async () => {
    const code = `
      export function getStatus(code: number): string {
        return code === 200 ? "ok" : code === 404 ? "not found" : "error";
      }
    `;

    const findings = await checkWithEslint("src/status.ts", code);
    const ternaryFindings = findings.filter((f) => f.rule === "no-nested-ternary");

    expect(ternaryFindings.length).toBe(1);
    expect(ternaryFindings[0]?.why).toContain("Nested ternary operators obscure branch conditions");
    expect(ternaryFindings[0]?.suggestion).toContain("if/else statements or a switch block");
  });

  it("flags block-body find callback without return via array-callback-return", async () => {
    const code = `
      export function findTarget(items: Array<{ id: string }>, targetId: string): { id: string } | undefined {
        return items.find((item) => {
          item.id === targetId;
        });
      }
    `;

    const findings = await checkWithEslint("src/finder.ts", code);

    const arrayFindings = findings.filter((f) => f.rule === "array-callback-return");

    expect(arrayFindings.length).toBe(1);

    expect(arrayFindings.at(0)?.severity).toBe("error");

    expect(arrayFindings.at(0)?.why).toContain("Array iteration correctness");

    expect(arrayFindings.at(0)?.suggestion).toContain("Add an explicit return statement");
  });

  it("allows expression-body find callback in array-callback-return", async () => {
    const code = `
      export function findTarget(items: Array<{ id: string }>, targetId: string): { id: string } | undefined {
        return items.find((item) => item.id === targetId);
      }
    `;

    const findings = await checkWithEslint("src/finder.ts", code);

    const arrayFindings = findings.filter((f) => f.rule === "array-callback-return");

    expect(arrayFindings).toEqual([]);
  });

  it("allows block-body find callback with explicit return in array-callback-return", async () => {
    const code = `
      export function findTarget(items: Array<{ id: string }>, targetId: string): { id: string } | undefined {
        return items.find((item) => {
          return item.id === targetId;
        });
      }
    `;

    const findings = await checkWithEslint("src/finder.ts", code);

    const arrayFindings = findings.filter((f) => f.rule === "array-callback-return");

    expect(arrayFindings).toEqual([]);
  });

  it("does not flag forEach callbacks in array-callback-return", async () => {
    const code = `
      export function processItems(items: Array<{ id: string; active: boolean }>): void {
        items.forEach((item) => {
          if (!item.active) {
            return;
          }

          console.log(item.id);
        });
      }
    `;

    const findings = await checkWithEslint("src/finder.ts", code);

    const arrayFindings = findings.filter((f) => f.rule === "array-callback-return");

    expect(arrayFindings).toEqual([]);
  });

  it("flags missing explicit function return type on top-level functions via @typescript-eslint/explicit-function-return-type", async () => {
    const code = `
      export function calculateTotal(price: number, tax: number) {
        return price + tax;
      }
    `;

    const findings = await checkWithEslint("src/calc.ts", code);
    const returnTypeFindings = findings.filter(
      (f) => f.rule === "@typescript-eslint/explicit-function-return-type"
    );

    expect(returnTypeFindings.length).toBe(1);
    expect(returnTypeFindings[0]?.why).toContain("Explicit return type annotations on top-level functions");
  });

  it("disables explicit-function-return-type and no-duplicate-string in test files", async () => {
    const code = `
      export function helper(x: number) {
        const a = "duplicate-literal-for-testing";
        const b = "duplicate-literal-for-testing";
        const c = "duplicate-literal-for-testing";
        const d = "duplicate-literal-for-testing";
        const e = "duplicate-literal-for-testing";
        return x + a.length;
      }
    `;

    // Production file triggers both rules
    const prodFindings = await checkWithEslint("src/helper.ts", code);
    expect(
      prodFindings.some((f) => f.rule === "@typescript-eslint/explicit-function-return-type")
    ).toBe(true);
    expect(
      prodFindings.some((f) => f.rule === "sonarjs/no-duplicate-string")
    ).toBe(true);

    // Test file suppresses both rules via TEST_FILE_GLOBS
    const testFindings = await checkWithEslint("tests/helper.test.ts", code);
    expect(
      testFindings.some((f) => f.rule === "@typescript-eslint/explicit-function-return-type")
    ).toBe(false);
    expect(
      testFindings.some((f) => f.rule === "sonarjs/no-duplicate-string")
    ).toBe(false);
  });

  it("flags raw timer numeric literals in test controls via test-hygiene/no-raw-timer-literals", async () => {
    const code = `
      import { it, expect, vi } from "vitest";
      import { waitFor } from "@testing-library/react";

      it("advances timers and waits", async () => {
        vi.advanceTimersByTime(250);
        setTimeout(() => {}, 500);
        await waitFor(() => {}, { timeout: 1000 });
        expect(1).toBe(1);
      });
    `;

    const findings = await checkWithEslint("src/hooks/__tests__/timer.test.tsx", code);
    const timerFindings = findings.filter((f) => f.rule === "test-hygiene/no-raw-timer-literals");

    expect(timerFindings.length).toBe(3);
    expect(timerFindings.some((f) => f.message.includes("250"))).toBe(true);
    expect(timerFindings.some((f) => f.message.includes("500"))).toBe(true);
    expect(timerFindings.some((f) => f.message.includes("1000"))).toBe(true);
    expect(timerFindings[0]?.why).toContain("Test clarity");
  });

  it("allows descriptive constants and tick deferral in timer controls", async () => {
    const code = `
      import { it, expect, vi } from "vitest";
      import { waitFor } from "@testing-library/react";

      const SCROLL_DEBOUNCE_WAIT_MS = 250;
      const API_TIMEOUT_MS = 1000;

      it("uses named constants for timer durations", async () => {
        vi.advanceTimersByTime(SCROLL_DEBOUNCE_WAIT_MS);
        setTimeout(() => {}, 0);
        await waitFor(() => {}, { timeout: API_TIMEOUT_MS });
        expect(1).toBe(1);
      });
    `;

    const findings = await checkWithEslint("src/hooks/__tests__/timer.test.tsx", code);
    const timerFindings = findings.filter((f) => f.rule === "test-hygiene/no-raw-timer-literals");

    expect(timerFindings).toEqual([]);
  });

  it("flags large unassigned coordinate integers (> 1000) via test-hygiene/no-raw-coordinate-literals", async () => {
    const code = `
      import { it, expect } from "vitest";

      it("scrolls container", () => {
        container.scrollLeft = 4392;
        setScrollWidth(6200);
        window.scrollTo({ left: 3500, top: 1200 });
        expect(container.scrollLeft).toBe(2000);
      });
    `;

    const findings = await checkWithEslint("src/hooks/__tests__/scroll.test.tsx", code);
    const coordFindings = findings.filter((f) => f.rule === "test-hygiene/no-raw-coordinate-literals");

    expect(coordFindings.length).toBe(4);
    expect(coordFindings.some((f) => f.message.includes("4392"))).toBe(true);
    expect(coordFindings.some((f) => f.message.includes("6200"))).toBe(true);
    expect(coordFindings.some((f) => f.message.includes("3500"))).toBe(true);
    expect(coordFindings.some((f) => f.message.includes("1200"))).toBe(true);
    // Assertions like toBe(2000) must not be flagged
    expect(coordFindings.some((f) => f.message.includes("toBe"))).toBe(false);
  });

  it("allows coordinate integers <= 1000 or assigned to descriptive constants", async () => {
    const code = `
      import { it, expect } from "vitest";

      const NEXT_DAY_SCROLL_OFFSET_PX = 4392;
      const DEFAULT_SCROLL_WIDTH = 5000;

      it("uses named constants and small offsets", () => {
        container.scrollLeft = 800;
        container.scrollLeft = NEXT_DAY_SCROLL_OFFSET_PX;
        setScrollWidth(DEFAULT_SCROLL_WIDTH);
        expect(container.scrollLeft).toBe(2000);
      });
    `;

    const findings = await checkWithEslint("src/hooks/__tests__/scroll.test.tsx", code);
    const coordFindings = findings.filter((f) => f.rule === "test-hygiene/no-raw-coordinate-literals");

    expect(coordFindings).toEqual([]);
  });

  it("flags large unassigned coordinate integers in JSX attributes and unary expressions", async () => {
    const code = `
      import React from "react";
      import { it, expect } from "vitest";

      it("renders scroller with coordinates", () => {
        container.scrollLeft = -4392;
        const el = <Scroller width={5000} scrollLeft={4392} height={800} />;
        expect(1).toBe(1);
      });
    `;

    const findings = await checkWithEslint("src/components/__tests__/Scroller.test.tsx", code);
    const coordFindings = findings.filter((f) => f.rule === "test-hygiene/no-raw-coordinate-literals");

    expect(coordFindings.length).toBe(3);
    expect(coordFindings.some((f) => f.message.includes("-4392"))).toBe(true);
    expect(coordFindings.some((f) => f.message.includes("5000"))).toBe(true);
    expect(coordFindings.some((f) => f.message.includes("4392"))).toBe(true);
    expect(coordFindings.some((f) => f.message.includes("800"))).toBe(false);
  });
});
