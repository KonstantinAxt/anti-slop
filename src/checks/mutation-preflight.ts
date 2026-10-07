import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Instrumenter } from "@stryker-mutator/instrumenter";
import { getDiffFilesSince, getStagedFiles } from "../git.js";
import { isJsonObject } from "./dead-code.js";
import { filterProductionFilesForMutation } from "./stryker-runner.js";
export interface MutationPreflightOptions {
  cwd?: string | undefined;
  files?: string[] | undefined;
  since?: string | undefined;
  staged?: boolean | undefined;
  concurrency?: number | undefined;
  maxMutationFiles?: number | undefined;
  ci?: boolean | undefined;
}

export interface FileMutantEstimate {
  file: string;
  lines: number;
  estimatedMutants: number;
  cachedMutants: number;
  pendingMutants: number;
}

export type CpuStatus = "idle" | "moderate" | "busy" | "overloaded";

export interface ResourceSafetyOptions {
  requestedConcurrency?: number | undefined;
  sampleMs?: number | undefined;
  mockCpuLoadPercent?: number | undefined;
  mockLoadAvg1Min?: number | undefined;
  mockFreeMemBytes?: number | undefined;
  mockCpuCount?: number | undefined;
}

export interface ResourceSafetyCheck {
  cpuCount: number;
  totalMemGb: number;
  freeMemGb: number;
  cpuLoadPercent: number;
  loadAvg1Min: number;
  cpuStatus: CpuStatus;
  requestedConcurrency: number | undefined;
  recommendedConcurrency: number;
  isSafeForDesktop: boolean;
  warning: string | undefined;
}

export interface MutationPreflightReport {
  targetFiles: string[];
  mutableFiles: string[];
  isScopeTooBroad: boolean;
  maxFilesLimit: number;
  fileEstimates: FileMutantEstimate[];
  totalEstimatedMutants: number;
  totalCachedMutants: number;
  totalPendingMutants: number;
  baselineDryRunSeconds: number;
  estimatedColdSeconds: number;
  estimatedColdFormatted: string;
  estimatedIncrementalSeconds: number;
  estimatedIncrementalFormatted: string;
  resources: ResourceSafetyCheck;
  recommendedCommand: string;
}

const DEFAULT_MAX_FILES = 8;
const BYTES_PER_GB = 1073741824;
const BYTES_PER_WORKER_RAM = 1610612736; // 1.5 GB
const HOST_RESERVED_RAM_BYTES = 3221225472; // 3.0 GB reserved for OS and VSCode
const HOST_RESERVED_CPUS = 2;
const MAX_RECOMMENDED_WORKERS = 4;
const BASELINE_DRY_RUN_SECONDS = 15;
const REPORTING_OVERHEAD_SECONDS = 2;
const DEFAULT_CPU_SAMPLE_MS = 80;
const LOAD_OVERLOAD_PERCENT = 80;
const LOAD_BUSY_PERCENT = 60;
const LOAD_MODERATE_PERCENT = 40;
const LOAD_OVERLOAD_RATIO = 0.85;
const LOAD_BUSY_RATIO = 0.65;
const LOAD_MODERATE_RATIO = 0.45;
const WORKER_CAP_OVERLOADED = 1;
const WORKER_CAP_BUSY = 2;
const WORKER_CAP_MODERATE = 3;
const PERCENT_MULTIPLIER = 100;
const ROUNDING_DECIMAL_SCALE = 10;
const MUTANTS_PER_SECOND_PER_WORKER = 0.9;
const ESTIMATED_MUTANTS_PER_LINE = 0.85;
const DEFAULT_INCREMENTAL_FILE = "reports/mutation/stryker-incremental.json";

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;

  return remainingSecs > 0 ? `${mins}m ${remainingSecs}s` : `${mins}m`;
}

function resolvePreflightTargets(cwd: string, options: MutationPreflightOptions): string[] {
  if (options.files && options.files.length > 0) {
    return options.files.map((file) => path.resolve(cwd, file));
  }

  if (options.staged) {
    return getStagedFiles(cwd);
  }

  if (options.since) {
    return getDiffFilesSince(cwd, options.since);
  }

  // Fallback to origin/main if in git repository
  const defaultDiff = getDiffFilesSince(cwd, "origin/main");
  if (defaultDiff.length > 0) {
    return defaultDiff;
  }

  return [];
}

const silentLogger = {
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
  fatal: (): void => {},
  trace: (): void => {},
  isTraceEnabled: (): boolean => false,
  isDebugEnabled: (): boolean => false,
  isInfoEnabled: (): boolean => false,
  isWarnEnabled: (): boolean => false,
  isErrorEnabled: (): boolean => false,
  isFatalEnabled: (): boolean => false,
};

async function countMutantsForFile(filePath: string, content: string): Promise<number> {
  try {
    const instrumenter = new Instrumenter(silentLogger);
    const result = await instrumenter.instrument(
      [{ name: filePath, mutate: true, content }],
      { ignorers: [], excludedMutations: [], plugins: null }
    );

    return result.mutants.length;
  } catch {
    const lines = content.split("\n").filter((line) => line.trim().length > 0).length;

    return Math.round(lines * ESTIMATED_MUTANTS_PER_LINE);
  }
}

export function extractMutantsFromCache(filesObj: unknown): Record<string, number> {
  if (!isJsonObject(filesObj)) {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(filesObj)) {
    if (isJsonObject(val) && Array.isArray(val.mutants)) {
      result[key] = val.mutants.length;
    }
  }

  return result;
}

export function loadIncrementalCache(cwd: string): Record<string, number> {
  const cachePath = path.join(cwd, DEFAULT_INCREMENTAL_FILE);
  if (!fs.existsSync(cachePath)) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    const files = isJsonObject(parsed) ? parsed.files : undefined;

    return extractMutantsFromCache(files);
  } catch {
    return {};
  }
}

interface CpuSnapshot {
  idle: number;
  total: number;
}

function sampleCpuTicks(): CpuSnapshot {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const times = cpu.times;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
    idle += times.idle;
  }

  return { idle, total };
}

export async function measureCurrentCpuConsumption(
  sampleMs: number = DEFAULT_CPU_SAMPLE_MS
): Promise<number> {
  const first = sampleCpuTicks();
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, sampleMs);
  await promise;
  const second = sampleCpuTicks();

  const idleDiff = second.idle - first.idle;
  const totalDiff = second.total - first.total;
  if (totalDiff <= 0) {
    return 0;
  }

  const busyRatio = Math.max(0, Math.min(1, 1 - idleDiff / totalDiff));

  return Math.round(busyRatio * PERCENT_MULTIPLIER);
}

export async function evaluateResourceSafety(
  optionsOrConcurrency?: number | ResourceSafetyOptions | undefined
): Promise<ResourceSafetyCheck> {
  const safetyOptions: ResourceSafetyOptions =
    typeof optionsOrConcurrency === "number"
      ? { requestedConcurrency: optionsOrConcurrency }
      : optionsOrConcurrency ?? {};

  const cpuCount = safetyOptions.mockCpuCount ?? os.cpus().length;
  const totalMem = os.totalmem();
  const freeMem = safetyOptions.mockFreeMemBytes ?? os.freemem();

  const totalMemGb = Math.round((totalMem / BYTES_PER_GB) * ROUNDING_DECIMAL_SCALE) / ROUNDING_DECIMAL_SCALE;
  const freeMemGb = Math.round((freeMem / BYTES_PER_GB) * ROUNDING_DECIMAL_SCALE) / ROUNDING_DECIMAL_SCALE;

  const cpuLoadPercent =
    safetyOptions.mockCpuLoadPercent ??
    (await measureCurrentCpuConsumption(safetyOptions.sampleMs));

  const loadAvg = os.loadavg();
  const loadAvg1Min =
    safetyOptions.mockLoadAvg1Min ??
    Math.round((loadAvg[0] ?? 0) * ROUNDING_DECIMAL_SCALE) / ROUNDING_DECIMAL_SCALE;

  const normalizedLoadRatio = cpuCount > 0 ? loadAvg1Min / cpuCount : 0;

  // Base CPU bound: leave at least 2 cores for OS & VSCode
  let baseSafeCpuWorkers = 1;
  if (cpuCount > 4) {
    baseSafeCpuWorkers = Math.min(MAX_RECOMMENDED_WORKERS, Math.max(1, cpuCount - HOST_RESERVED_CPUS));
  } else if (cpuCount > 2) {
    baseSafeCpuWorkers = 2;
  }

  // Dynamic calibration based on current CPU consumption
  let cpuStatus: CpuStatus = "idle";
  let dynamicCpuCap = baseSafeCpuWorkers;
  let warning: string | undefined = undefined;

  if (cpuLoadPercent >= LOAD_OVERLOAD_PERCENT || normalizedLoadRatio >= LOAD_OVERLOAD_RATIO) {
    cpuStatus = "overloaded";
    dynamicCpuCap = WORKER_CAP_OVERLOADED;
    warning = `High CPU consumption (${cpuLoadPercent}% busy, 1m load ${loadAvg1Min.toFixed(1)}). Concurrency reduced to 1 to prevent VSCode freezing.`;
  } else if (cpuLoadPercent >= LOAD_BUSY_PERCENT || normalizedLoadRatio >= LOAD_BUSY_RATIO) {
    cpuStatus = "busy";
    dynamicCpuCap = Math.min(WORKER_CAP_BUSY, baseSafeCpuWorkers);
    warning = `Elevated CPU consumption (${cpuLoadPercent}% busy). Concurrency reduced to ${dynamicCpuCap} workers.`;
  } else if (cpuLoadPercent >= LOAD_MODERATE_PERCENT || normalizedLoadRatio >= LOAD_MODERATE_RATIO) {
    cpuStatus = "moderate";
    dynamicCpuCap = Math.min(WORKER_CAP_MODERATE, baseSafeCpuWorkers);
  }

  // Memory bound: leave at least 3 GB RAM free for OS and VSCode
  const availableMemForWorkers = Math.max(0, freeMem - HOST_RESERVED_RAM_BYTES);
  const safeMemWorkers = Math.max(1, Math.floor(availableMemForWorkers / BYTES_PER_WORKER_RAM));

  const recommendedConcurrency = Math.min(dynamicCpuCap, safeMemWorkers);

  let isSafeForDesktop = true;

  if (freeMem < HOST_RESERVED_RAM_BYTES) {
    isSafeForDesktop = false;
    warning = `Low host memory (${freeMemGb} GB free). Running mutation workers risks freezing VSCode or triggering OS paging.`;
  } else if (
    safetyOptions.requestedConcurrency !== undefined &&
    safetyOptions.requestedConcurrency > recommendedConcurrency
  ) {
    isSafeForDesktop = false;
    warning = `Requested concurrency (${safetyOptions.requestedConcurrency}) exceeds safe desktop threshold (${recommendedConcurrency}). May saturate CPU/RAM and freeze VSCode.`;
  }

  return {
    cpuCount,
    totalMemGb,
    freeMemGb,
    cpuLoadPercent,
    loadAvg1Min,
    cpuStatus,
    requestedConcurrency: safetyOptions.requestedConcurrency,
    recommendedConcurrency,
    isSafeForDesktop,
    warning,
  };
}

export async function calculateMutationPreflight(
  options: MutationPreflightOptions = {}
): Promise<MutationPreflightReport> {
  const cwd = path.resolve(options.cwd || process.cwd());
  const targetFiles = resolvePreflightTargets(cwd, options);
  const mutableFiles = filterProductionFilesForMutation(cwd, targetFiles);

  const maxFilesLimit =
    options.maxMutationFiles && options.maxMutationFiles > 0
      ? options.maxMutationFiles
      : DEFAULT_MAX_FILES;

  const isScopeTooBroad = mutableFiles.length > maxFilesLimit;
  const cachedData = loadIncrementalCache(cwd);
  const resources = await evaluateResourceSafety(options.concurrency);
  const effectiveConcurrency = options.concurrency ?? resources.recommendedConcurrency;
  const fileEstimates: FileMutantEstimate[] = [];
  let totalEstimatedMutants = 0;
  let totalCachedMutants = 0;
  let totalPendingMutants = 0;

  for (const relFile of mutableFiles) {
    const fullPath = path.resolve(cwd, relFile);
    let lines = 0;
    let estimatedMutants = 0;

    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf-8");
      lines = content.split("\n").length;
      estimatedMutants = await countMutantsForFile(fullPath, content);
    }

    const cachedMutants = cachedData[relFile] ?? 0;
    const pendingMutants = Math.max(0, estimatedMutants - cachedMutants);

    totalEstimatedMutants += estimatedMutants;
    totalCachedMutants += cachedMutants;
    totalPendingMutants += pendingMutants;

    fileEstimates.push({
      file: relFile,
      lines,
      estimatedMutants,
      cachedMutants,
      pendingMutants,
    });
  }

  // Calculate time estimates
  const coldWorkerThroughput = effectiveConcurrency * MUTANTS_PER_SECOND_PER_WORKER;
  const coldNetSeconds = Math.ceil(totalEstimatedMutants / Math.max(0.1, coldWorkerThroughput));
  let estimatedColdSeconds = 0;
  if (totalEstimatedMutants > 0) {
    estimatedColdSeconds = BASELINE_DRY_RUN_SECONDS + coldNetSeconds + REPORTING_OVERHEAD_SECONDS;
  }
  const incNetSeconds = Math.ceil(totalPendingMutants / Math.max(0.1, coldWorkerThroughput));
  let estimatedIncrementalSeconds = 0;
  if (totalEstimatedMutants > 0) {
    if (totalPendingMutants === 0) {
      estimatedIncrementalSeconds = BASELINE_DRY_RUN_SECONDS + REPORTING_OVERHEAD_SECONDS;
    } else {
      estimatedIncrementalSeconds = BASELINE_DRY_RUN_SECONDS + incNetSeconds + REPORTING_OVERHEAD_SECONDS;
    }
  }

  // Build safe recommended command
  const rawSinceRef = options.since ?? "origin/main";
  const sinceRef = rawSinceRef.replace(/^(origin\/)?refs\/heads\//, "$1");
  const recommendedCommand = isScopeTooBroad
    ? `node bin/anti-slop --mutation ${mutableFiles.slice(0, 2).join(" ")} --mutation-concurrency ${resources.recommendedConcurrency}`
    : `node bin/anti-slop --since ${sinceRef} --checks mutation --min-mutation-score 80 --mutation-concurrency ${resources.recommendedConcurrency}`;

  return {
    targetFiles,
    mutableFiles,
    isScopeTooBroad,
    maxFilesLimit,
    fileEstimates,
    totalEstimatedMutants,
    totalCachedMutants,
    totalPendingMutants,
    baselineDryRunSeconds: BASELINE_DRY_RUN_SECONDS,
    estimatedColdSeconds,
    estimatedColdFormatted: formatDuration(estimatedColdSeconds),
    estimatedIncrementalSeconds,
    estimatedIncrementalFormatted: formatDuration(estimatedIncrementalSeconds),
    resources,
    recommendedCommand,
  };
}

export function formatTerminalPreflight(report: MutationPreflightReport): string {
  const lines: string[] = [];

  lines.push("⚡ Anti-Slop Mutation Preflight & Capacity Estimate");
  lines.push("─".repeat(55));

  // Scope section
  lines.push(`📁 Changed production files: ${report.mutableFiles.length} (limit: ${report.maxFilesLimit})`);
  if (report.isScopeTooBroad) {
    lines.push(`   ⚠️  SCOPE TOO BROAD: ${report.mutableFiles.length} files exceed safety limit of ${report.maxFilesLimit}.`);
    lines.push("   Stryker run will abort in CI to prevent runner starvation.");
  }

  // File breakdown table
  if (report.fileEstimates.length > 0) {
    lines.push("");
    lines.push("Target File Breakdown:");
    lines.push(
      "  " +
      "File".padEnd(36) +
      "Lines".padStart(7) +
      "Mutants".padStart(9) +
      "Cached".padStart(8) +
      "Pending".padStart(9)
    );
    lines.push("  " + "─".repeat(69));

    for (const item of report.fileEstimates) {
      const displayFile =
        item.file.length > 34 ? `...${item.file.slice(-31)}` : item.file;
      lines.push(
        "  " +
        displayFile.padEnd(36) +
        String(item.lines).padStart(7) +
        String(item.estimatedMutants).padStart(9) +
        String(item.cachedMutants).padStart(8) +
        String(item.pendingMutants).padStart(9)
      );
    }
    lines.push("  " + "─".repeat(69));
    lines.push(
      "  " +
      "Total".padEnd(36) +
      "".padStart(7) +
      String(report.totalEstimatedMutants).padStart(9) +
      String(report.totalCachedMutants).padStart(8) +
      String(report.totalPendingMutants).padStart(9)
    );
  }

  // Resources & VSCode Safety
  lines.push("");
  lines.push("🖥️  System Resources & VSCode Safety:");
  lines.push(
    `   CPUs: ${report.resources.cpuCount} cores | Current Load: ${report.resources.cpuLoadPercent}% busy (1m load: ${report.resources.loadAvg1Min}) [Status: ${report.resources.cpuStatus}]`
  );
  lines.push(
    `   RAM: ${report.resources.freeMemGb} GB free of ${report.resources.totalMemGb} GB`
  );
  lines.push(
    `   Safe concurrency cap: ${report.resources.recommendedConcurrency} worker(s) (dynamically tuned to current CPU/RAM load)`
  );
  if (!report.resources.isSafeForDesktop && report.resources.warning) {
    lines.push(`   ⚠️  SAFETY WARNING: ${report.resources.warning}`);
  } else {
    lines.push("   ✅ Safe for local development without freezing desktop/VSCode.");
  }

  // Time estimates
  lines.push("");
  lines.push("⏱️  Estimated Execution Time:");
  lines.push(`   • Dry-Run Baseline (Vitest):   ~${report.baselineDryRunSeconds}s`);
  lines.push(`   • Cold Run (all mutants fresh): ${report.estimatedColdFormatted} (~${report.estimatedColdSeconds}s)`);
  lines.push(
    `   • Incremental Run (cached):     ${report.estimatedIncrementalFormatted} (~${report.estimatedIncrementalSeconds}s)`
  );

  // Recommendation
  lines.push("");
  lines.push("💡 Recommended Safe Command:");
  lines.push(`   ${report.recommendedCommand}`);

  return lines.join("\n");
}

export function exportCiOutputs(report: MutationPreflightReport): void {
  const ghOutput = process.env.GITHUB_OUTPUT;
  if (ghOutput && fs.existsSync(ghOutput)) {
    const entries = [
      `estimated_cold_seconds=${report.estimatedColdSeconds}`,
      `estimated_incremental_seconds=${report.estimatedIncrementalSeconds}`,
      `total_mutants=${report.totalEstimatedMutants}`,
      `pending_mutants=${report.totalPendingMutants}`,
      `scope_too_broad=${report.isScopeTooBroad}`,
      `safe_concurrency=${report.resources.recommendedConcurrency}`,
    ];
    fs.appendFileSync(ghOutput, entries.join("\n") + "\n", "utf-8");
  }

  const ghSummary = process.env.GITHUB_STEP_SUMMARY;
  if (ghSummary) {
    const summaryLines = [
      "## ⚡ Mutation Preflight & Capacity Estimate",
      "",
      `| Metric | Value |`,
      `|---|---|`,
      `| **Mutable Files** | ${report.mutableFiles.length} / ${report.maxFilesLimit} |`,
      `| **Total Mutants** | ${report.totalEstimatedMutants} |`,
      `| **Cached Mutants** | ${report.totalCachedMutants} |`,
      `| **Pending Mutants** | ${report.totalPendingMutants} |`,
      `| **Estimated Cold Run** | ${report.estimatedColdFormatted} |`,
      `| **Estimated Incremental** | ${report.estimatedIncrementalFormatted} |`,
      `| **Scope Status** | ${report.isScopeTooBroad ? "⚠️ Exceeds Limit" : "✅ Within Limits"} |`,
      "",
    ];
    fs.appendFileSync(ghSummary, summaryLines.join("\n") + "\n", "utf-8");
  }
}
