import { describe, expect, it } from "bun:test";
import * as ts from "typescript";
import { checkTsConfig, checkStrictTsCode, checkStrictTsProgram } from "../src/checks/strict-ts.js";
import { createSourceFile } from "../src/checks/ast.js";
import type { Severity } from "../src/types.js";
const CHECK_STRICT_TS = "strict-ts";
const RULE_STRICT_MODE = "strict-mode";
const RULE_NO_UNCHECKED_INDEXED_ACCESS = "no-unchecked-indexed-access";
const RULE_EXACT_OPTIONAL = "exact-optional-property-types";
const RULE_NO_NON_NULL_ASSERTION = "no-non-null-assertion";
const RULE_NO_EXPLICIT_ANY = "no-explicit-any";
const RULE_NO_IMPLICIT_ANY = "no-implicit-any";
const RULE_STRICT_NULL_CHECKS = "strict-null-checks";
const RULE_STRICT_PROPERTY_INIT = "strict-property-initialization";
const RULE_NO_IMPLICIT_THIS = "no-implicit-this";
const RULE_NO_UNUSED_LOCALS = "no-unused-locals";
const SEVERITY_ERROR: Severity = "error";
const SEVERITY_WARNING: Severity = "warning";

const TSCONFIG_FILE = "tsconfig.json";
const TEST_TS_FILE = "src/test.ts";
const APP_CWD = "/app";

const MSG_STRICT_MODE = "compilerOptions.strict is not enabled in tsconfig.";
const MSG_UNCHECKED_INDEX = "compilerOptions.noUncheckedIndexedAccess is not enabled in tsconfig.";
const MSG_EXACT_OPTIONAL = "compilerOptions.exactOptionalPropertyTypes is not enabled in tsconfig.";

const WHY_STRICT_MODE =
  "Strict typing: Enables strict mode checks to force explicit typing and prevent unsafe assumptions.";
const WHY_UNCHECKED_INDEX =
  "Strict typing: Without noUncheckedIndexedAccess, array/record element lookups assume the value is always present instead of element | undefined.";
const WHY_EXACT_OPTIONAL =
  "Strict typing: exactOptionalPropertyTypes prevents assigning undefined to optional properties that require omission.";

const SUGGEST_STRICT_MODE = 'Set "compilerOptions": { "strict": true } in your tsconfig.json';
const SUGGEST_UNCHECKED_INDEX =
  'Set "compilerOptions": { "noUncheckedIndexedAccess": true } in your tsconfig.json';
const SUGGEST_EXACT_OPTIONAL =
  'Set "compilerOptions": { "exactOptionalPropertyTypes": true } in your tsconfig.json';

const MSG_NON_NULL = "Forbidden non-null assertion operator (!) used.";
const MSG_EXPLICIT_ANY = "Forbidden 'any' type used.";
const WHY_NON_NULL =
  "Type safety: Non-null assertion operator (!) forcibly bypasses null/undefined safety at compile time.";
const WHY_EXPLICIT_ANY = "Type safety: Explicit any disables type checking.";
const SUGGEST_NON_NULL =
  "Use optional chaining (?.), a guard check, or fallback (??) instead of overriding TypeScript's null safety with !.";
const SUGGEST_EXPLICIT_ANY =
  "Use 'unknown', a concrete domain type, a generic, or a Zod schema validation.";

const SUGGEST_UNDEFINED_CHECK =
  "Check for undefined using optional chaining (?.), a guard check (if (!val) return), or nullish coalescing (??).";
const SUGGEST_IMPLICIT_ANY =
  "Add an explicit type annotation instead of allowing TypeScript to infer implicit 'any'.";
const SUGGEST_NULL_UNDEFINED =
  "Handle null and undefined explicitly before using or assigning the value.";
const SUGGEST_EXACT_OPTIONAL_CODE =
  "Omit optional properties instead of explicitly assigning undefined.";
const SUGGEST_IMPLICIT_THIS =
  "Provide an explicit this parameter type annotation or use an arrow function.";
const SUGGEST_UNUSED_DECL =
  "Remove the unused import, variable, or declaration.";
const SUGGEST_PROPERTY_INIT =
  "Initialize the property in declaration or within the constructor.";

const MINIMAL_LIB_DTS = `
interface String { readonly length: number; }
interface Array<T> { [n: number]: T; readonly length: number; }
interface Boolean {}
interface Number {}
interface Object {}
interface Function {}
interface RegExp {}
interface IArguments {}
`;

function createVirtualHost(files: Record<string, string>): ts.CompilerHost {
  const allFiles: Record<string, string> = {
    ...files,
    "lib.d.ts": MINIMAL_LIB_DTS,
    "/lib.d.ts": MINIMAL_LIB_DTS,
  };

  return {
    getSourceFile: (fileName, languageVersion) => {
      const content = allFiles[fileName] ?? allFiles[fileName.replace(/^\//, "")];
      if (content !== undefined) {
        return ts.createSourceFile(fileName, content, languageVersion, true);
      }

      return undefined;
    },
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => APP_CWD,
    getDirectories: () => [],
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (fileName) =>
      allFiles[fileName] !== undefined || allFiles[fileName.replace(/^\//, "")] !== undefined,
    readFile: (fileName) => allFiles[fileName] ?? allFiles[fileName.replace(/^\//, "")],
  };
}

describe("Strict TypeScript Checker (Move #2)", () => {
  describe("checkTsConfig", () => {
    it("flags missing strict compiler options when compilerOptions is undefined or empty", () => {
      const expectedFindings = [
        {
          check: CHECK_STRICT_TS,
          rule: RULE_STRICT_MODE,
          severity: SEVERITY_ERROR,
          message: MSG_STRICT_MODE,
          file: TSCONFIG_FILE,
          line: 1,
          column: 1,
          why: WHY_STRICT_MODE,
          suggestion: SUGGEST_STRICT_MODE,
        },
        {
          check: CHECK_STRICT_TS,
          rule: RULE_NO_UNCHECKED_INDEXED_ACCESS,
          severity: SEVERITY_ERROR,
          message: MSG_UNCHECKED_INDEX,
          file: TSCONFIG_FILE,
          line: 1,
          column: 1,
          why: WHY_UNCHECKED_INDEX,
          suggestion: SUGGEST_UNCHECKED_INDEX,
        },
        {
          check: CHECK_STRICT_TS,
          rule: RULE_EXACT_OPTIONAL,
          severity: SEVERITY_WARNING,
          message: MSG_EXACT_OPTIONAL,
          file: TSCONFIG_FILE,
          line: 1,
          column: 1,
          why: WHY_EXACT_OPTIONAL,
          suggestion: SUGGEST_EXACT_OPTIONAL,
        },
      ];

      const undefinedOptionsFindings = checkTsConfig(TSCONFIG_FILE, {});

      expect(undefinedOptionsFindings).toEqual(expectedFindings);

      const emptyOptionsFindings = checkTsConfig(TSCONFIG_FILE, { compilerOptions: {} });

      expect(emptyOptionsFindings).toEqual(expectedFindings);
    });

    it("flags options individually when missing or set to false", () => {
      const strictFalseFindings = checkTsConfig(TSCONFIG_FILE, {
        compilerOptions: {
          strict: false,
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: true,
        },
      });

      expect(strictFalseFindings).toHaveLength(1);
      expect(strictFalseFindings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_STRICT_MODE,
        severity: SEVERITY_ERROR,
        message: MSG_STRICT_MODE,
        file: TSCONFIG_FILE,
        line: 1,
        column: 1,
        why: WHY_STRICT_MODE,
        suggestion: SUGGEST_STRICT_MODE,
      });

      const uncheckedFalseFindings = checkTsConfig(TSCONFIG_FILE, {
        compilerOptions: {
          strict: true,
          noUncheckedIndexedAccess: false,
          exactOptionalPropertyTypes: true,
        },
      });

      expect(uncheckedFalseFindings).toHaveLength(1);
      expect(uncheckedFalseFindings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_NO_UNCHECKED_INDEXED_ACCESS,
        severity: SEVERITY_ERROR,
        message: MSG_UNCHECKED_INDEX,
        file: TSCONFIG_FILE,
        line: 1,
        column: 1,
        why: WHY_UNCHECKED_INDEX,
        suggestion: SUGGEST_UNCHECKED_INDEX,
      });

      const exactOptionalFalseFindings = checkTsConfig(TSCONFIG_FILE, {
        compilerOptions: {
          strict: true,
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: false,
        },
      });

      expect(exactOptionalFalseFindings).toHaveLength(1);
      expect(exactOptionalFalseFindings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_EXACT_OPTIONAL,
        severity: SEVERITY_WARNING,
        message: MSG_EXACT_OPTIONAL,
        file: TSCONFIG_FILE,
        line: 1,
        column: 1,
        why: WHY_EXACT_OPTIONAL,
        suggestion: SUGGEST_EXACT_OPTIONAL,
      });

      const strictOmittedFindings = checkTsConfig(TSCONFIG_FILE, {
        compilerOptions: {
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: true,
        },
      });

      expect(strictOmittedFindings).toHaveLength(1);
      expect(strictOmittedFindings[0]?.rule).toBe(RULE_STRICT_MODE);

      const uncheckedOmittedFindings = checkTsConfig(TSCONFIG_FILE, {
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
        },
      });

      expect(uncheckedOmittedFindings).toHaveLength(1);
      expect(uncheckedOmittedFindings[0]?.rule).toBe(RULE_NO_UNCHECKED_INDEXED_ACCESS);

      const exactOptionalOmittedFindings = checkTsConfig(TSCONFIG_FILE, {
        compilerOptions: {
          strict: true,
          noUncheckedIndexedAccess: true,
        },
      });

      expect(exactOptionalOmittedFindings).toHaveLength(1);
      expect(exactOptionalOmittedFindings[0]?.rule).toBe(RULE_EXACT_OPTIONAL);
    });

    it("passes when all three critical compiler options are enabled", () => {
      const strictTsConfig = {
        compilerOptions: {
          strict: true,
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: true,
        },
      };

      const findings = checkTsConfig(TSCONFIG_FILE, strictTsConfig);

      expect(findings).toEqual([]);
    });
  });

  describe("checkStrictTsCode", () => {
    it("flags non-null assertion operator (!) with exact coordinates and attributes", () => {
      const code = "const y = x!;";
      const findings = checkStrictTsCode(TEST_TS_FILE, code);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_NO_NON_NULL_ASSERTION,
        severity: SEVERITY_ERROR,
        message: MSG_NON_NULL,
        file: TEST_TS_FILE,
        line: 1,
        column: 11,
        excerpt: "x!",
        why: WHY_NON_NULL,
        suggestion: SUGGEST_NON_NULL,
      });
    });

    it("flags explicit 'any' type with exact coordinates and attributes", () => {
      const code = "const x: any = 1;";
      const findings = checkStrictTsCode(TEST_TS_FILE, code);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_NO_EXPLICIT_ANY,
        severity: SEVERITY_ERROR,
        message: MSG_EXPLICIT_ANY,
        file: TEST_TS_FILE,
        line: 1,
        column: 10,
        excerpt: "x: any = 1",
        why: WHY_EXPLICIT_ANY,
        suggestion: SUGGEST_EXPLICIT_ANY,
      });
    });

    it("accepts a pre-parsed SourceFile parameter", () => {
      const code = "const x: any = 1;";
      const parsed = createSourceFile(TEST_TS_FILE, code);
      const findings = checkStrictTsCode(TEST_TS_FILE, code, parsed);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.rule).toBe(RULE_NO_EXPLICIT_ANY);
    });

    it("does not flag clean typed code", () => {
      const code = `
        interface User {
          id: string;
          name?: string;
        }

        export function getUser(users: Record<string, User>, id: string): User | undefined {
          return users[id];
        }
      `;

      const findings = checkStrictTsCode(TEST_TS_FILE, code);

      expect(findings).toEqual([]);
    });
  });

  describe("Virtual Strict TypeScript Program Checker", () => {
    it("reports diagnostic 7006 (noImplicitAny) with exact findings", () => {
      const host = createVirtualHost({
        "/app/handler.ts": "export function process(data) {}",
      });
      const findings = checkStrictTsProgram(["/app/handler.ts"], {
        cwd: APP_CWD,
        host,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_NO_IMPLICIT_ANY,
        severity: SEVERITY_ERROR,
        message: "Parameter 'data' implicitly has an 'any' type.",
        file: "handler.ts",
        line: 1,
        column: 25,
        why: "Strict typing enforcement: Parameter 'data' implicitly has an 'any' type.",
        suggestion: SUGGEST_IMPLICIT_ANY,
        excerpt: "data",
      });
    });
    it("reports diagnostic 7006 (noImplicitAny) with warning severity when allowLooseTsConfig is true", () => {
      const host = createVirtualHost({
        "/app/handler.ts": "export function process(data) {}",
      });
      const findings = checkStrictTsProgram(["/app/handler.ts"], {
        cwd: APP_CWD,
        host,
        allowLooseTsConfig: true,
      });

      expect(findings).toHaveLength(1);
      const finding = findings[0];
      expect(finding).toBeDefined();
      if (!finding) return;
      expect(finding.severity).toBe(SEVERITY_WARNING);
      expect(finding.rule).toBe(RULE_NO_IMPLICIT_ANY);
    });

    it("preserves error severity for strictNullChecks even when allowLooseTsConfig is true", () => {
      const host = createVirtualHost({
        "/app/null-2531.ts": "declare function getObj(): { a: number } | null; getObj().a;",
      });
      const findings = checkStrictTsProgram(["/app/null-2531.ts"], {
        cwd: APP_CWD,
        host,
        allowLooseTsConfig: true,
      });

      expect(findings).toHaveLength(1);
      const finding = findings[0];
      expect(finding).toBeDefined();
      if (!finding) return;
      expect(finding.severity).toBe(SEVERITY_ERROR);
      expect(finding.rule).toBe(RULE_STRICT_NULL_CHECKS);
    });

    it("reports diagnostic 2531 (strictNullChecks - possibly null) with exact findings", () => {
      const host = createVirtualHost({
        "/app/null-2531.ts": "declare function getObj(): { a: number } | null; getObj().a;",
      });
      const findings = checkStrictTsProgram(["/app/null-2531.ts"], {
        cwd: APP_CWD,
        host,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_STRICT_NULL_CHECKS,
        severity: SEVERITY_ERROR,
        message: "Object is possibly 'null'.",
        file: "null-2531.ts",
        line: 1,
        column: 50,
        why: "Strict typing enforcement: Object is possibly 'null'.",
        suggestion: SUGGEST_NULL_UNDEFINED,
        excerpt: "getObj()",
      });
    });

    it("reports diagnostic 2532 (possibly undefined) with exact findings", () => {
      const host = createVirtualHost({
        "/app/null-2532.ts": "declare function getObj(): { a: number } | undefined; getObj().a;",
      });
      const findings = checkStrictTsProgram(["/app/null-2532.ts"], {
        cwd: APP_CWD,
        host,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_NO_UNCHECKED_INDEXED_ACCESS,
        severity: SEVERITY_ERROR,
        message: "Object is possibly 'undefined'.",
        file: "null-2532.ts",
        line: 1,
        column: 55,
        why: "Strict typing enforcement: Object is possibly 'undefined'.",
        suggestion: SUGGEST_UNDEFINED_CHECK,
        excerpt: "getObj()",
      });
    });

    it("reports diagnostic 2322 (strictNullChecks - type null not assignable) with exact findings", () => {
      const host = createVirtualHost({
        "/app/null-2322.ts": "let str: string = null;",
      });
      const findings = checkStrictTsProgram(["/app/null-2322.ts"], {
        cwd: APP_CWD,
        host,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_STRICT_NULL_CHECKS,
        severity: SEVERITY_ERROR,
        message: "Type 'null' is not assignable to type 'string'.",
        file: "null-2322.ts",
        line: 1,
        column: 5,
        why: "Strict typing enforcement: Type 'null' is not assignable to type 'string'.",
        suggestion: SUGGEST_NULL_UNDEFINED,
        excerpt: "str",
      });
    });

    it("reports diagnostic 2683 (noImplicitThis) with exact findings", () => {
      const host = createVirtualHost({
        "/app/this-2683.ts": "export function f() { return this.x; }",
      });
      const findings = checkStrictTsProgram(["/app/this-2683.ts"], {
        cwd: APP_CWD,
        host,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_NO_IMPLICIT_THIS,
        severity: SEVERITY_ERROR,
        message: "'this' implicitly has type 'any' because it does not have a type annotation.",
        file: "this-2683.ts",
        line: 1,
        column: 30,
        why: "Strict typing enforcement: 'this' implicitly has type 'any' because it does not have a type annotation.",
        suggestion: SUGGEST_IMPLICIT_THIS,
        excerpt: "this",
      });
    });

    it("reports diagnostic 7041 (noImplicitThis - arrow captures global this) with exact findings", () => {
      const host = createVirtualHost({
        "/app/this-7041.ts": "const f = () => { return this; };",
      });
      const findings = checkStrictTsProgram(["/app/this-7041.ts"], {
        cwd: APP_CWD,
        host,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_NO_IMPLICIT_THIS,
        severity: SEVERITY_ERROR,
        message: "The containing arrow function captures the global value of 'this'.",
        file: "this-7041.ts",
        line: 1,
        column: 26,
        why: "Strict typing enforcement: The containing arrow function captures the global value of 'this'.",
        suggestion: SUGGEST_IMPLICIT_THIS,
        excerpt: "this",
      });
    });

    it("reports diagnostic 2564 (strictPropertyInitialization) with exact findings", () => {
      const host = createVirtualHost({
        "/app/prop-2564.ts": "class User { name: string; }",
      });
      const findings = checkStrictTsProgram(["/app/prop-2564.ts"], {
        cwd: APP_CWD,
        host,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_STRICT_PROPERTY_INIT,
        severity: SEVERITY_ERROR,
        message:
          "Property 'name' has no initializer and is not definitely assigned in the constructor.",
        file: "prop-2564.ts",
        line: 1,
        column: 14,
        why: "Strict typing enforcement: Property 'name' has no initializer and is not definitely assigned in the constructor.",
        suggestion: SUGGEST_PROPERTY_INIT,
        excerpt: "name",
      });
    });

    it("reports diagnostic 2375 (exactOptionalPropertyTypes - object literal) with exact findings", () => {
      const host = createVirtualHost({
        "/app/opt-2375.ts":
          "interface Config { timeout?: number; } const cfg: Config = { timeout: undefined };",
      });
      const findings = checkStrictTsProgram(["/app/opt-2375.ts"], {
        cwd: APP_CWD,
        host,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]?.rule).toBe(RULE_EXACT_OPTIONAL);
      expect(findings[0]?.severity).toBe(SEVERITY_WARNING);
      expect(findings[0]?.file).toBe("opt-2375.ts");
      expect(findings[0]?.line).toBe(1);
      expect(findings[0]?.column).toBe(46);
      expect(findings[0]?.suggestion).toBe(SUGGEST_EXACT_OPTIONAL_CODE);
      expect(findings[0]?.message).toContain("with 'exactOptionalPropertyTypes: true'");
    });

    it("reports diagnostic 2412 (exactOptionalPropertyTypes - direct assignment) with exact findings", () => {
      const host = createVirtualHost({
        "/app/opt-2412.ts":
          "interface Target { foo?: number; } declare const t: Target; t.foo = undefined;",
      });
      const findings = checkStrictTsProgram(["/app/opt-2412.ts"], {
        cwd: APP_CWD,
        host,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_EXACT_OPTIONAL,
        severity: SEVERITY_WARNING,
        message:
          "Type 'undefined' is not assignable to type 'number' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the type of the target.",
        file: "opt-2412.ts",
        line: 1,
        column: 61,
        why: "Strict typing enforcement: Type 'undefined' is not assignable to type 'number' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the type of the target.",
        suggestion: SUGGEST_EXACT_OPTIONAL_CODE,
        excerpt: "t.foo",
      });
    });

    it("reports diagnostic 6133 (noUnusedLocals - unused variable) with exact findings", () => {
      const host = createVirtualHost({
        "/app/unused-6133.ts": "export function f() { const unused = 1; }",
      });
      const findings = checkStrictTsProgram(["/app/unused-6133.ts"], {
        cwd: APP_CWD,
        host,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_NO_UNUSED_LOCALS,
        severity: SEVERITY_WARNING,
        message: "'unused' is declared but its value is never read.",
        file: "unused-6133.ts",
        line: 1,
        column: 29,
        why: "Strict typing enforcement: 'unused' is declared but its value is never read.",
        suggestion: SUGGEST_UNUSED_DECL,
        excerpt: "unused",
      });
    });

    it("reports diagnostic 6196 (noUnusedLocals - unused type parameter or declaration) with exact findings", () => {
      const host = createVirtualHost({
        "/app/unused-6196.ts": "export {}; type UnusedType = string;",
      });
      const findings = checkStrictTsProgram(["/app/unused-6196.ts"], {
        cwd: APP_CWD,
        host,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({
        check: CHECK_STRICT_TS,
        rule: RULE_NO_UNUSED_LOCALS,
        severity: SEVERITY_WARNING,
        message: "'UnusedType' is declared but never used.",
        file: "unused-6196.ts",
        line: 1,
        column: 17,
        why: "Strict typing enforcement: 'UnusedType' is declared but never used.",
        suggestion: SUGGEST_UNUSED_DECL,
        excerpt: "UnusedType",
      });
    });

    it("does not report errors on imported loose legacy files", () => {
      const files = {
        "/app/legacy.ts": "export function untypedLegacy(param) { return param; }",
        "/app/feature.ts":
          'import { untypedLegacy } from "./legacy"; export function safeFeature(): string { void untypedLegacy; return "safe"; }',
      };

      const host = createVirtualHost(files);
      const findings = checkStrictTsProgram(["/app/feature.ts"], {
        cwd: APP_CWD,
        host,
      });

      expect(findings).toEqual([]);
    });

    it("handles empty targetFiles and non-TypeScript files cleanly", () => {
      expect(checkStrictTsProgram([])).toEqual([]);
      expect(checkStrictTsProgram(["README.md", "package.json"])).toEqual([]);

      const host = createVirtualHost({});

      expect(checkStrictTsProgram(["/app/missing.ts"], { cwd: APP_CWD, host })).toEqual([]);
    });
  });
});
