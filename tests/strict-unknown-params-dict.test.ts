import { describe, expect, it } from "vitest";
import { checkWithEslint } from "../src/checks/eslint-runner.js";

const PARAM_RULE = "slop/no-unknown-parameters";
const DICT_RULE = "slop/no-unknown-dictionary-values";

async function messagesFor(rule: string, code: string): Promise<string[]> {
  const findings = await checkWithEslint("src/test.ts", code, { [rule]: "error" });

  return findings.filter((finding) => finding.rule === rule).map((finding) => finding.message);
}

const paramMessage = (name: string): string =>
  `Avoid 'unknown' on parameter '${name}'. Accept a concrete domain type or generic, and parse at the boundary. (Same-file AST only)`;

describe("slop/no-unknown-parameters", () => {
  it.each([
    ["function declaration", "export function f(input: unknown): void { void input; }"],
    ["function expression", "export const f = function (input: unknown): void { void input; };"],
    ["arrow function", "export const f = (input: unknown): void => { void input; };"],
    ["union with unknown", "export const f = (input: unknown | null): void => { void input; };"],
    ["optional parameter", "export const f = (input?: unknown): void => { void input; };"],
    ["declared function", "export declare function f(input: unknown): void;"],
    ["abstract class method", "export abstract class A { abstract f(input: unknown): void; }"],
    ["interface method", "export interface I { f(input: unknown): void; }"],
    ["function type", "export type F = (input: unknown) => void;"],
    ["constructor type", "export type C = new (input: unknown) => object;"],
    ["call signature", "export interface I { (input: unknown): void; }"],
    ["construct signature", "export interface I { new (input: unknown): object; }"],
  ])("reports %s", async (_, code) => {
    expect(await messagesFor(PARAM_RULE, code)).toEqual([paramMessage("input")]);
  });

  it("reports parameters of a type predicate other than its subject", async () => {
    const code = "export function isText(value: unknown, extra: unknown): value is string { return typeof value === 'string' && extra !== null; }";

    expect(await messagesFor(PARAM_RULE, code)).toEqual([paramMessage("extra")]);
  });

  it.each([
    ["a cause parameter", "export const wrap = (cause: unknown): Error => new Error('failed', { cause });"],
    ["a type predicate subject", "export function isText(value: unknown): value is string { return typeof value === 'string'; }"],
    ["an asserts predicate subject", "export function assertText(value: unknown): asserts value is string { if (typeof value !== 'string') throw new Error('no'); }"],
    ["a concrete parameter", "export const f = (input: string): void => { void input; };"],
    ["an unknown array parameter", "export const f = (input: unknown[]): void => { void input; };"],
    ["a variable typed unknown", "export const value: unknown = 1;"],
  ])("allows %s", async (_, code) => {
    expect(await messagesFor(PARAM_RULE, code)).toEqual([]);
  });
});

const dictMessage = (type: string, kind: string): string =>
  `Avoid '${type}' as ${kind} type. Use a concrete value type, a generic, or a parsed schema type. (Same-file AST only)`;

describe("slop/no-unknown-dictionary-values", () => {
  it.each([
    ["Record of unknown", "export type D = Record<string, unknown>;", "unknown", "Record value"],
    ["Record of any", "export type D = Record<string, any>;", "any", "Record value"],
    ["Record of object", "export type D = Record<string, object>;", "object", "Record value"],
    ["Record of {}", "export type D = Record<string, {}>;", "{}", "Record value"],
    ["index signature of unknown", "export interface D { [key: string]: unknown; }", "unknown", "index signature value"],
    ["index signature of {}", "export type D = { [key: string]: {} };", "{}", "index signature value"],
  ])("reports %s", async (_, code, type, kind) => {
    expect(await messagesFor(DICT_RULE, code)).toEqual([dictMessage(type, kind)]);
  });

  it.each([
    ["a generic constraint", "export function keys<T extends Record<string, unknown>>(value: T): string[] { return Object.keys(value); }"],
    ["a concrete Record value", "export type D = Record<string, number>;"],
    ["an open Record key", "export type D = Record<any, string>;"],
    ["a non-empty object value", "export type D = Record<string, { id: string }>;"],
    ["a concrete index signature", "export interface D { [key: string]: number; }"],
    ["another generic type", "export type D = Map<string, unknown>;"],
  ])("allows %s", async (_, code) => {
    expect(await messagesFor(DICT_RULE, code)).toEqual([]);
  });
});

describe("strict-unknown opt-in", () => {
  it.each([PARAM_RULE, DICT_RULE])("%s is off by default and enabled by its unprefixed alias", async (rule) => {
    const code = "export type D = Record<string, unknown>; export const f = (input: unknown): void => { void input; };";
    const defaults = await checkWithEslint("src/test.ts", code);
    const aliased = await checkWithEslint("src/test.ts", code, { [rule.replace("slop/", "")]: "warn" });

    expect(defaults.filter((finding) => finding.rule === rule)).toEqual([]);

    expect(aliased.filter((finding) => finding.rule === rule).map((finding) => finding.severity)).toEqual(["warning"]);
  });
});
