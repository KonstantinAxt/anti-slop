import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import * as ts from "typescript";
import type { CrapEntry, Finding } from "../types.js";
import { createSourceFile } from "./ast.js";
import { detectTestSetup, filterProductionFilesForMutation } from "./stryker-runner.js";

export const filterProductionFilesForCrap = filterProductionFilesForMutation;

export const CHECK_NAME = "crap-metric";
export const RULE_NAME = "high-crap-risk";
export const DEFAULT_CRAP_THRESHOLD = 30;
export const CRAP_LOW_RISK_THRESHOLD = 5;

const PERCENT_FACTOR = 100;
const COMPLEXITY_EXPONENT = 2;
const UNCOVERED_EXPONENT = 3;
const SCORE_ROUNDING_SCALE = 10;
const COVERAGE_PERCENT_SCALE = 1000;
const SF_PREFIX_LENGTH = 3;
const DA_PREFIX_LENGTH = 3;
const DA_MIN_PARTS = 2;
const RADIX_DECIMAL = 10;
const DEFAULT_TIMEOUT_COVERAGE_MS = 300_000;
const TIMEOUT_COVERAGE_MS = Number(process.env.ANTI_SLOP_COVERAGE_TIMEOUT_MS) || DEFAULT_TIMEOUT_COVERAGE_MS;

const FN_COL_WIDTH = 30;
const FILE_COL_WIDTH = 40;
const CC_COL_WIDTH = 5;
const COV_COL_WIDTH = 8;
const CRAP_COL_WIDTH = 8;


const NESTED_BOUNDARY_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

export interface ExtractedFunction {
  name: string;
  startLine: number;
  endLine: number;
  complexity: number;
  node: ts.FunctionLikeDeclaration;
}

export interface FileCoverage {
  lines: Map<number, boolean>;
}

export interface FormatCrapOptions {
  useColor?: boolean;
}
export interface CrapCheckResult {
  findings: Finding[];
  entries: CrapEntry[];
}


/**
 * Calculate CRAP (Change Risk Anti-Pattern) score:
 * CRAP(m) = CC(m)^2 * (1 - cov(m))^3 + CC(m)
 *
 * @param complexity Cyclomatic complexity of the function
 * @param coveragePct Percentage of line coverage (0 to 100)
 * @returns CRAP score rounded to 1 decimal place
 */
export function calculateCrapScore(complexity: number, coveragePct: number): number {
  const covFraction = Math.max(0, Math.min(PERCENT_FACTOR, coveragePct)) / PERCENT_FACTOR;
  const uncov = 1.0 - covFraction;
  const crap =
    Math.pow(complexity, COMPLEXITY_EXPONENT) * Math.pow(uncov, UNCOVERED_EXPONENT) + complexity;

  return Math.round(crap * SCORE_ROUNDING_SCALE) / SCORE_ROUNDING_SCALE;
}



function isBranchingStatement(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.IfStatement ||
    kind === ts.SyntaxKind.ConditionalExpression ||
    kind === ts.SyntaxKind.ForStatement ||
    kind === ts.SyntaxKind.ForInStatement ||
    kind === ts.SyntaxKind.ForOfStatement ||
    kind === ts.SyntaxKind.WhileStatement ||
    kind === ts.SyntaxKind.DoStatement ||
    kind === ts.SyntaxKind.CaseClause ||
    kind === ts.SyntaxKind.CatchClause
  );
}

function isShortCircuitOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken
  );
}

function hasOptionalChaining(node: ts.Node): boolean {
  return (
    (ts.isPropertyAccessChain(node) ||
      ts.isElementAccessChain(node) ||
      ts.isCallChain(node)) &&
    node.questionDotToken !== undefined
  );
}

/**
 * Count cyclomatic complexity of a function node.
 * McCabe cyclomatic complexity: 1 + number of branching decision points.
 * Does not traverse into nested functions (each nested function has its own complexity).
 *
 * @param node Function AST node.
 * @returns Cyclomatic complexity number.
 */
function countCyclomaticComplexity(node: ts.FunctionLikeDeclaration): number {
  let complexity = 1;

  function visit(current: ts.Node): void {
    if (current !== node && NESTED_BOUNDARY_KINDS.has(current.kind)) {
      return;
    }

    if (
      isBranchingStatement(current.kind) ||
      (ts.isBinaryExpression(current) && isShortCircuitOperator(current.operatorToken.kind)) ||
      hasOptionalChaining(current)
    ) {
      complexity += 1;
    }

    ts.forEachChild(current, visit);
  }

  if (node.body) {
    visit(node.body);
  }

  return complexity;
}

function resolveAssignedName(parent: ts.Node): string | null {
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyAssignment(parent)) {
    return parent.name.getText();
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return parent.left.getText();
  }

  return null;
}

function resolveBaseName(node: ts.FunctionLikeDeclaration): string {
  if (ts.isFunctionDeclaration(node)) {
    return node.name?.text ?? "(anonymous function)";
  }
  if (ts.isMethodDeclaration(node)) {
    return node.name.getText();
  }
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }
  if (ts.isGetAccessorDeclaration(node)) {
    return `get ${node.name.getText()}`;
  }
  if (ts.isSetAccessorDeclaration(node)) {
    return `set ${node.name.getText()}`;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const assigned = resolveAssignedName(node.parent);
    if (assigned) {
      return assigned;
    }
  }

  return "(anonymous)";
}

function resolveFunctionName(node: ts.FunctionLikeDeclaration): string {
  const baseName = resolveBaseName(node);

  let currentParent: ts.Node | undefined = node.parent;
  while (currentParent) {
    if (
      (ts.isClassDeclaration(currentParent) || ts.isClassExpression(currentParent)) &&
      currentParent.name
    ) {
      return `${currentParent.name.text}.${baseName}`;
    }
    currentParent = currentParent.parent;
  }

  return baseName;
}

function isExecutableFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)) &&
    Boolean(node.body)
  );
}

/**
 * Extract all executable functions and methods with line numbers and cyclomatic complexity.
 *
 * @param sourceFile TypeScript SourceFile node.
 * @returns Array of extracted functions.
 */
export function extractFunctions(sourceFile: ts.SourceFile): ExtractedFunction[] {
  const functions: ExtractedFunction[] = [];

  function visit(node: ts.Node): void {
    if (isExecutableFunction(node)) {
      const name = resolveFunctionName(node);
      const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const complexity = countCyclomaticComplexity(node);

      functions.push({
        name,
        startLine,
        endLine,
        complexity,
        node,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return functions;
}

export function parseLcovDaLine(line: string, currentLines: Map<number, boolean>): void {
  const parts = line.slice(DA_PREFIX_LENGTH).split(",");
  if (parts.length >= DA_MIN_PARTS) {
    const rawLine = parts[0];
    const rawCount = parts[1];
    if (rawLine !== undefined && rawCount !== undefined) {
      const lineNum = parseInt(rawLine, RADIX_DECIMAL);
      const count = parseInt(rawCount, RADIX_DECIMAL);
      if (!isNaN(lineNum) && !isNaN(count)) {
        currentLines.set(lineNum, count > 0);
      }
    }
  }
}

/**
 * Parse LCOV string format into map of file path -> line coverage.
 *
 * @param content LCOV report text.
 * @returns Map of normalized file paths to line coverage maps.
 */
export function parseLcov(content: string): Map<string, FileCoverage> {
  const result = new Map<string, FileCoverage>();
  const lines = content.split(/\r?\n/);
  let currentFile: string | null = null;
  let currentLines = new Map<number, boolean>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("SF:")) {
      currentFile = trimmed.slice(SF_PREFIX_LENGTH).trim();
      currentLines = new Map<number, boolean>();
    } else if (trimmed.startsWith("DA:")) {
      parseLcovDaLine(trimmed, currentLines);
    } else if (trimmed === "end_of_record") {
      if (currentFile) {
        result.set(path.normalize(currentFile), { lines: currentLines });
        currentFile = null;
      }
    }
  }

  if (currentFile) {
    result.set(path.normalize(currentFile), { lines: currentLines });
  }

  return result;
}

export function findFileCoverage(
  coverageMap: Map<string, FileCoverage>,
  targetFilePath: string,
  cwd: string
): FileCoverage | undefined {
  const absTarget = path.resolve(cwd, targetFilePath);
  const relTarget = path.relative(cwd, absTarget);

  for (const [covPath, fileCov] of coverageMap.entries()) {
    const absCov = path.isAbsolute(covPath) ? path.normalize(covPath) : path.resolve(cwd, covPath);
    if (absCov === absTarget) {
      return fileCov;
    }
    const relCov = path.relative(cwd, absCov);
    if (relCov === relTarget) {
      return fileCov;
    }
  }

  return undefined;
}

/**
 * Compute line coverage percentage for a line span [startLine, endLine].
 *
 * @param fileCoverage Coverage data for the file.
 * @param startLine Function start line.
 * @param endLine Function end line.
 * @returns Coverage percentage (0.0 to 100.0).
 */
export function coverageForRange(
  fileCoverage: FileCoverage | undefined,
  startLine: number,
  endLine: number
): number {
  if (!fileCoverage) {
    return 0.0;
  }

  let totalTracked = 0;
  let coveredTracked = 0;

  for (let line = startLine; line <= endLine; line++) {
    if (fileCoverage.lines.has(line)) {
      totalTracked += 1;
      if (fileCoverage.lines.get(line) === true) {
        coveredTracked += 1;
      }
    }
  }

  if (totalTracked === 0) {
    return 0.0;
  }

  return Math.round((coveredTracked / totalTracked) * COVERAGE_PERCENT_SCALE) / SCORE_ROUNDING_SCALE;
}

function resolveCoverageCommand(testCommand: string): string {
  if (testCommand.includes("bun test")) {
    return "bun test --coverage --coverage-reporter=lcov --coverage-dir=reports/coverage";
  }
  if (testCommand.includes("vitest")) {
    return `${testCommand} --coverage`;
  }
  if (testCommand.includes("jest")) {
    return `${testCommand} --coverage --coverageReporters=lcov`;
  }

  return `${testCommand} --coverage`;
}

function readExistingCoverageFile(candidateFiles: string[]): string | null {
  for (const cand of candidateFiles) {
    if (fs.existsSync(cand)) {
      try {
        return fs.readFileSync(cand, "utf-8");
      } catch (err: unknown) {
        void err;
      }
    }
  }

  return null;
}

function loadOrGenerateCoverage(cwd: string): string | null {
  const candidateFiles = [
    path.join(cwd, "reports/coverage/lcov.info"),
    path.join(cwd, "reports/coverage/lcov.clean.info"),
    path.join(cwd, "coverage/lcov.info"),
    path.join(cwd, "coverage/lcov.clean.info"),
    path.join(cwd, "lcov.info"),
  ];

  const existing = readExistingCoverageFile(candidateFiles);
  if (existing) {
    return existing;
  }

  const detected = detectTestSetup(cwd);
  if (!detected) {
    return null;
  }

  const coverageCmd = resolveCoverageCommand(detected.testCommand);
  try {
    execSync(coverageCmd, {
      cwd,
      stdio: "pipe",
      timeout: TIMEOUT_COVERAGE_MS,
      env: { ...process.env, CI: "true" },
    });
  } catch (err: unknown) {
    void err;
  }

  return readExistingCoverageFile(candidateFiles);
}

function formatCrapScoreColored(score: number): string {
  const BOLD = "\x1b[1m";
  const RED = "\x1b[31m";
  const YELLOW = "\x1b[33m";
  const GREEN = "\x1b[32m";
  const RESET = "\x1b[0m";

  const rawStr = score.toFixed(1).padStart(CRAP_COL_WIDTH);
  if (score > DEFAULT_CRAP_THRESHOLD) {
    return `${RED}${BOLD}${rawStr}${RESET}`;
  }
  if (score > CRAP_LOW_RISK_THRESHOLD) {
    return `${YELLOW}${rawStr}${RESET}`;
  }

  return `${GREEN}${rawStr}${RESET}`;
}

/**
 * Format CRAP analysis results into a tabular report string (Uncle Bob style).
 *
 * @param entries Array of CRAP entries.
 * @param options Formatting options (useColor).
 * @returns Formatted table string.
 */
export function formatCrapReport(entries: CrapEntry[], options: FormatCrapOptions = {}): string {
  if (entries.length === 0) {
    return "CRAP Report\n===========\nNo analyzed functions found.\n";
  }

  const sorted = [...entries].sort((first, second) => second.crap - first.crap);

  const header =
    "Function".padEnd(FN_COL_WIDTH) + " " +
    "File".padEnd(FILE_COL_WIDTH) + " " +
    "CC".padStart(CC_COL_WIDTH) + " " +
    "Cov%".padStart(COV_COL_WIDTH) + " " +
    "CRAP".padStart(CRAP_COL_WIDTH);

  const sep = "-".repeat(header.length);

  const lines = [
    "CRAP Report",
    "===========",
    header,
    sep,
  ];

  for (const entry of sorted) {
    const fnName =
      entry.functionName.length > FN_COL_WIDTH
        ? `${entry.functionName.slice(0, FN_COL_WIDTH - 1)}…`
        : entry.functionName;
    const file =
      entry.file.length > FILE_COL_WIDTH
        ? `…${entry.file.slice(-(FILE_COL_WIDTH - 1))}`
        : entry.file;
    const cc = entry.complexity.toString().padStart(CC_COL_WIDTH);
    const cov = `${entry.coverage.toFixed(1)}%`.padStart(COV_COL_WIDTH);
    const crapStr = options.useColor
      ? formatCrapScoreColored(entry.crap)
      : entry.crap.toFixed(1).padStart(CRAP_COL_WIDTH);

    lines.push(
      `${fnName.padEnd(FN_COL_WIDTH)} ${file.padEnd(FILE_COL_WIDTH)} ${cc} ${cov} ${crapStr}`
    );
  }

  lines.push("");

  return lines.join("\n");
}

function analyzeFileFunctions(
  fullPath: string,
  relPath: string,
  coverageMap: Map<string, FileCoverage>,
  cwd: string,
  threshold: number
): { fileFindings: Finding[]; fileEntries: CrapEntry[] } {
  let code = "";
  try {
    code = fs.readFileSync(fullPath, "utf-8");
  } catch (err: unknown) {
    void err;

    return { fileFindings: [], fileEntries: [] };
  }

  const sourceFile = createSourceFile(fullPath, code);
  const fileCoverage = findFileCoverage(coverageMap, fullPath, cwd);
  const extractedFns = extractFunctions(sourceFile);
  const fileFindings: Finding[] = [];
  const fileEntries: CrapEntry[] = [];

  for (const fn of extractedFns) {
    const covPct = coverageForRange(fileCoverage, fn.startLine, fn.endLine);
    const crap = calculateCrapScore(fn.complexity, covPct);

    fileEntries.push({
      functionName: fn.name,
      file: relPath,
      line: fn.startLine,
      complexity: fn.complexity,
      coverage: covPct,
      crap,
    });

    if (crap > threshold) {
      fileFindings.push({
        check: CHECK_NAME,
        rule: RULE_NAME,
        severity: "error",
        message: `CRAP score ${crap.toFixed(1)} exceeds threshold ${threshold} in '${fn.name}' (CC: ${fn.complexity}, Coverage: ${covPct.toFixed(1)}%)`,
        file: relPath,
        line: fn.startLine,
        column: 1,
        why: "CRAP (Change Risk Anti-Pattern) indicates code that is both complex and insufficiently tested, making modifications highly risky.",
        suggestion: "Add unit tests to cover missing execution paths or refactor to reduce cyclomatic complexity.",
      });
    }
  }

  return { fileFindings, fileEntries };
}

/**
 * Run CRAP (Change Risk Anti-Pattern) analysis across target files.
 *
 * @param cwd Current working directory.
 * @param targetFiles Optional list of target files.
 * @param threshold CRAP score threshold above which a finding is emitted (default 30).
 * @param explicitLcov Optional raw LCOV string for testing/mocking.
 * @returns Object containing findings and detailed crap entries.
 */
export async function checkCrap(
  cwd: string,
  targetFiles?: string[],
  threshold: number = DEFAULT_CRAP_THRESHOLD,
  explicitLcov?: string
): Promise<CrapCheckResult> {
  const prodFiles = filterProductionFilesForCrap(cwd, targetFiles);
  if (targetFiles && targetFiles.length > 0 && prodFiles.length === 0) {
    return { findings: [], entries: [] };
  }

  const filesToScan = prodFiles.length > 0 ? prodFiles : (targetFiles ?? []);
  const lcovContent = explicitLcov ?? loadOrGenerateCoverage(cwd);
  const coverageMap = lcovContent ? parseLcov(lcovContent) : new Map<string, FileCoverage>();

  const findings: Finding[] = [];
  const entries: CrapEntry[] = [];

  if (!lcovContent && filesToScan.length > 0) {
    findings.push({
      check: CHECK_NAME,
      rule: "crap-coverage-missing",
      severity: "warning",
      message: "No test coverage report found; assuming 0% coverage for CRAP scoring.",
      file: path.join(cwd, "package.json"),
      line: 1,
      column: 1,
      why: "CRAP calculation requires test coverage. Without coverage data, all functions are treated as uncovered (cov=0%).",
      suggestion: "Configure tests with coverage (e.g. 'bun test --coverage' or Vitest/Jest coverage) to produce coverage/lcov.info.",
    });
  }

  for (const filePath of filesToScan) {
    const fullPath = path.resolve(cwd, filePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }

    const relPath = path.relative(cwd, fullPath);
    const { fileFindings, fileEntries } = analyzeFileFunctions(
      fullPath,
      relPath,
      coverageMap,
      cwd,
      threshold
    );

    findings.push(...fileFindings);
    entries.push(...fileEntries);
  }

  return { findings, entries };
}
