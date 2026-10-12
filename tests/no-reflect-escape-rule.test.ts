import { describe, expect, it } from "vitest";
import { checkWithEslint } from "../src/checks/eslint-runner.js";

const RULE = "slop/no-reflect-escape";
const ENABLED = { [RULE]: "warn" };

describe("slop/no-reflect-escape", () => {
  it.each([
    ["dot get", "export const read = (value: object): number => Reflect.get(value, 'size');", "get"],
    ["dot apply", "export const run = (fn: () => void): void => Reflect.apply(fn, undefined, []);", "apply"],
    ["computed get", "export const read = (value: object): number => Reflect['get'](value, 'size');", "get"],
    ["computed apply", 'export const run = (fn: () => void): void => Reflect["apply"](fn, undefined, []);', "apply"],
    ["unbound reference", "export const getter = Reflect.get;", "get"],
  ])("reports %s", async (_, code, method) => {
    const findings = await checkWithEslint("src/test.ts", code, ENABLED);
    const matches = findings.filter((finding) => finding.rule === RULE);

    expect(matches.map((finding) => [finding.severity, finding.message])).toEqual([
      ["warning", `Avoid 'Reflect.${method}' escape hatch. Prefer typed property access, typed function calls, or boundary schema parsing.`],
    ]);
  });

  it.each([
    ["other Reflect methods", "export const keys = (value: object): (string | symbol)[] => Reflect.ownKeys(value);"],
    ["a shadowed Reflect", "const Reflect = { get: (): number => 1 }; export const read = (): number => Reflect.get();"],
    ["a get method on another object", "const store = { get: (): number => 1 }; export const read = (): number => store.get();"],
    ["a computed non-escape key", "export const keys = (value: object): (string | symbol)[] => Reflect['ownKeys'](value);"],
  ])("allows %s", async (_, code) => {
    const findings = await checkWithEslint("src/test.ts", code, ENABLED);

    expect(findings.filter((finding) => finding.rule === RULE)).toHaveLength(0);
  });

  it("is off by default and resolves the unprefixed alias", async () => {
    const code = "export const read = (value: object): number => Reflect.get(value, 'size');";
    const defaults = await checkWithEslint("src/test.ts", code);
    const aliased = await checkWithEslint("src/test.ts", code, { "no-reflect-escape": "error" });

    expect(defaults.filter((finding) => finding.rule === RULE)).toHaveLength(0);

    expect(aliased.filter((finding) => finding.rule === RULE).map((finding) => finding.severity)).toEqual(["error"]);
  });
});
