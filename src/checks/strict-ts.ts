import * as path from "node:path";
import * as ts from "typescript";
import type { Finding } from "../types.js";
import { createSourceFile, loadParsedCommandLine } from "./ast.js";

const RULE_NO_UNCHECKED_INDEXED_ACCESS = "no-unchecked-indexed-access";
const RULE_NO_IMPLICIT_ANY = "no-implicit-any";
const RULE_STRICT_NULL_CHECKS = "strict-null-checks";
const RULE_STRICT_PROPERTY_INIT = "strict-property-initialization";
const RULE_NO_IMPLICIT_THIS = "no-implicit-this";
const RULE_EXACT_OPTIONAL_PROPERTIES = "exact-optional-property-types";
const RULE_NO_UNUSED_LOCALS = "no-unused-locals";

const SUGGESTION_UNDEFINED_CHECK =
  "Check for undefined using optional chaining (?.), a guard check (if (!val) return), or nullish coalescing (??).";
const SUGGESTION_IMPLICIT_ANY =
  "Add an explicit type annotation instead of allowing TypeScript to infer implicit 'any'.";
const SUGGESTION_NULL_UNDEFINED =
  "Handle null and undefined explicitly before using or assigning the value.";
const SUGGESTION_EXACT_OPTIONAL =
  "Omit optional properties instead of explicitly assigning undefined.";
const SUGGESTION_IMPLICIT_THIS =
  "Provide an explicit this parameter type annotation or use an arrow function.";
const SUGGESTION_UNUSED_DECL =
  "Remove the unused import, variable, or declaration.";

/**
 * Verify that tsconfig compilerOptions enable all strict compiler flags.
 *
 * @param filePath Path to tsconfig.json.
 * @param config Parsed tsconfig configuration object.
 * @returns Array of tsconfig strictness findings.
 */
export function checkTsConfig(
  filePath: string,
  config: { compilerOptions?: Record<string, unknown> }
): Finding[] {
  const findings: Finding[] = [];
  const compilerOptions = config.compilerOptions || {};

  if (!compilerOptions.strict) {
    findings.push({
      check: "strict-ts",
      rule: "strict-mode",
      severity: "error",
      message: "compilerOptions.strict is not enabled in tsconfig.",
      file: filePath,
      line: 1,
      column: 1,
      why: "Strict typing: Enables strict mode checks to force explicit typing and prevent unsafe assumptions.",
      suggestion: 'Set "compilerOptions": { "strict": true } in your tsconfig.json',
    });
  }

  if (!compilerOptions.noUncheckedIndexedAccess) {
    findings.push({
      check: "strict-ts",
      rule: RULE_NO_UNCHECKED_INDEXED_ACCESS,
      severity: "error",
      message: "compilerOptions.noUncheckedIndexedAccess is not enabled in tsconfig.",
      file: filePath,
      line: 1,
      column: 1,
      why: "Strict typing: Without noUncheckedIndexedAccess, array/record element lookups assume the value is always present instead of element | undefined.",
      suggestion: 'Set "compilerOptions": { "noUncheckedIndexedAccess": true } in your tsconfig.json',
    });
  }

  if (!compilerOptions.exactOptionalPropertyTypes) {
    findings.push({
      check: "strict-ts",
      rule: RULE_EXACT_OPTIONAL_PROPERTIES,
      severity: "warning",
      message: "compilerOptions.exactOptionalPropertyTypes is not enabled in tsconfig.",
      file: filePath,
      line: 1,
      column: 1,
      why: "Strict typing: exactOptionalPropertyTypes prevents assigning undefined to optional properties that require omission.",
      suggestion: 'Set "compilerOptions": { "exactOptionalPropertyTypes": true } in your tsconfig.json',
    });
  }

  return findings;
}

function checkNonNullAssertion(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding | null {
  if (ts.isNonNullExpression(node)) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    return {
      check: "strict-ts",
      rule: "no-non-null-assertion",
      severity: "error",
      message: "Forbidden non-null assertion operator (!) used.",
      file: filePath,
      line: line + 1,
      column: character + 1,
      excerpt: node.getText(sourceFile),
      why: "Type safety: Non-null assertion operator (!) forcibly bypasses null/undefined safety at compile time.",
      suggestion: "Use optional chaining (?.), a guard check, or fallback (??) instead of overriding TypeScript's null safety with !.",
    };
  }

  return null;
}

function checkExplicitAny(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding | null {
  if (node.kind === ts.SyntaxKind.AnyKeyword) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    return {
      check: "strict-ts",
      rule: "no-explicit-any",
      severity: "error",
      message: "Forbidden 'any' type used.",
      file: filePath,
      line: line + 1,
      column: character + 1,
      excerpt: node.parent ? node.parent.getText(sourceFile) : node.getText(sourceFile),
      why: "Type safety: Explicit any disables type checking.",
      suggestion: "Use 'unknown', a concrete domain type, a generic, or a Zod schema validation.",
    };
  }

  return null;
}

/**
 * Scan source code for non-null assertions and explicit any types.
 *
 * @param filePath Source file path.
 * @param code Source code contents.
 * @returns Array of strict TypeScript syntax findings.
 */
export function checkStrictTsCode(
  filePath: string,
  code: string,
  parsedSourceFile?: ts.SourceFile
): Finding[] {
  const findings: Finding[] = [];
  const sourceFile = parsedSourceFile ?? createSourceFile(filePath, code);

  function visit(node: ts.Node): void {
    const nonNull = checkNonNullAssertion(node, sourceFile, filePath);
    if (nonNull) findings.push(nonNull);

    const explicitAny = checkExplicitAny(node, sourceFile, filePath);
    if (explicitAny) findings.push(explicitAny);

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return findings;
}

export interface StrictTsProgramOptions {
  cwd?: string;
  tsconfigPath?: string;
  compilerOptions?: ts.CompilerOptions;
  host?: ts.CompilerHost;
  allowLooseTsConfig?: boolean | undefined;
}

enum DiagnosticCode {
  CannotFindName = 2304,
  CannotFindModule = 2307,
  CannotFindGlobalType = 2318,
  TypeNotAssignable = 2322,
  ArgumentNotAssignable = 2345,
  ExactOptionalProperty1 = 2375,
  ExactOptionalProperty2 = 2379,
  ExactOptionalProperty3 = 2412,
  PossiblyNull = 2531,
  PossiblyUndefined1 = 2532,
  PossiblyUndefined2 = 2533,
  NameDidYouMean = 2552,
  PropertyNoInitializer = 2564,
  CannotFindRequire = 2580,
  CannotFindProcess = 2581,
  CannotFindConsole = 2584,
  ImplicitThis1 = 2683,
  ImplicitThis2 = 2684,
  ImplicitThis3 = 7041,
  CannotFindTypeDef = 2688,
  UnusedLocalVariable = 6133,
  UnusedImport = 6192,
  UnusedTypeParam = 6196,
  ImplicitAnyVariable = 7005,
  ImplicitAnyParam = 7006,
  ImplicitAnyMember = 7008,
  CouldNotFindDeclFile = 7016,
  ImplicitAnyRestParam = 7019,
  ImplicitAnyVariableDeclared = 7034,
  ImplicitAnyNoIndexSignature = 7053,
  PossiblyNullGlobal = 18047,
  PossiblyUndefinedGlobal = 18048,
}

const IGNORED_SEMANTIC_CODES = new Set<number>([
  DiagnosticCode.CannotFindName,
  DiagnosticCode.CannotFindModule,
  DiagnosticCode.CannotFindGlobalType,
  DiagnosticCode.NameDidYouMean,
  DiagnosticCode.CannotFindRequire,
  DiagnosticCode.CannotFindProcess,
  DiagnosticCode.CannotFindConsole,
  DiagnosticCode.CannotFindTypeDef,
  DiagnosticCode.CouldNotFindDeclFile,
]);

const STRICT_RULE_MAP: Readonly<Record<number, string>> = {
  [DiagnosticCode.PossiblyUndefinedGlobal]: RULE_NO_UNCHECKED_INDEXED_ACCESS,
  [DiagnosticCode.PossiblyUndefined1]: RULE_NO_UNCHECKED_INDEXED_ACCESS,
  [DiagnosticCode.PossiblyUndefined2]: RULE_NO_UNCHECKED_INDEXED_ACCESS,
  [DiagnosticCode.ImplicitAnyParam]: RULE_NO_IMPLICIT_ANY,
  [DiagnosticCode.ImplicitAnyVariable]: RULE_NO_IMPLICIT_ANY,
  [DiagnosticCode.ImplicitAnyMember]: RULE_NO_IMPLICIT_ANY,
  [DiagnosticCode.ImplicitAnyRestParam]: RULE_NO_IMPLICIT_ANY,
  [DiagnosticCode.ImplicitAnyVariableDeclared]: RULE_NO_IMPLICIT_ANY,
  [DiagnosticCode.ImplicitAnyNoIndexSignature]: RULE_NO_IMPLICIT_ANY,
  [DiagnosticCode.PossiblyNullGlobal]: RULE_STRICT_NULL_CHECKS,
  [DiagnosticCode.PossiblyNull]: RULE_STRICT_NULL_CHECKS,
  [DiagnosticCode.PropertyNoInitializer]: RULE_STRICT_PROPERTY_INIT,
  [DiagnosticCode.ImplicitThis1]: RULE_NO_IMPLICIT_THIS,
  [DiagnosticCode.ImplicitThis2]: RULE_NO_IMPLICIT_THIS,
  [DiagnosticCode.ImplicitThis3]: RULE_NO_IMPLICIT_THIS,
  [DiagnosticCode.ExactOptionalProperty1]: RULE_EXACT_OPTIONAL_PROPERTIES,
  [DiagnosticCode.ExactOptionalProperty2]: RULE_EXACT_OPTIONAL_PROPERTIES,
  [DiagnosticCode.ExactOptionalProperty3]: RULE_EXACT_OPTIONAL_PROPERTIES,
  [DiagnosticCode.UnusedLocalVariable]: RULE_NO_UNUSED_LOCALS,
  [DiagnosticCode.UnusedImport]: RULE_NO_UNUSED_LOCALS,
  [DiagnosticCode.UnusedTypeParam]: RULE_NO_UNUSED_LOCALS,
};

const STRICT_SUGGESTION_MAP: Readonly<Record<number, string>> = {
  [DiagnosticCode.PossiblyUndefinedGlobal]: SUGGESTION_UNDEFINED_CHECK,
  [DiagnosticCode.PossiblyUndefined1]: SUGGESTION_UNDEFINED_CHECK,
  [DiagnosticCode.PossiblyUndefined2]: SUGGESTION_UNDEFINED_CHECK,
  [DiagnosticCode.ImplicitAnyParam]: SUGGESTION_IMPLICIT_ANY,
  [DiagnosticCode.ImplicitAnyVariable]: SUGGESTION_IMPLICIT_ANY,
  [DiagnosticCode.ImplicitAnyMember]: SUGGESTION_IMPLICIT_ANY,
  [DiagnosticCode.ImplicitAnyRestParam]: SUGGESTION_IMPLICIT_ANY,
  [DiagnosticCode.ImplicitAnyVariableDeclared]: SUGGESTION_IMPLICIT_ANY,
  [DiagnosticCode.ImplicitAnyNoIndexSignature]: SUGGESTION_IMPLICIT_ANY,
  [DiagnosticCode.PossiblyNullGlobal]: SUGGESTION_NULL_UNDEFINED,
  [DiagnosticCode.PossiblyNull]: SUGGESTION_NULL_UNDEFINED,
  [DiagnosticCode.TypeNotAssignable]: SUGGESTION_NULL_UNDEFINED,
  [DiagnosticCode.ArgumentNotAssignable]: SUGGESTION_NULL_UNDEFINED,
  [DiagnosticCode.PropertyNoInitializer]: "Initialize the property in declaration or within the constructor.",
  [DiagnosticCode.ImplicitThis1]: SUGGESTION_IMPLICIT_THIS,
  [DiagnosticCode.ImplicitThis2]: SUGGESTION_IMPLICIT_THIS,
  [DiagnosticCode.ImplicitThis3]: SUGGESTION_IMPLICIT_THIS,
  [DiagnosticCode.ExactOptionalProperty1]: SUGGESTION_EXACT_OPTIONAL,
  [DiagnosticCode.ExactOptionalProperty2]: SUGGESTION_EXACT_OPTIONAL,
  [DiagnosticCode.ExactOptionalProperty3]: SUGGESTION_EXACT_OPTIONAL,
  [DiagnosticCode.UnusedLocalVariable]: SUGGESTION_UNUSED_DECL,
  [DiagnosticCode.UnusedImport]: SUGGESTION_UNUSED_DECL,
  [DiagnosticCode.UnusedTypeParam]: SUGGESTION_UNUSED_DECL,
};

const DEFAULT_STRICT_SUGGESTION = "Ensure code satisfies TypeScript strict mode checks.";

function getStrictRule(code: number, message: string): string | null {
  const directRule = STRICT_RULE_MAP[code];
  if (directRule) {
    return directRule;
  }

  const isAssignableCheck = code === DiagnosticCode.TypeNotAssignable || code === DiagnosticCode.ArgumentNotAssignable;
  if (isAssignableCheck && (message.includes("'null'") || message.includes("'undefined'"))) {
    return RULE_STRICT_NULL_CHECKS;
  }

  return null;
}

function getStrictSuggestion(code: number): string {
  return STRICT_SUGGESTION_MAP[code] ?? DEFAULT_STRICT_SUGGESTION;
}

function resolveStrictCompilerOptions(
  cwd: string,
  options: StrictTsProgramOptions
): { compilerOptions: ts.CompilerOptions; ambientDts: string[] } {
  const parsedConfig = loadParsedCommandLine(cwd, options.tsconfigPath);

  const baseOptions = parsedConfig?.options || {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
  };

  const compilerOptions: ts.CompilerOptions = {
    ...baseOptions,
    strict: true,
    noImplicitAny: true,
    strictNullChecks: true,
    strictFunctionTypes: true,
    strictBindCallApply: true,
    strictPropertyInitialization: true,
    noImplicitThis: true,
    alwaysStrict: true,
    useUnknownInCatchVariables: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noUnusedLocals: true,
    skipLibCheck: true,
    noEmit: true,
    ...options.compilerOptions,
  };

  const ambientDts =
    parsedConfig?.fileNames.filter((fileName) => fileName.endsWith(".d.ts")) || [];

  return { compilerOptions, ambientDts };
}

function mapDiagnosticToFinding(
  diag: ts.Diagnostic,
  cwd: string,
  filePath: string,
  allowLooseTsConfig = false
): Finding | null {
  if (!diag.file || diag.start === undefined) return null;
  if (IGNORED_SEMANTIC_CODES.has(diag.code)) return null;

  const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
  const message = ts.flattenDiagnosticMessageText(diag.messageText, " ");
  const rule = getStrictRule(diag.code, message);
  if (!rule) return null;

  const severity =
    rule === "exact-optional-property-types" ||
    rule === "no-unused-locals" ||
    (rule === RULE_NO_IMPLICIT_ANY && allowLooseTsConfig) ||
    diag.category === ts.DiagnosticCategory.Warning
      ? "warning"
      : "error";
  const finding: Finding = {
    check: "strict-ts",
    rule,
    severity,
    message,
    file: path.relative(cwd, filePath),
    line: line + 1,
    column: character + 1,
    why: `Strict typing enforcement: ${message}`,
    suggestion: getStrictSuggestion(diag.code),
  };

  if (diag.length !== undefined) {
    finding.excerpt = diag.file.text.substring(diag.start, diag.start + diag.length);
  }

  return finding;
}

/**
 * Run TypeScript type checker diagnostics across target files.
 *
 * @param targetFiles Target file paths to check.
 * @param options Type checker configuration options.
 * @returns Array of compiler diagnostic findings.
 */
export function checkStrictTsProgram(
  targetFiles: string[],
  options: StrictTsProgramOptions = {}
): Finding[] {
  const cwd = path.resolve(options.cwd || process.cwd());
  const allowLooseTsConfig = Boolean(options.allowLooseTsConfig);
  const tsFiles = targetFiles
    .filter((file) => /\.(ts|tsx|mts|cts)$/.test(file))
    .map((file) => path.resolve(cwd, file));
  if (tsFiles.length === 0) {
    return [];
  }

  const { compilerOptions, ambientDts } = resolveStrictCompilerOptions(cwd, options);
  const rootNames = Array.from(new Set([...tsFiles, ...ambientDts]));

  const programOptions: ts.CreateProgramOptions = {
    rootNames,
    options: compilerOptions,
  };
  if (options.host) {
    programOptions.host = options.host;
  }

  let program: ts.Program;
  try {
    program = ts.createProgram(programOptions);
  } catch {
    return [];
  }

  const findings: Finding[] = [];

  for (const filePath of tsFiles) {
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) continue;

    const diags = program.getSemanticDiagnostics(sourceFile);
    for (const diag of diags) {
      const finding = mapDiagnosticToFinding(diag, cwd, filePath, allowLooseTsConfig);
      if (finding) {
        findings.push(finding);
      }
    }
  }

  return findings;
}
