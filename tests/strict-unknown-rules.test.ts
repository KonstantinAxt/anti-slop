import { describe, expect, it } from "vitest";
import { checkWithEslint } from "../src/checks/eslint-runner.js";
import { runAntiSlop } from "../src/index.js";
import * as fs from "node:fs";
import * as path from "node:path";

const RETURN_RULE = "slop/no-unknown-returns";
const RETURN_ENABLED = { [RETURN_RULE]: "error" };

describe("slop/no-unknown-returns", () => {
  it.each([
    ["unknown return", "export function f(): unknown { return 1; }", "unknown"],
    ["Promise<unknown>", "export async function f(): Promise<unknown> { return 1; }", "Promise<unknown>"],
    ["PromiseLike<unknown>", "export function f(): PromiseLike<unknown> { return Promise.resolve(1); }", "PromiseLike<unknown>"],
    ["type alias return", "type R = Promise<unknown>; export function f(): R { return 1; }", "Promise<unknown>"],
    ["union return with unknown", "export function f(): unknown | null { return null; }", "unknown"],
    ["promise argument alias", "type A = unknown; export function f(): Promise<A> { return Promise.resolve(1); }", "Promise<unknown>"],
    ["parenthesized unknown", "export function f(): (unknown) { return 1; }", "unknown"],
  ])("reports %s", async (_, code, expectedType) => {
    const findings = await checkWithEslint("src/test.ts", code, RETURN_ENABLED);
    const match = findings.filter((finding) => finding.rule === RETURN_RULE);

    expect(match).toHaveLength(1);
    expect(match[0]?.severity).toBe("error");
    expect(match[0]?.message).toContain(`Avoid '${expectedType}'`);
  });

  it.each([
    ["concrete return", "export function f(): number { return 10; }"],
    ["concrete Promise", "export async function f(): Promise<string> { return 'ok'; }"],
    ["unrelated generic", "export function f(): Box<unknown> { return {} as Box<unknown>; }"],
    ["concrete same-file alias", "type R = string; export function f(): R { return 'ok'; }"],
    ["unknown in second Promise argument", "export function f(): Promise<string, unknown> { return Promise.resolve(1); }"],
  ])("allows %s", async (_, code) => {
    const findings = await checkWithEslint("src/test.ts", code, RETURN_ENABLED);

    expect(findings.filter((finding) => finding.rule === RETURN_RULE)).toHaveLength(0);
  });

  it("checks only the first argument of known promises", async () => {
    const code = "export function f(): Promise<unknown, string> { return Promise.resolve(1); }";
    const findings = await checkWithEslint("src/test.ts", code, RETURN_ENABLED);

    expect(findings.filter((finding) => finding.rule === RETURN_RULE)).toHaveLength(1);
  });
});

describe("return rule opt-in configuration", () => {
  const violatingCode = "export function processEntry(): unknown { return 1; }\n";

  it("is disabled by default and reports when configured", async () => {
    const defaults = await checkWithEslint("src/violator.ts", violatingCode);
    const configured = await checkWithEslint("src/violator.ts", violatingCode, RETURN_ENABLED);

    expect(defaults.filter((finding) => finding.rule === RETURN_RULE)).toHaveLength(0);
    expect(configured.filter((finding) => finding.rule === RETURN_RULE)).toHaveLength(1);
  });

  it("resolves the unprefixed alias", async () => {
    const findings = await checkWithEslint("src/violator.ts", violatingCode, { "no-unknown-returns": "error" });

    expect(findings.filter((finding) => finding.rule === RETURN_RULE)).toHaveLength(1);
  });

  it("supports warning and off severities", async () => {
    const warningFindings = await checkWithEslint("src/violator.ts", violatingCode, { [RETURN_RULE]: "warn" });
    const disabledFindings = await checkWithEslint("src/violator.ts", violatingCode, { [RETURN_RULE]: "off" });

    expect(warningFindings.find((finding) => finding.rule === RETURN_RULE)?.severity).toBe("warning");
    expect(disabledFindings.filter((finding) => finding.rule === RETURN_RULE)).toHaveLength(0);
  });

  it("integrates with runAntiSlop rules and repository configuration", async () => {
    const tempFile = path.resolve(process.cwd(), "tests/temp-run-antislop-return.ts");
    const configPath = path.resolve(process.cwd(), "anti-slop.json");
    fs.writeFileSync(tempFile, violatingCode);

    try {
      const defaults = await runAntiSlop({ cwd: process.cwd(), files: [tempFile], allowLooseTsConfig: true });
      const configured = await runAntiSlop({ cwd: process.cwd(), files: [tempFile], allowLooseTsConfig: true, rules: RETURN_ENABLED });
      fs.writeFileSync(configPath, JSON.stringify({ rules: RETURN_ENABLED }));
      const fileConfigured = await runAntiSlop({ cwd: process.cwd(), files: [tempFile], allowLooseTsConfig: true });

      expect(defaults.findings.filter((finding) => finding.rule === RETURN_RULE)).toHaveLength(0);
      expect(configured.findings.filter((finding) => finding.rule === RETURN_RULE)).toHaveLength(1);
      expect(fileConfigured.findings.filter((finding) => finding.rule === RETURN_RULE)).toHaveLength(1);
    } finally {
      fs.rmSync(configPath, { force: true });
      fs.rmSync(tempFile, { force: true });
    }
  });
});

