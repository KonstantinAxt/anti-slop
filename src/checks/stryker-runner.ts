import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { MutantResult } from "@stryker-mutator/api/core";
import { Stryker } from "@stryker-mutator/core";
import type { Finding, MutationScoreMetrics } from "../types.js";

export interface StrykerOptions {
  minScore?: number | undefined;
  concurrency?: number | undefined;
  maxMutationFiles?: number | undefined;
}

export interface StrykerCheckResult {
  findings: Finding[];
  metrics?: MutationScoreMetrics;
}

const MAX_CONCURRENCY = 8;
const BYTES_PER_MB = 1048576;
const BYTES_PER_GB = 1073741824;
const BYTES_PER_WORKER_RAM = 1610612736; // 1.5 GB
const MIN_PARALLEL_CPUS = 2;
const CI_FALLBACK_CPUS = 4;
const CRITICAL_LOW_MEMORY_BYTES = 157286400; // 150 MB
const DARWIN_CRITICAL_LOW_MEMORY_BYTES = 52428800; // 50 MB
const MIN_FREE_MEMORY_BYTES = 2684354560; // 2.5 GB
const DEFAULT_MAX_MUTATION_FILES = 8;
const MAX_MUTATION_FILES = parseInt(process.env.ANTI_SLOP_MAX_MUTATION_FILES ?? "8", 10) || DEFAULT_MAX_MUTATION_FILES;
const PER_MUTANT_TIMEOUT_MS = 10000; // 10 seconds
const DRY_RUN_TIMEOUT_MINUTES = 2; // 2 minutes
const MAX_TEST_RUNNER_REUSE = 20;
const SCORE_SCALE_NUMERATOR = 1000;
const SCORE_SCALE_DENOMINATOR = 10;
const PERFECT_SCORE = 100;

const CHECK_NAME = "mutation-test";
const STRYKER_CONFIG_FILES = [
  "stryker.config.json",
  "stryker.config.mjs",
  "stryker.config.js",
  "stryker.config.cjs",
  "stryker.conf.js",
  "stryker.conf.json",
];

const TEST_FILE_PATTERN =
  /\.(test|spec|stories|story)\.[jt]sx?$|__(tests|mocks|fixtures|snapshots)__|\.storybook\/|\.config\.[jt]s$|setup\.[jt]s$/;
const PROD_CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const PACKAGE_JSON_FILE = "package.json";
const IGNORED_PATH_PREFIXES = [
  "node_modules/",
  "dist/",
  "build/",
  ".git/",
  ".next/",
  ".turbo/",
  "e2e-fixtures/",
  "artifacts/",
  "bin/",
  "scripts/",
];

/**
 * Filter target file list down to mutable production files.
 *
 * @param cwd Current working directory.
 * @param files Optional file list.
 * @returns Array of production file glob patterns.
 */
export function filterProductionFilesForMutation(
  cwd: string,
  files?: string[]
): string[] {
  if (!files || files.length === 0) {
    return ["src/**/*.{ts,js,tsx,jsx}", "!src/**/*.d.ts"];
  }

  return files
    .map((file) => path.relative(cwd, path.resolve(cwd, file)))
    .filter((rel) => {
      if (rel.endsWith(".d.ts")) return false;
      if (!PROD_CODE_EXTENSIONS.has(path.extname(rel))) return false;
      if (TEST_FILE_PATTERN.test(rel)) return false;
      const normalized = rel.replace(/\\/g, "/");
      if (IGNORED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix) || normalized.includes(`/${prefix}`))) {
        return false;
      }

      return true;
    });
}
function hasStrykerConfig(cwd: string): boolean {
  return STRYKER_CONFIG_FILES.some((file) => fs.existsSync(path.join(cwd, file)));
}

export interface DetectedTestSetup {
  packageManager: "npm" | "pnpm" | "yarn";
  testCommand: string;
}
export interface SynthesizedStrykerConfig {
  [key: string]: unknown;
  packageManager?: "npm" | "pnpm" | "yarn";
  testRunner?: string;
  commandRunner?: { command: string };
  coverageAnalysis?: "off" | "all" | "perTest";
  concurrency?: number;
  mutate?: string[];
  disableTypeChecks?: string | boolean;
  ignorePatterns?: string[];
  incremental?: boolean;
  incrementalFile?: string;
  ignoreStatic?: boolean;
  timeoutMS?: number;
  dryRunTimeoutMinutes?: number;
  maxTestRunnerReuse?: number;
  reporters?: string[];
}
const JEST_RUN_CMD = "jest --watchAll=false";
const BUN_TEST_CMD = "bun test";
const EXCLUDE_STRYKER_TMP = '--exclude "**/.stryker-tmp/**"';
const BUN_IGNORE_E2E = '--path-ignore-patterns="tests/e2e-.*\\.test\\.ts"';
const DEFAULT_IGNORE_PATTERNS = [
  ".claude/**",
  "spad/**",
  ".spad/**",
  "dist/**",
  "build/**",
  "coverage/**",
  "reports/**",
  "documentation/**",
  ".github/**",
  ".git/**",
  "tmp/**",
  ".tmp/**",
  "node_modules/.cache/**",
];
const DEFAULT_INCREMENTAL_FILE = "reports/mutation/stryker-incremental.json";
export function extractObjectKeys(obj: unknown): string[] {
  if (typeof obj !== "object" || obj === null) return [];

  return Object.keys(obj);
}

function extractDependencies(parsed: object, field: string, target: Set<string>): void {
  if (field in parsed) {
    const val = Reflect.get(parsed, field);
    for (const key of extractObjectKeys(val)) {
      target.add(key);
    }
  }
}

export function extractTestScript(parsed: object): string {
  if ("scripts" in parsed) {
    const scripts = Reflect.get(parsed, "scripts");
    if (typeof scripts === "object" && scripts !== null && "test" in scripts) {
      const test = Reflect.get(scripts, "test");
      if (typeof test === "string") return test;
    }
  }

  return "";
}

function parsePackageJson(pkgPath: string): { testScript: string; allDeps: Set<string> } {
  const allDeps = new Set<string>();
  if (!fs.existsSync(pkgPath)) return { testScript: "", allDeps };

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (typeof parsed === "object" && parsed !== null) {
      const testScript = extractTestScript(parsed);
      extractDependencies(parsed, "dependencies", allDeps);
      extractDependencies(parsed, "devDependencies", allDeps);

      return { testScript, allDeps };
    }
  } catch (err: unknown) {
    void err;
  }

  return { testScript: "", allDeps };
}

function hasConfigFile(cwd: string, filenames: string[]): boolean {
  return filenames.some((file) => fs.existsSync(path.join(cwd, file)));
}
export function buildVitestCommand(
  testScript: string,
  runnerPrefix: string,
  targetArgs: string
): string {
  const subCmd = targetArgs ? `related ${targetArgs} --run` : "run";
  if (!testScript) {
    return `${runnerPrefix} vitest ${subCmd} ${EXCLUDE_STRYKER_TMP}`;
  }

  const pattern = /\b(?:npx|pnpm(?:\s+exec)?|bunx|yarn)?\s*\bvitest(?:\s+(?:run|--run|-r))?\b/;
  if (pattern.test(testScript)) {
    const replaced = testScript.replace(
      pattern,
      `${runnerPrefix} vitest ${subCmd} ${EXCLUDE_STRYKER_TMP}`
    );

    let seenRun = false;

    return replaced
      .split(" ")
      .filter((token) => {
        if (token === "--run") {
          if (seenRun) return false;
          seenRun = true;
        }

        return true;
      })
      .join(" ");
  }

  return `${testScript} ${EXCLUDE_STRYKER_TMP}`;
}
export function findNearestOwningTest(cwd: string, sourceFile: string): string | null {
  const parsed = path.parse(sourceFile);
  const candidates = [
    path.join(parsed.dir, `${parsed.name}.test${parsed.ext}`),
    path.join("tests", `${parsed.name}.test${parsed.ext}`),
    path.join("tests", `${parsed.name}.test.ts`),
  ];

  if (parsed.name === "index") {
    candidates.push(path.join("tests", "runner.test.ts"));
  }
  if (parsed.name === "anti-slop" || sourceFile.endsWith("bin/anti-slop")) {
    candidates.push(path.join("tests", "cli.test.ts"));
  }

  for (const candidate of candidates) {
    const fullPath = cwd ? path.join(cwd, candidate) : candidate;
    if (fs.existsSync(fullPath)) {
      return candidate;
    }
  }

  return null;
}

export function buildBunCommand(cwd: string = "", mutateFiles: string[] = []): string {
  if (mutateFiles.length === 0 || mutateFiles.some((file) => file.includes("*"))) {
    return `${BUN_TEST_CMD} ${BUN_IGNORE_E2E} --bail=1`;
  }

  const targets = mutateFiles.map((file) => {
    const owning = findNearestOwningTest(cwd, file);
    if (owning) return owning;

    const parsed = path.parse(file);

    return path.join("tests", `${parsed.name}.test.ts`);
  });

  return `${BUN_TEST_CMD} ${targets.join(" ")} ${BUN_IGNORE_E2E} --bail=1`;
}

function resolveScriptCommand(
  cwd: string,
  testScript: string,
  isBun: boolean,
  packageManager: "npm" | "pnpm" | "yarn",
  runnerPrefix: string,
  mutateFiles: string[] = []
): string {
  const targetArgs = mutateFiles.join(" ");
  if (testScript.includes("vitest")) {
    return buildVitestCommand(testScript, runnerPrefix, targetArgs);
  }
  if (testScript.includes("jest")) {
    const relatedFlag = targetArgs ? ` --findRelatedTests ${targetArgs}` : "";

    return `${runnerPrefix} ${JEST_RUN_CMD}${relatedFlag}`;
  }
  if (isBun) {
    return buildBunCommand(cwd, mutateFiles);
  }

  return `${packageManager} test`;
}

function resolveTestCommand(
  cwd: string,
  testScript: string,
  allDeps: Set<string>,
  isBun: boolean,
  packageManager: "npm" | "pnpm" | "yarn",
  runnerPrefix: string,
  mutateFiles: string[] = []
): string {
  const targetArgs = mutateFiles.join(" ");
  if (testScript && !testScript.includes("no test specified")) {
    return resolveScriptCommand(cwd, testScript, isBun, packageManager, runnerPrefix, mutateFiles);
  }
  if (allDeps.has("vitest") || hasConfigFile(cwd, ["vitest.config.ts", "vitest.config.js", "vitest.config.mjs"])) {
    return buildVitestCommand("", runnerPrefix, targetArgs);
  }
  if (allDeps.has("jest") || hasConfigFile(cwd, ["jest.config.ts", "jest.config.js", "jest.config.json"])) {
    const relatedFlag = targetArgs ? ` --findRelatedTests ${targetArgs}` : "";

    return `${runnerPrefix} ${JEST_RUN_CMD}${relatedFlag}`;
  }
  if (isBun) {
    return buildBunCommand(cwd, mutateFiles);
  }

  return "";
}

/**
 * Detect package manager and test runner command in workspace.
 *
 * @param cwd Workspace root directory.
 * @returns Detected test configuration or null if unsupported.
 */
export function detectTestSetup(cwd: string, mutateFiles: string[] = []): DetectedTestSetup | null {
  const { testScript, allDeps } = parsePackageJson(path.join(cwd, PACKAGE_JSON_FILE));
  const isBun =
    fs.existsSync(path.join(cwd, "bun.lock")) ||
    fs.existsSync(path.join(cwd, "bun.lockb"));
  const isPnpm = fs.existsSync(path.join(cwd, "pnpm-lock.yaml"));
  const isYarn = fs.existsSync(path.join(cwd, "yarn.lock"));
  let packageManager: "npm" | "pnpm" | "yarn" = "npm";
  if (isPnpm) {
    packageManager = "pnpm";
  } else if (isYarn) {
    packageManager = "yarn";
  }

  let runnerPrefix = "npx";
  if (isBun) {
    runnerPrefix = "bunx";
  } else if (isPnpm) {
    runnerPrefix = "pnpm exec";
  }
  const testCommand = resolveTestCommand(cwd, testScript, allDeps, isBun, packageManager, runnerPrefix, mutateFiles);
  if (!testCommand) {
    return null;
  }

  return { packageManager, testCommand };
}
export function getOptimalConcurrency(requested?: number): number {
  if (requested !== undefined && requested > 0) {
    return requested;
  }

  const envVal = process.env.ANTI_SLOP_MUTATION_CONCURRENCY;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const freeMem = os.freemem();
  if (freeMem < MIN_FREE_MEMORY_BYTES) {
    return 1;
  }

  const cpuCount = os.cpus().length;
  const memWorkers = Math.max(1, Math.floor(freeMem / BYTES_PER_WORKER_RAM));
  const cpuWorkers =
    cpuCount <= MIN_PARALLEL_CPUS
      ? 1
      : Math.max(1, cpuCount <= CI_FALLBACK_CPUS ? cpuCount - 1 : Math.min(MAX_CONCURRENCY, cpuCount - MIN_PARALLEL_CPUS));

  return Math.min(cpuWorkers, memWorkers);
}
/**
 * Construct synthesized Stryker configuration options.
 *
 * @param cwd Workspace root directory.
 * @param mutateFiles List of files to mutate.
 * @param concurrency Optional concurrency override.
 * @returns Stryker options object or configuration error finding.
 */
export function buildStrykerOptions(
  cwd: string,
  mutateFiles: string[],
  concurrency?: number
): { options?: SynthesizedStrykerConfig; errorFinding?: Finding } {
  const hasConfig = hasStrykerConfig(cwd);

  if (hasConfig) {
    return {
      options: {
        mutate: mutateFiles,
        reporters: [],
        concurrency: getOptimalConcurrency(concurrency),
      },
    };
  }

  const detected = detectTestSetup(cwd, mutateFiles);
  if (!detected) {
    return {
      errorFinding: {
        check: CHECK_NAME,
        rule: "stryker-config-missing",
        severity: "warning",
        message: "No Stryker configuration or test runner detected in target repository.",
        file: path.join(cwd, PACKAGE_JSON_FILE),
        line: 1,
        column: 1,
        why: "Mutation testing requires a test runner (e.g. bun test, vitest, jest) configured in package.json or stryker.config.json.",
        suggestion: "Add a 'test' script in package.json or create a stryker.config.json.",
      },
    };
  }

  return {
    options: {
      packageManager: detected.packageManager,
      testRunner: "command",
      commandRunner: { command: detected.testCommand },
      coverageAnalysis: "off",
      concurrency: getOptimalConcurrency(concurrency),
      mutate: mutateFiles,
      disableTypeChecks: "{src,lib,test,tests}/**/*.{js,ts,jsx,tsx}",
      ignorePatterns: DEFAULT_IGNORE_PATTERNS,
      incremental: true,
      incrementalFile: DEFAULT_INCREMENTAL_FILE,
      timeoutMS: PER_MUTANT_TIMEOUT_MS,
      dryRunTimeoutMinutes: DRY_RUN_TIMEOUT_MINUTES,
      maxTestRunnerReuse: MAX_TEST_RUNNER_REUSE,
      reporters: [],
    },
  };
}
export interface StrykerMutantSummary {
  id: string;
  fileName: string;
  status: string;
  mutatorName?: string;
  replacement?: string;
  location?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

/**
 * Map Stryker mutant result into an anti-slop finding.
 *
 * @param mutant Stryker mutant summary object.
 * @returns Finding or null if mutant was killed.
 */
export function mapMutantToFinding(mutant: MutantResult | StrykerMutantSummary): Finding | null {
  const line = mutant.location?.start.line ?? 1;
  const column = mutant.location?.start.column ?? 1;
  const mutator = mutant.mutatorName ?? "Expression";

  if (mutant.status === "Survived" || mutant.status === "survived") {
    const replacementInfo = mutant.replacement ? ` ('${mutant.replacement}')` : "";

    return {
      check: CHECK_NAME,
      rule: "surviving-mutant",
      severity: "error",
      message: `Surviving mutant: ${mutator} mutant survived${replacementInfo}`,
      file: mutant.fileName,
      line,
      column,
      why: "Mutation testing: Code was modified with a mutant, but tests still passed without noticing the bug.",
      suggestion: "Add an assertion in your test suite that verifies this specific behavior or invariant.",
    };
  }

  if (mutant.status === "NoCoverage" || mutant.status === "noCoverage") {
    return {
      check: CHECK_NAME,
      rule: "uncovered-mutant",
      severity: "warning",
      message: `Uncovered mutant: ${mutator} has zero test coverage`,
      file: mutant.fileName,
      line,
      column,
      why: "Mutation testing: This code branch is never reached or executed by any test in the test suite.",
      suggestion: "Write tests covering this execution path.",
    };
  }

  return null;
}

/**
 * Calculate mutation score and detailed metrics from Stryker mutant results.
 * Score formula matches Stryker: (killed + timeout) / (killed + timeout + survived + noCoverage) * 100.
 *
 * @param results List of mutant results or summaries.
 * @returns MutationScoreMetrics containing tallies and calculated score.
 */
export function calculateMutationMetrics(
  results: readonly (MutantResult | StrykerMutantSummary)[]
): MutationScoreMetrics {
  let killed = 0;
  let survived = 0;
  let noCoverage = 0;
  let timeout = 0;
  let compileErrors = 0;
  let runtimeErrors = 0;

  for (const mutant of results) {
    const status = mutant.status.toLowerCase();
    if (status === "killed") killed++;
    else if (status === "survived") survived++;
    else if (status === "nocoverage") noCoverage++;
    else if (status === "timeout") timeout++;
    else if (status === "compileerror") compileErrors++;
    else if (status === "runtimeerror") runtimeErrors++;
  }

  const denominator = killed + timeout + survived + noCoverage;
  const score =
    denominator === 0
      ? PERFECT_SCORE
      : Math.round(((killed + timeout) / denominator) * SCORE_SCALE_NUMERATOR) /
        SCORE_SCALE_DENOMINATOR;

  return {
    total: results.length,
    killed,
    survived,
    noCoverage,
    timeout,
    compileErrors,
    runtimeErrors,
    score,
  };
}

/**
 * Clean up temporary .stryker-tmp sandboxes if present.
 *
 * @param cwd Target directory containing .stryker-tmp.
 */
export function cleanupStrykerSandbox(cwd: string): void {
  const tmpDir = path.join(cwd, ".stryker-tmp");
  try {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (err: unknown) {
    void err;
  }
}

/**
 * Execute Stryker mutation testing on targeted production files.
 *
 * @param cwd Project root directory.
 * @param targetFiles Target files from git diff.
 * @returns Array of surviving or uncovered mutant findings.
 */
interface MutationPreconditions {
  options?: SynthesizedStrykerConfig;
  errorFindings?: Finding[];
  skip?: boolean;
}

export function checkMemoryThreshold(freeMem: number, totalMem: number, cwd: string): Finding | null {
  const criticalThreshold =
    os.platform() === "darwin" ? DARWIN_CRITICAL_LOW_MEMORY_BYTES : CRITICAL_LOW_MEMORY_BYTES;
  if (freeMem >= criticalThreshold) {
    return null;
  }

  return {
    check: CHECK_NAME,
    rule: "stryker-low-memory-abort",
    severity: "warning",
    message: `Mutation testing aborted: critically low free memory (${Math.round(freeMem / BYTES_PER_MB)}MB free of ${Math.round(totalMem / BYTES_PER_GB)}GB).`,
    file: path.join(cwd, PACKAGE_JSON_FILE),
    line: 1,
    column: 1,
    why: "Executing mutation sandboxes under critical memory pressure can freeze the host system.",
    suggestion: "Close background applications to free memory before running mutation tests.",
  };
}

export function checkScopeLimit(mutateFilesCount: number, cwd: string, maxFiles: number = MAX_MUTATION_FILES): Finding | null {
  if (mutateFilesCount <= maxFiles) {
    return null;
  }

  return {
    check: CHECK_NAME,
    rule: "stryker-scope-too-broad",
    severity: "warning",
    message: `Mutation run aborted: scope too broad (${mutateFilesCount} files exceed safety limit of ${maxFiles}).`,
    file: path.join(cwd, PACKAGE_JSON_FILE),
    line: 1,
    column: 1,
    why: `Running mutation tests across ${mutateFilesCount} files simultaneously can saturate CPU and memory.`,
    suggestion: "Target specific files: anti-slop --mutation <file1> <file2>",
  };
}

export function validateMutationPreconditions(
  cwd: string,
  targetFiles?: string[],
  concurrency?: number,
  maxMutationFiles?: number
): MutationPreconditions {
  const mutateFiles = filterProductionFilesForMutation(cwd, targetFiles);
  if (targetFiles && targetFiles.length > 0 && mutateFiles.length === 0) {
    return { skip: true };
  }

  const effectiveMaxFiles =
    typeof maxMutationFiles === "number" && maxMutationFiles > 0
      ? maxMutationFiles
      : MAX_MUTATION_FILES;

  const scopeError = checkScopeLimit(mutateFiles.length, cwd, effectiveMaxFiles);
  if (scopeError) {
    return { errorFindings: [scopeError] };
  }
  const { options, errorFinding } = buildStrykerOptions(cwd, mutateFiles, concurrency);
  if (errorFinding || !options) {
    return {
      errorFindings: [errorFinding ?? {
        check: CHECK_NAME,
        rule: "stryker-config-missing",
        severity: "warning",
        message: "No Stryker configuration or test runner detected in target repository.",
        file: path.join(cwd, PACKAGE_JSON_FILE),
        line: 1,
        column: 1,
        why: "Mutation testing requires a test runner (e.g. bun test, vitest, jest) configured in package.json or stryker.config.json.",
        suggestion: "Add a 'test' script in package.json or create a stryker.config.json.",
      }],
    };
  }

  const memError = checkMemoryThreshold(os.freemem(), os.totalmem(), cwd);
  if (memError) {
    return { errorFindings: [memError] };
  }

  return { options };
}

export function extractMutantFindings(results: readonly (MutantResult | StrykerMutantSummary)[]): Finding[] {
  const findings: Finding[] = [];
  for (const result of results) {
    const finding = mapMutantToFinding(result);
    if (finding) {
      findings.push(finding);
    }
  }

  return findings;
}

export function createStrykerErrorFinding(cwd: string, error: unknown): Finding {
  const message = error instanceof Error ? error.message : String(error);

  return {
    check: CHECK_NAME,
    rule: "stryker-runner-error",
    severity: "error",
    message: `Stryker mutation runner failed: ${message}`,
    file: path.join(cwd, PACKAGE_JSON_FILE),
    line: 1,
    column: 1,
    why: "Mutation testing failed to execute due to an internal runner error or configuration failure.",
    suggestion: "Review Stryker options, test runner configuration, or error logs.",
  };
}

/**
 * Evaluate calculated mutation metrics against a minimum score threshold.
 *
 * @param metrics Calculated mutation metrics.
 * @param minScore Minimum mutation score required (0 to 100).
 * @param targetFile File path to anchor the finding to.
 * @returns Error finding if score is below threshold, or null if threshold is satisfied.
 */
export function evaluateScoreThreshold(
  metrics: MutationScoreMetrics,
  minScore: number | undefined,
  targetFile: string
): Finding | null {
  if (minScore === undefined || metrics.score >= minScore) {
    return null;
  }

  const caught = metrics.killed + metrics.timeout;
  const denominator = caught + metrics.survived + metrics.noCoverage;

  return {
    check: CHECK_NAME,
    rule: "mutation-score-threshold",
    severity: "error",
    message: `Mutation score ${metrics.score.toFixed(1)}% is below required threshold of ${minScore}% (${caught}/${denominator} caught).`,
    file: targetFile,
    line: 1,
    column: 1,
    why: `Mutation testing requires at least ${minScore}% of valid mutants to be caught by the test suite.`,
    suggestion: "Add assertions in test suite to kill surviving and uncovered mutants.",
  };
}

export function registerExitCleanup(cwd: string): () => void {
  const onExit = (): void => cleanupStrykerSandbox(cwd);
  process.on("exit", onExit);
  process.on("SIGINT", onExit);
  process.on("SIGTERM", onExit);

  return () => {
    process.off("exit", onExit);
    process.off("SIGINT", onExit);
    process.off("SIGTERM", onExit);
    cleanupStrykerSandbox(cwd);
  };
}

async function runStrykerSuite(
  config: SynthesizedStrykerConfig,
  minScore: number | undefined,
  targetFile: string
): Promise<StrykerCheckResult> {
  const stryker = new Stryker(config);
  const results = await stryker.runMutationTest();
  const findings = extractMutantFindings(results);
  const metrics = calculateMutationMetrics(results);
  const thresholdFinding = evaluateScoreThreshold(metrics, minScore, targetFile);
  if (thresholdFinding) {
    findings.push(thresholdFinding);
  }

  return { findings, metrics };
}

/**
 * Execute Stryker mutation testing on targeted production files and compute metrics.
 *
 * @param cwd Project root directory.
 * @param targetFiles Target files from git diff.
 * @param options Stryker options (e.g. minScore threshold).
 * @returns StrykerCheckResult containing findings and score metrics.
 */
export async function checkMutation(
  cwd: string,
  targetFiles?: string[],
  options?: StrykerOptions
): Promise<StrykerCheckResult> {
  const pre = validateMutationPreconditions(cwd, targetFiles, options?.concurrency, options?.maxMutationFiles);
  if (pre.errorFindings || !pre.options) {
    return { findings: pre.errorFindings ?? [] };
  }
  const reportsDir = path.join(cwd, "reports/mutation");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const unregister = registerExitCleanup(cwd);
  const targetFile = targetFiles?.[0] ?? path.join(cwd, PACKAGE_JSON_FILE);

  try {
    return await runStrykerSuite(pre.options, options?.minScore, targetFile);
  } catch (error) {
    return { findings: [createStrykerErrorFinding(cwd, error)] };
  } finally {
    unregister();
  }
}
/**
 * Execute Stryker mutation testing on targeted production files.
 *
 * @param cwd Project root directory.
 * @param targetFiles Target files from git diff.
 * @param options Optional Stryker options.
 * @returns Array of surviving or uncovered mutant findings.
 */
export async function checkMutationWithStryker(
  cwd: string,
  targetFiles?: string[],
  options?: StrykerOptions
): Promise<Finding[]> {
  const res = await checkMutation(cwd, targetFiles, options);

  return res.findings;
}
