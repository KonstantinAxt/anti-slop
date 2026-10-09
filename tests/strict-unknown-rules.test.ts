import { describe, expect, it } from "vitest";
import { checkWithEslint } from "../src/checks/eslint-runner.js";
import { runAntiSlop } from "../src/index.js";
import * as fs from "node:fs";
import * as path from "node:path";

const PARAM_RULE = "slop/no-unknown-parameters";
const RETURN_RULE = "slop/no-unknown-returns";

const ALL_ENABLED = {
  [PARAM_RULE]: "error",
  [RETURN_RULE]: "error",
};

describe("slop/no-unknown-parameters", () => {
  it.each([
    ["function declaration", "export function f(input: unknown): void {}"],
    ["union parameter", "export const f = (val: string | unknown) => val;"],
    ["constructor property", "export class H { constructor(public data: unknown) {} }"],
    ["method parameter", "export class H { m(payload: unknown | number): void {} }"],
    ["function type", "export type T = (item: unknown) => string;"],
    ["method signature", "export interface S { compute(val: unknown): number; }"],
    ["call signature", "export interface S { (raw: unknown): void; }"],
    ["construct signature", "export interface S { new (spec: unknown): S; }"],
    ["same-file type alias", "type B = unknown; export function f(target: B): void {}"],
  ])("flags unknown parameter in %s", async (_, code) => {
    const findings = await checkWithEslint("src/test.ts", code, { [PARAM_RULE]: "error" });
    const match = findings.filter((f) => f.rule === PARAM_RULE);

    expect(match).toHaveLength(1);
    expect(match[0]?.rule).toBe(PARAM_RULE);
    expect(match[0]?.severity).toBe("error");
    expect(match[0]?.line).toBe(1);
    expect(match[0]?.message).toContain("Avoid 'unknown' or unions containing 'unknown' on function parameter");
    expect(match[0]?.message).toContain("(Same-file AST only)");
    expect(match[0]?.why).toBe("Type evidence hygiene: Accepting 'unknown' in function parameters forces callers to discard type evidence or requires internal assertions. Validate at boundaries using a schema or use concrete domain types/generics (same-file AST only).");
    expect(match[0]?.suggestion).toBe("Replace 'unknown' with a concrete domain type, a generic type parameter, or validate input at the caller boundary.");
  });

  it.each([
    ["cause parameter", "export function f(err: Error, cause: unknown): void {}"],
    ["optional cause", "export class E extends Error { constructor(msg: string, cause?: unknown) { super(msg); } }"],
    ["type predicate subject function", "export function isStr(x: unknown): x is string { return typeof x === 'string'; }"],
    ["type predicate subject arrow", "export const isNum = (x: unknown): x is number => typeof x === 'number';"],
    ["type predicate this subject", "export function isThis(this: unknown): this is string { return true; }"],
    ["concrete array type", "export function f(items: unknown[]): number { return items.length; }"],
  ])("allows valid parameter pattern: %s", async (_, code) => {
    const findings = await checkWithEslint("src/test.ts", code, { [PARAM_RULE]: "error" });

    expect(findings.filter((f) => f.rule === PARAM_RULE)).toHaveLength(0);
  });

  it("flags non-subject parameter while allowing type predicate subject", async () => {
    const code = "export function match(tag: unknown, item: unknown): item is string { return true; }";
    const findings = await checkWithEslint("src/test.ts", code, { [PARAM_RULE]: "error" });
    const match = findings.filter((f) => f.rule === PARAM_RULE);

    expect(match).toHaveLength(1);
    expect(match[0]?.message).toContain("'tag'");
    expect(match[0]?.line).toBe(1);
  });
});

describe("slop/no-unknown-returns", () => {
  it.each([
    ["unknown return", "export function f(): unknown { return 1; }", "'unknown'"],
    ["Promise<unknown>", "export async function f(): Promise<unknown> { return 1; }", "'Promise<unknown>'"],
    ["PromiseLike<unknown>", "export function f(): PromiseLike<unknown> { return Promise.resolve(1); }", "'PromiseLike<unknown>'"],
    ["type alias return", "type R = Promise<unknown>; export function f(): R { return 1; }", "'Promise<unknown>'"],
    ["union return with unknown", "export function f(): unknown | null { return null; }", "'unknown'"],
  ])("flags unknown return in %s", async (_, code, expectedType) => {
    const findings = await checkWithEslint("src/test.ts", code, { [RETURN_RULE]: "error" });
    const match = findings.filter((f) => f.rule === RETURN_RULE);

    expect(match).toHaveLength(1);
    expect(match[0]?.rule).toBe(RETURN_RULE);
    expect(match[0]?.severity).toBe("error");
    expect(match[0]?.line).toBe(1);
    expect(match[0]?.message).toBe(`Avoid ${expectedType} as return type annotation. Return a concrete domain type or generic instead. (Same-file AST only)`);
    expect(match[0]?.why).toBe("Type evidence hygiene: Returning 'unknown', 'Promise<unknown>', or 'PromiseLike<unknown>' discards type evidence at contract boundaries and defers validation to callers (same-file AST only).");
    expect(match[0]?.suggestion).toBe("Return a concrete domain type, generic return contract, or parsed schema result instead of 'unknown'.");
  });

  it.each([
    ["concrete return", "export function f(): number { return 10; }"],
    ["Promise<string>", "export async function f(): Promise<string> { return 'ok'; }"],
    ["type predicate", "export function isObj(v: unknown): v is object { return true; }"],
  ])("allows valid return type: %s", async (_, code) => {
    const findings = await checkWithEslint("src/test.ts", code, { [RETURN_RULE]: "error" });

    expect(findings.filter((f) => f.rule === RETURN_RULE)).toHaveLength(0);
  });
});

describe("opt-in mechanism & configuration precedence", () => {
  const violatingCode = "export function processEntry(input: unknown): unknown {\n  return input;\n}\n";

  it("produces zero findings when rules are not enabled (default opt-in state)", async () => {
    const findings = await checkWithEslint("src/violator.ts", violatingCode);
    const strictFindings = findings.filter((f) => f.rule === PARAM_RULE || f.rule === RETURN_RULE);

    expect(strictFindings).toHaveLength(0);
  });

  it("produces findings when enabled via rule overrides", async () => {
    const findings = await checkWithEslint("src/violator.ts", violatingCode, ALL_ENABLED);
    const paramHits = findings.filter((f) => f.rule === PARAM_RULE);
    const returnHits = findings.filter((f) => f.rule === RETURN_RULE);

    expect(paramHits).toHaveLength(1);
    expect(paramHits[0]?.line).toBe(1);
    expect(returnHits).toHaveLength(1);
    expect(returnHits[0]?.line).toBe(1);
  });

  it("resolves rules without slop/ prefix via aliases", async () => {
    const aliasesConfig = {
      "no-unknown-parameters": "error",
      "no-unknown-returns": "error",
    };
    const findings = await checkWithEslint("src/violator.ts", violatingCode, aliasesConfig);
    const strictFindings = findings.filter((f) => f.rule === PARAM_RULE || f.rule === RETURN_RULE);

    expect(strictFindings).toHaveLength(2);
  });

  it("supports severity downgrade to warning and explicit off", async () => {
    const warnFindings = await checkWithEslint("src/violator.ts", violatingCode, {
      [PARAM_RULE]: "warn",
      [RETURN_RULE]: "off",
    });
    const paramHit = warnFindings.find((f) => f.rule === PARAM_RULE);

    expect(paramHit?.rule).toBe(PARAM_RULE);
    expect(paramHit?.severity).toBe("warning");
    expect(warnFindings.some((f) => f.rule === RETURN_RULE)).toBe(false);
  });

  it("integrates with runAntiSlop with default and enabled configuration", async () => {
    const tempFile = path.resolve(process.cwd(), "tests/temp-run-antislop-violation.ts");
    fs.writeFileSync(tempFile, violatingCode);

    try {
      const defaultRun = await runAntiSlop({
        cwd: process.cwd(),
        files: [tempFile],
        allowLooseTsConfig: true,
      });
      const defaultHits = defaultRun.findings.filter((f) => f.rule === PARAM_RULE || f.rule === RETURN_RULE);

      expect(defaultHits).toHaveLength(0);

      const enabledRun = await runAntiSlop({
        cwd: process.cwd(),
        files: [tempFile],
        allowLooseTsConfig: true,
        rules: ALL_ENABLED,
      });
      const enabledHits = enabledRun.findings.filter((f) => f.rule === PARAM_RULE || f.rule === RETURN_RULE);

      expect(enabledHits).toHaveLength(2);

      const configPath = path.resolve(process.cwd(), "anti-slop.json");
      fs.writeFileSync(configPath, JSON.stringify({ rules: ALL_ENABLED }));
      try {
        const fileConfigRun = await runAntiSlop({
          cwd: process.cwd(),
          files: [tempFile],
          allowLooseTsConfig: true,
        });
        const fileConfigHits = fileConfigRun.findings.filter((f) => f.rule === PARAM_RULE || f.rule === RETURN_RULE);

        expect(fileConfigHits).toHaveLength(2);
      } finally {
        fs.rmSync(configPath, { force: true });
      }
    } finally {
      fs.rmSync(tempFile, { force: true });
    }
  });
});
