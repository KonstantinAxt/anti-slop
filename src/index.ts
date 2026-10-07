import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { createSourceFile } from "./checks/ast.js";
import { checkBoundaries } from "./checks/boundaries.js";
import { checkFractalArchitecture } from "./checks/fractal.js";
import { checkWithEslint } from "./checks/eslint-runner.js";
import { checkHollowTests } from "./checks/hollow-tests.js";
import { checkDeadCode } from "./checks/dead-code.js";
import { checkDuplicationWithJscpd } from "./checks/jscpd-runner.js";
import { checkMutation } from "./checks/stryker-runner.js";
import { checkCrap } from "./checks/crap-runner.js";
import { checkScars } from "./checks/scars.js";
import { checkStaleMocks, defaultFsExportResolver } from "./checks/stale-mocks.js";
import { checkStrictTsCode, checkTsConfig, checkStrictTsProgram } from "./checks/strict-ts.js";
import { checkPrSize } from "./checks/pr-size.js";
import { getDiffFilesSince, getStagedFiles, getTrackedCodeFiles } from "./git.js";
import type { AntiSlopOptions, AntiSlopResult, CheckExecution, CrapEntry, Finding, MutationScoreMetrics } from "./types.js";
import {
  loadRepoConfig,
  getRepoRulesForFile,
  applyRepoRuleGuard,
  type RepoConfig,
} from "./rule-overrides.js";

export { formatOutput } from "./formatters.js";
export type { AntiSlopOptions, AntiSlopResult, CheckExecution, CheckStatus, CrapEntry, Finding, MutationScoreMetrics, Severity } from "./types.js";
export { checkPrSize, parseNumstat, type PrSizeOptions } from "./checks/pr-size.js";
export { checkMutation, checkMutationWithStryker } from "./checks/stryker-runner.js";
export type { JudgeAbstainReason, JudgeFinding, JudgeInput, JudgeProvider, JudgeResult } from "./judge/types.js";
export { createStaticProvider } from "./judge/provider.js";
export { reviewWithJudge } from "./judge/review.js";

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IGNORED_DIRS = new Set(["node_modules", "dist", "build", ".git", ".next", ".turbo", "e2e-fixtures", "artifacts", "benchmarks"]);
const TARGET_DIR_IGNORED = new Set(["node_modules", "dist", "build", ".git", ".next", ".turbo", "artifacts", "benchmarks"]);

export function discoverCodeFiles(dir: string, customIgnored?: Set<string>): string[] {
  const gitFiles = getTrackedCodeFiles(dir, customIgnored ?? IGNORED_DIRS);
  if (gitFiles !== null) {
    return gitFiles;
  }

  const results: string[] = [];
  const ignored = customIgnored ?? IGNORED_DIRS;

  function walk(current: string): void {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) {
          walk(path.join(current, entry.name));
        }
      } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
        results.push(path.join(current, entry.name));
      }
    }
  }

  walk(dir);

  return results;
}

export function auditTsConfig(cwd: string, options: AntiSlopOptions, targetFiles: string[]): Finding[] {
  if (options.allowLooseTsConfig) {
    return [];
  }

  const isScopedRun = options.files !== undefined || options.staged || options.since !== undefined;
  const tsconfigPath = path.join(cwd, "tsconfig.json");

  // In scoped runs (--since, --staged, or specific files list),
  // only audit tsconfig.json if it was actually targeted / modified!
  if (isScopedRun) {
    const isTargeted = targetFiles.some((file) => path.resolve(cwd, file) === tsconfigPath);
    if (!isTargeted) {
      return [];
    }
  }

  if (!fs.existsSync(tsconfigPath)) {
    return [];
  }

  const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (error) {
    return [{
      check: "strict-ts",
      rule: "tsconfig-syntax-error",
      severity: "error",
      message: `Failed to parse tsconfig.json: ${error.messageText}`,
      file: tsconfigPath,
      line: 1,
      column: 1,
    }];
  }

  return config ? checkTsConfig(tsconfigPath, config) : [];
}

export function resolveTargetFiles(cwd: string, options: AntiSlopOptions): string[] {
  if (options.files !== undefined) {
    return options.files.flatMap((file) => {
      const resolved = path.resolve(cwd, file);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        return discoverCodeFiles(resolved, TARGET_DIR_IGNORED);
      }

      return [resolved];
    });
  }

  if (options.staged) {
    const staged = getStagedFiles(cwd);

    return staged.filter((file) => !file.split(path.sep).some((seg) => IGNORED_DIRS.has(seg)));
  }
  if (options.since) {
    const diffFiles = getDiffFilesSince(cwd, options.since);

    return diffFiles.filter((file) => !file.split(path.sep).some((seg) => IGNORED_DIRS.has(seg)));
  }

  return discoverCodeFiles(cwd);
}

export async function scanFile(
  cwd: string,
  filePath: string,
  repoConfig: RepoConfig,
): Promise<Finding[]> {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return [];
  }

  try {
    const code = fs.readFileSync(filePath, "utf-8");
    const relPath = path.relative(cwd, filePath);
    const fileRules = getRepoRulesForFile(repoConfig, relPath);
    const findings: Finding[] = [];

    try {
      const eslintFindings = await checkWithEslint(filePath, code, fileRules);
      findings.push(...eslintFindings);
    } catch (eslintErr: unknown) {
      const errMsg = eslintErr instanceof Error ? eslintErr.message : String(eslintErr);
      findings.push({
        check: "eslint",
        rule: "eslint-execution-error",
        severity: "error",
        message: `ESLint check failed: ${errMsg}`,
        file: filePath,
        line: 1,
        column: 1,
      });
    }

    const sourceFile = createSourceFile(relPath, code);
    findings.push(...checkStrictTsCode(relPath, code, sourceFile));
    findings.push(...checkBoundaries(relPath, code, sourceFile));
    findings.push(...checkFractalArchitecture(relPath, code, sourceFile));
    findings.push(...checkScars(relPath, code, sourceFile));
    findings.push(...checkHollowTests(relPath, code, sourceFile));
    findings.push(...checkStaleMocks(relPath, code, defaultFsExportResolver, sourceFile));

    return applyRepoRuleGuard(findings, fileRules);
  } catch (readError) {
    return [{
      check: "system",
      rule: "file-read-error",
      severity: "warning",
      message: `Failed to inspect file: ${String(readError)}`,
      file: filePath,
      line: 1,
      column: 1,
    }];
  }
}

/**
 * Execute the anti-slop deterministic review gate across target repository files.
 *
 * @param options Scanner options including cwd, git diff range, and rule overrides.
 * @returns Consolidated anti-slop result containing findings, metrics, and pass status.
 */
function resolveChecks(options: AntiSlopOptions): {
  runBase: boolean;
  runMutation: boolean;
  runCrap: boolean;
  runPrSize: boolean;
} {
  const filter = options.checks && options.checks.length > 0
    ? new Set(options.checks.map((checkName) => checkName.toLowerCase()))
    : undefined;
  const has = (name: string): boolean => filter?.has(name) ?? false;

  return {
    runBase: filter ? has("base") || has("lint") || has("syntax") : true,
    runMutation: Boolean(options.mutation || options.minMutationScore !== undefined) || has("mutation") || has("stryker"),
    runCrap: Boolean(options.crap) || has("crap"),
    runPrSize: Boolean(options.prSize) || has("pr-size"),
  };
}

function auditConfig(
  cwd: string,
  options: AntiSlopOptions,
  targetFiles: string[],
  rules: Record<string, unknown>,
  checks: Record<string, CheckExecution>,
): Finding[] {
  const raw = auditTsConfig(cwd, options, targetFiles);
  const err = raw.find((finding) => finding.rule === "tsconfig-syntax-error");
  checks["tsconfig"] = err
    ? { check: "tsconfig", status: "failed", error: err.message }
    : { check: "tsconfig", status: "completed", findingsCount: raw.length };

  return applyRepoRuleGuard(raw, rules);
}

const CHECK_TSCONFIG = "tsconfig", CHECK_ESLINT = "eslint", CHECK_STRICT_TS = "strict-ts", CHECK_BOUNDARIES = "boundaries", CHECK_FRACTAL = "fractal", CHECK_SCARS = "scars", CHECK_HOLLOW_TESTS = "hollow-tests", CHECK_STALE_MOCKS = "stale-mocks", CHECK_DEAD_CODE = "dead-code", CHECK_JSCPD = "jscpd";

const BASE_CHECKS = [CHECK_TSCONFIG, CHECK_ESLINT, CHECK_STRICT_TS, CHECK_BOUNDARIES, CHECK_FRACTAL, CHECK_SCARS, CHECK_HOLLOW_TESTS, CHECK_STALE_MOCKS, CHECK_DEAD_CODE, CHECK_JSCPD] as const;
const AST_CHECKS = [CHECK_BOUNDARIES, CHECK_FRACTAL, CHECK_SCARS, CHECK_HOLLOW_TESTS, CHECK_STALE_MOCKS] as const;

async function scanTargets(
  cwd: string,
  targetFiles: string[],
  repoConfig: RepoConfig,
  checks: Record<string, CheckExecution>,
): Promise<Finding[]> {
  const fileFindings = (await Promise.all(targetFiles.map((targetPath) => scanFile(cwd, targetPath, repoConfig)))).flat();
  const errs = fileFindings.filter((finding) => finding.check === "eslint" && finding.rule === "eslint-execution-error");
  checks["eslint"] = errs.length > 0
    ? { check: "eslint", status: "failed", error: errs.map((finding) => finding.message).join("; "), findingsCount: fileFindings.filter((finding) => finding.check === "eslint").length }
    : { check: "eslint", status: "completed", findingsCount: fileFindings.filter((finding) => finding.check === "eslint" || finding.check === "linter").length };

  for (const name of AST_CHECKS) {
    checks[name] = { check: name, status: "completed", findingsCount: fileFindings.filter((finding) => finding.check === name).length };
  }

  return fileFindings;
}

async function runSafe<T>(
  name: string,
  checks: Record<string, CheckExecution>,
  fn: () => Promise<T> | T,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err: unknown) {
    checks[name] = { check: name, status: "failed", error: err instanceof Error ? err.message : String(err) };

    return undefined;
  }
}

async function runGlobals(
  cwd: string,
  options: AntiSlopOptions,
  targetFiles: string[],
  rules: Record<string, unknown>,
  checks: Record<string, CheckExecution>,
): Promise<Finding[]> {
  const [strictTs, deadCode, jscpd] = await Promise.all([
    runSafe<Finding[]>("strict-ts", checks, () => checkStrictTsProgram(targetFiles, { cwd, allowLooseTsConfig: options.allowLooseTsConfig })),
    runSafe<Finding[]>("dead-code", checks, () => checkDeadCode(targetFiles, { cwd })),
    targetFiles.length > 1 ? runSafe<Finding[]>("jscpd", checks, () => checkDuplicationWithJscpd(targetFiles, cwd)) : undefined,
  ]);

  checks["strict-ts"] ??= { check: "strict-ts", status: "completed", findingsCount: strictTs?.length ?? 0 };
  checks["dead-code"] ??= { check: "dead-code", status: "completed", findingsCount: deadCode?.length ?? 0 };

  const extra: Finding[] = [];
  if (targetFiles.length > 1) {
    if (!checks["jscpd"]) {
      checks["jscpd"] = { check: "jscpd", status: "completed", findingsCount: jscpd?.length ?? 0 };
    } else {
      extra.push({
        check: "jscpd",
        rule: "jscpd-execution-error",
        severity: "error",
        message: `jscpd duplication check failed: ${checks["jscpd"].error ?? ""}`,
        file: targetFiles[0] || cwd,
        line: 1,
        column: 1,
      });
    }
  } else {
    checks["jscpd"] = { check: "jscpd", status: "skipped", reason: "Requires at least 2 target files for duplication analysis" };
  }

  return applyRepoRuleGuard([...(strictTs ?? []), ...(deadCode ?? []), ...(jscpd ?? []), ...extra], rules);
}

async function runMutationGate(
  cwd: string,
  options: AntiSlopOptions,
  targetFiles: string[],
  rules: Record<string, unknown>,
  checks: Record<string, CheckExecution>,
  enabled: boolean,
): Promise<{ findings: Finding[]; metrics?: MutationScoreMetrics | undefined }> {
  if (!enabled) {
    checks["mutation"] = { check: "mutation", status: "skipped", reason: "Mutation testing not requested" };

    return { findings: [] };
  }

  const res = await runSafe("mutation", checks, () =>
    checkMutation(cwd, targetFiles, {
      minScore: options.minMutationScore,
      concurrency: options.mutationConcurrency,
      maxMutationFiles: options.maxMutationFiles,
    })
  );
  if (!res) return { findings: [] };
  checks["mutation"] = { check: "mutation", status: "completed", findingsCount: res.findings.length };

  return { findings: applyRepoRuleGuard(res.findings, rules), metrics: res.metrics };
}

async function runCrapGate(
  cwd: string,
  options: AntiSlopOptions,
  targetFiles: string[],
  rules: Record<string, unknown>,
  checks: Record<string, CheckExecution>,
  enabled: boolean,
): Promise<{ findings: Finding[]; entries?: CrapEntry[] | undefined }> {
  if (!enabled) {
    checks["crap"] = { check: "crap", status: "skipped", reason: "CRAP analysis not requested" };

    return { findings: [] };
  }

  const res = await runSafe("crap", checks, () => checkCrap(cwd, targetFiles, options.crapThreshold));
  if (!res) return { findings: [] };
  checks["crap"] = { check: "crap", status: "completed", findingsCount: res.findings.length };

  return { findings: applyRepoRuleGuard(res.findings, rules), entries: res.entries };
}

function runPrSizeGate(
  cwd: string,
  options: AntiSlopOptions,
  rules: Record<string, unknown>,
  checks: Record<string, CheckExecution>,
  enabled: boolean,
): Finding[] {
  if (!enabled) {
    checks["pr-size"] = { check: "pr-size", status: "skipped", reason: "PR size check not requested" };

    return [];
  }

  try {
    const findings = checkPrSize(cwd, {
      since: options.since,
      warnLines: options.prSizeWarnLines,
      failLines: options.prSizeFailLines,
      warnFiles: options.prSizeWarnFiles,
      failFiles: options.prSizeFailFiles,
    });
    checks["pr-size"] = { check: "pr-size", status: "completed", findingsCount: findings.length };

    return applyRepoRuleGuard(findings, rules);
  } catch (err: unknown) {
    checks["pr-size"] = { check: "pr-size", status: "failed", error: err instanceof Error ? err.message : String(err) };

    return [];
  }
}

function buildResult(
  cwd: string,
  totalFiles: number,
  start: number,
  findings: Finding[],
  checks: Record<string, CheckExecution>,
  crap?: CrapEntry[] | undefined,
  metrics?: MutationScoreMetrics | undefined,
): AntiSlopResult {
  const seenUnusedLocals = new Set<string>();
  for (const finding of findings) {
    if (finding.rule === "no-unused-locals") {
      const absFile = path.resolve(cwd, finding.file);
      seenUnusedLocals.add(`${absFile}:${finding.line}`);
    }
  }

  const seen = new Set<string>();
  const unique = findings.filter((finding) => {
    const absFile = path.resolve(cwd, finding.file);
    if (
      finding.rule === "@typescript-eslint/no-unused-vars" &&
      seenUnusedLocals.has(`${absFile}:${finding.line}`)
    ) {
      return false;
    }

    const key = `${absFile}:${finding.line}:${finding.rule}`;
    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });
  const failed = Object.values(checks).some((chk) => chk.status === "failed");
  const completed = !failed;
  const hasErrors = unique.some((finding) => finding.severity === "error");

  const res: AntiSlopResult = {
    targetDir: cwd,
    totalFilesChecked: totalFiles,
    findings: unique,
    passed: completed && !hasErrors,
    durationMs: Math.round(performance.now() - start),
    checks,
    completedAllChecks: completed,
    completed,
    status: completed ? "completed" : "incomplete",
  };

  if (crap) res.crapEntries = crap;
  if (metrics) {
    res.mutationMetrics = metrics;
    res.mutationScore = metrics.score;
  }

  return res;
}

export async function runAntiSlop(options: AntiSlopOptions = {}): Promise<AntiSlopResult> {
  const start = performance.now();
  const cwd = path.resolve(options.cwd || process.cwd());
  const repoConfig = await loadRepoConfig(cwd, options.rules);
  const targetFiles = resolveTargetFiles(cwd, options);
  const { runBase, runMutation, runCrap, runPrSize } = resolveChecks(options);

  const findings: Finding[] = [];
  const checks: Record<string, CheckExecution> = {};

  if (runBase) {
    findings.push(...auditConfig(cwd, options, targetFiles, repoConfig.globalRules, checks));
    findings.push(...(await scanTargets(cwd, targetFiles, repoConfig, checks)));
    findings.push(...(await runGlobals(cwd, options, targetFiles, repoConfig.globalRules, checks)));
  } else {
    for (const name of BASE_CHECKS) {
      checks[name] = { check: name, status: "skipped", reason: "Base checks not requested" };
    }
  }

  const mut = await runMutationGate(cwd, options, targetFiles, repoConfig.globalRules, checks, runMutation);
  findings.push(...mut.findings);

  const crap = await runCrapGate(cwd, options, targetFiles, repoConfig.globalRules, checks, runCrap);
  findings.push(...crap.findings);

  findings.push(...runPrSizeGate(cwd, options, repoConfig.globalRules, checks, runPrSize));

  return buildResult(cwd, targetFiles.length, start, findings, checks, crap.entries, mut.metrics);
}
