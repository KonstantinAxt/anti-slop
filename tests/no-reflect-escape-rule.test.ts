import { describe, expect, it } from "vitest";
import { checkWithEslint } from "../src/checks/eslint-runner.js";

const RULE_NAME = "slop/no-reflect-escape";

async function checkRule(code: string) {
  const findings = await checkWithEslint("src/service.ts", code);

  return findings.filter((finding) => finding.rule === RULE_NAME);
}

describe("slop/no-reflect-escape", () => {
  it.each([
    [
      "Reflect.get",
      "export function read(target: unknown) { return Reflect.get(target, 'id'); }",
      "typed property access",
    ],
    [
      "Reflect.apply",
      "export function run(fn: unknown, thisArg: unknown, args: unknown[]) { return Reflect.apply(fn, thisArg, args); }",
      "typed function calls",
    ],
  ])("flags global %s call", async (method, code, expectedSuggestion) => {
    const findings = await checkRule(code);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.line).toBe(1);
    expect(findings[0]?.message).toContain(method);
    expect(findings[0]?.why).toContain("Dynamic reflection escapes static type safety");
    expect(findings[0]?.suggestion).toContain(expectedSuggestion);
  });

  it("flags computed string key access on Reflect", async () => {
    const code = "export function read(target: unknown) { return Reflect['get'](target, 'prop'); }";
    const findings = await checkRule(code);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("Reflect.get");
  });

  it("flags computed string key apply access on Reflect", async () => {
    const code = "export function run(fn: unknown, thisArg: unknown, args: unknown[]) { return Reflect['apply'](fn, thisArg, args); }";
    const findings = await checkRule(code);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("Reflect.apply");
  });

  it("flags reference to Reflect.get without invocation", async () => {
    const code = "export const getter = Reflect.get;";
    const findings = await checkRule(code);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("Reflect.get");
  });

  it("flags reference to Reflect.apply without invocation", async () => {
    const code = "export const caller = Reflect.apply;";
    const findings = await checkRule(code);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("Reflect.apply");
  });

  it("does not flag other Reflect methods", async () => {
    const code = `
      export function inspect(target: object, prop: string) {
        const hasProp = Reflect.has(target, prop);
        const ownKeys = Reflect.ownKeys(target);
        Reflect.set(target, prop, 123);
        Reflect.deleteProperty(target, prop);
        return { hasProp, ownKeys };
      }
    `;
    const findings = await checkRule(code);

    expect(findings).toHaveLength(0);
  });

  it("does not flag computed non-string keys or non-matching string keys", async () => {
    const code = `
      const key = 1;
      const other = 'has';
      export const a = Reflect[key];
      export const b = Reflect[0];
      export const c = Reflect[true];
      export const d = Reflect[other];
      export const e = Reflect['has'];
    `;
    const findings = await checkRule(code);

    expect(findings).toHaveLength(0);
  });

  it("does not flag non-computed non-identifier property expressions", async () => {
    const code = `
      export function check(x: unknown) {
        if (x && typeof x === 'object') {
          return (x as Record<string, unknown>).get;
        }
      }
    `;
    const findings = await checkRule(code);

    expect(findings).toHaveLength(0);
  });

  it("does not flag member access on non-Identifier objects", async () => {
    const code = `
      export const a = { get: 1 }.get;
      export const b = (() => ({ apply: 2 }))().apply;
      export const c = [].get;
    `;
    const findings = await checkRule(code);

    expect(findings).toHaveLength(0);
  });

  it("does not flag shadowed local Reflect identifier in nested function scope", async () => {
    const code = `
      export function outer() {
        const Reflect = { get: (a: unknown, b: string) => b };
        function inner() {
          return Reflect.get({}, 'foo');
        }
        return inner();
      }
    `;
    const findings = await checkRule(code);

    expect(findings).toHaveLength(0);
  });

  it("does not flag shadowed local Reflect identifier in function parameter", async () => {
    const code = "export function test(Reflect: { get(a: unknown, b: string): unknown }) { return Reflect.get({}, 'foo'); }";
    const findings = await checkRule(code);

    expect(findings).toHaveLength(0);
  });

  it("does not flag shadowed local Reflect variable declaration", async () => {
    const code = `
      export function test() {
        const Reflect = { get: (a: unknown, b: string) => b, apply: () => null };
        return Reflect.get({}, 'foo') || Reflect.apply();
      }
    `;
    const findings = await checkRule(code);

    expect(findings).toHaveLength(0);
  });

  it("does not flag member access on unrelated objects named get or apply", async () => {
    const code = `
      const myObj = { get: () => 1, apply: () => 2 };
      export const a = myObj.get();
      export const b = myObj.apply();
    `;
    const findings = await checkRule(code);

    expect(findings).toHaveLength(0);
  });
});
