import { describe, expect, it } from "vitest";
import { checkWithEslint } from "../src/checks/eslint-runner.js";

const RULE_NAME = "slop/no-redundant-presence-check";

async function expectViolation(code: string): Promise<void> {
  const findings = await checkWithEslint("src/service.ts", code);
  const ruleFindings = findings.filter((finding) => finding.rule === RULE_NAME);

  expect(ruleFindings).toHaveLength(1);
  expect(ruleFindings[0]?.message).toContain("unreachable guard");
  expect(ruleFindings[0]?.why).toContain("microsoft/TypeScript#13086");
  expect(ruleFindings[0]?.suggestion).toContain(".get()");
}

async function expectClean(code: string): Promise<void> {
  const findings = await checkWithEslint("src/service.ts", code);
  const ruleFindings = findings.filter((finding) => finding.rule === RULE_NAME);

  expect(ruleFindings).toHaveLength(0);
}

describe("slop/no-redundant-presence-check (unreachableGuard)", () => {
  it.each([
    ["in-block guard", "const m = new Map<string, number>(); export function f(k: string) { if (m.has(k)) { const v = m.get(k); if (v === undefined) throw new Error(); return v; } return 0; }"],
    ["negated ?? fail", "const m = new Map<string, number>(); function fail(s: string): never { throw new Error(s); } export function f(k: string) { if (!m.has(k)) return 0; return m.get(k) ?? fail('err'); }"],
    ["negated if-undefined", "const m = new Map<string, number>(); export function f(k: string) { if (!m.has(k)) return 0; const v = m.get(k); if (v === undefined) throw new Error(); return v; }"],
    ["inverted undefined", "const m = new Map<string, number>(); export function f(k: string) { if (m.has(k)) { const v = m.get(k); if (undefined === v) throw new Error(); return v; } return 0; }"],
    ["null check", "const m = new Map<string, number>(); export function f(k: string) { if (m.has(k)) { const v = m.get(k); if (v == null) throw new Error(); return v; } return 0; }"],
  ])("flags %s", async (_, code) => {
    await expectViolation(code);
  });

  it.each([
    ["single lookup", "const m = new Map<string, number>(); export function f(k: string) { const v = m.get(k); if (v !== undefined) return v; return 0; }"],
    ["value includes undefined", "const m = new Map<string, number | undefined>(); export function f(k: string) { if (m.has(k)) { const v = m.get(k); if (v === undefined) throw new Error(); return v; } return 0; }"],
    ["mutation between", "const m = new Map<string, number>(); export function f(k: string) { if (m.has(k)) { m.clear(); const v = m.get(k); if (v === undefined) throw new Error(); return v; } return 0; }"],
    ["call between", "const m = new Map<string, number>(); function log() { console.log('a'); } export function f(k: string) { if (m.has(k)) { log(); const v = m.get(k); if (v === undefined) throw new Error(); return v; } return 0; }"],
    ["key reassigned", "const m = new Map<string, number>(); export function f(k: string) { if (m.has(k)) { k = 'other'; const v = m.get(k); if (v === undefined) throw new Error(); return v; } return 0; }"],
    ["different key", "const m = new Map<string, number>(); export function f(a: string, b: string) { if (m.has(a)) { const v = m.get(b); if (v === undefined) throw new Error(); return v; } return 0; }"],
    ["different receiver", "const m1 = new Map<string, number>(); const m2 = new Map<string, number>(); export function f(k: string) { if (m1.has(k)) { const v = m2.get(k); if (v === undefined) throw new Error(); return v; } return 0; }"],
    ["custom non-Map class", "class Store { has(_k: string) { return true; } get(_k: string) { return 1; } } const s = new Store(); export function f(k: string) { if (s.has(k)) { const v = s.get(k); if (v === undefined) throw new Error(); return v; } return 0; }"],
    ["wrapped in non-null", "const m = new Map<string, number>(); export function f(k: string) { if (m.has(k)) { const v = m.get(k)!; if (v === undefined) throw new Error(); return v; } return 0; }"],
    ["wrapped in type assertion as", "const m = new Map<string, number>(); export function f(k: string) { if (m.has(k)) { const v = m.get(k) as number; if (v === undefined) throw new Error(); return v; } return 0; }"],
    ["unknown value type", "const m = new Map(); export function f(k: string) { if (m.has(k)) { const v = m.get(k); if (v === undefined) throw new Error(); return v; } return null; }"],
    ["any value type", "const m = new Map<string, any>(); export function f(k: string) { if (m.has(k)) { const v = m.get(k); if (v === undefined) throw new Error(); return v; } return null; }"],
  ])("allows %s", async (_, code) => {
    await expectClean(code);
  });
});
