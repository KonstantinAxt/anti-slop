import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Finding } from "../types.js";

const CHECK_NAME = "pr-size";
const RULE_NAME = "max-pr-size";

const DEFAULT_WARN_LINES = 200;
const DEFAULT_FAIL_LINES = 500;
const DEFAULT_WARN_FILES = 10;
const DEFAULT_FAIL_FILES = 25;
const MIN_NUMSTAT_PARTS = 3;
const NUMSTAT_PATH_INDEX = 2;

export function getDefaultIgnoredPatterns(): RegExp[] {
  return [
    /(?:^|\/)bun\.lock(?:b)?$/,
    /(?:^|\/)package-lock\.json$/,
    /(?:^|\/)pnpm-lock\.yaml$/,
    /(?:^|\/)yarn\.lock$/,
    /\.min\.(?:js|css)$/,
    /\.map$/,
    /(?:^|\/)__snapshots__(?:\/|$)/,
    /(?:^|\/)e2e-fixtures(?:\/|$)/,
    /(?:^|\/)reports(?:\/|$)/,
  ];
}

export interface PrSizeOptions {
  since?: string | undefined;
  warnLines?: number | undefined;
  failLines?: number | undefined;
  warnFiles?: number | undefined;
  failFiles?: number | undefined;
  ignorePatterns?: (string | RegExp)[] | undefined;
  override?: boolean | undefined;
  rawNumstat?: string | undefined;
}

export interface PrFileMetric {
  path: string;
  additions: number;
  deletions: number;
  reviewLines: number;
  binary: boolean;
  ignored: boolean;
}

export interface PrSizeMetrics {
  files: PrFileMetric[];
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  reviewLines: number;
}

export function normalizeRenamedPath(rawPath: string): string {
  if (rawPath.includes(" => ")) {
    // e.g. "src/{old => new}/file.ts" or "old.ts => new.ts"
    const braceMatch = rawPath.match(/^(.*?)\{.*?=> (.*?)\}(.*)$/);
    if (braceMatch) {
      const prefix = braceMatch[1] ?? "";
      const replacement = braceMatch[2] ?? "";
      const suffix = braceMatch[3] ?? "";
      const combined = `${prefix}${replacement}${suffix}`;

      return combined.replaceAll(/\/+/g, "/");
    }
    const arrowParts = rawPath.split(" => ");

    return arrowParts[1]?.trim() ?? rawPath;
  }

  return rawPath;
}

export function isPathIgnored(filePath: string, customPatterns?: (string | RegExp)[]): boolean {
  const patterns = [...getDefaultIgnoredPatterns(), ...(customPatterns ?? [])];
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      if (filePath.includes(pattern)) return true;
    } else if (pattern.test(filePath)) {
      return true;
    }
  }

  return false;
}
function isEnvOverrideActive(): boolean {
  const val = process.env.ANTI_SLOP_SIZE_OVERRIDE;

  return val === "true" || val === "1";
}

interface NamedLabel {
  name: string;
}

export function isNamedLabel(item: unknown): item is NamedLabel {
  return typeof item === "object" && item !== null && "name" in item && typeof item.name === "string";
}

export function hasLabelOverride(labels: unknown): boolean {
  if (!Array.isArray(labels)) return false;

  return labels.some(
    (item: unknown) =>
      isNamedLabel(item) && (item.name === "size-override" || item.name === "large-pr")
  );
}

export function hasPrSizeOverride(eventPath?: string): boolean {
  if (isEnvOverrideActive()) return true;

  const pathToCheck = eventPath ?? process.env.GITHUB_EVENT_PATH;
  if (!pathToCheck || !fs.existsSync(pathToCheck)) return false;

  try {
    const raw = fs.readFileSync(pathToCheck, "utf-8");
    const data: unknown = JSON.parse(raw);
    if (typeof data === "object" && data !== null && "pull_request" in data) {
      const pr = data.pull_request;
      if (typeof pr === "object" && pr !== null && "labels" in pr) {
        return hasLabelOverride(pr.labels);
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Parse raw git diff --numstat output into structured review-burden metrics.
 *
 * @param numstatOutput Raw numstat stdout string.
 * @param options PR size calculation options.
 * @returns Calculated PrSizeMetrics.
 */
export function parseNumstat(numstatOutput: string, options: PrSizeOptions = {}): PrSizeMetrics {
  const lines = numstatOutput.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const files: PrFileMetric[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;
  let totalReviewLines = 0;
  let activeFilesCount = 0;

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < MIN_NUMSTAT_PARTS) continue;

    const rawAdd = parts[0]?.trim() ?? "";
    const rawDel = parts[1]?.trim() ?? "";
    const rawPath = parts.slice(NUMSTAT_PATH_INDEX).join("\t").trim();
    const normalizedPath = normalizeRenamedPath(rawPath);
    const ignored = isPathIgnored(normalizedPath, options.ignorePatterns);

    const isBinary = rawAdd === "-" || rawDel === "-";
    const additions = isBinary ? 0 : parseInt(rawAdd, 10) || 0;
    const deletions = isBinary ? 0 : parseInt(rawDel, 10) || 0;

    // Review burden formula: additions + min(deletions, additions).
    // Pure deletions of dead code do not count as review burden.
    const reviewLines = additions + Math.min(deletions, additions);

    files.push({
      path: normalizedPath,
      additions,
      deletions,
      reviewLines,
      binary: isBinary,
      ignored,
    });

    if (!ignored) {
      activeFilesCount += 1;
      totalAdditions += additions;
      totalDeletions += deletions;
      totalReviewLines += reviewLines;
    }
  }

  return {
    files,
    totalFiles: activeFilesCount,
    totalAdditions,
    totalDeletions,
    reviewLines: totalReviewLines,
  };
}

/**
 * Run PR size review gate check based on git diff against base branch.
 *
 * @param cwd Working directory.
 * @param options PR size configuration options.
 * @returns Array of findings if thresholds are exceeded.
 */
export function checkPrSize(cwd: string, options: PrSizeOptions = {}): Finding[] {
  let numstatText = options.rawNumstat;

  if (numstatText === undefined) {
    const rawSinceRef = options.since || "origin/main";
    const sinceRef = rawSinceRef.replace(/^(origin\/)?refs\/heads\//, "$1");
    try {
      numstatText = execSync(`git diff --numstat "${sinceRef}...HEAD"`, {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // If git diff failed (e.g. not a git repo or ref not found), try two-dot diff
      try {
        numstatText = execSync(`git diff --numstat "${sinceRef}"`, {
          cwd,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        return [];
      }
    }
  }

  const metrics = parseNumstat(numstatText, options);

  const warnLines = options.warnLines ?? DEFAULT_WARN_LINES;
  const failLines = options.failLines ?? DEFAULT_FAIL_LINES;
  const warnFiles = options.warnFiles ?? DEFAULT_WARN_FILES;
  const failFiles = options.failFiles ?? DEFAULT_FAIL_FILES;

  const findings: Finding[] = [];
  const targetFile = path.join(cwd, "package.json");

  const isOverridden =
    options.override ?? (options.rawNumstat ? false : hasPrSizeOverride());

  if (metrics.reviewLines > failLines || metrics.totalFiles > failFiles) {
    if (isOverridden) {
      findings.push({
        check: CHECK_NAME,
        rule: RULE_NAME,
        severity: "warning",
        message: `PR size (${metrics.reviewLines} review lines across ${metrics.totalFiles} files) exceeds hard limit of ${failLines} lines or ${failFiles} files (+${metrics.totalAdditions}, -${metrics.totalDeletions}) [waived by size-override label].`,
        file: targetFile,
        line: 1,
        column: 1,
        why: "Hard limit waived by 'size-override' pull request label.",
        suggestion: "Ensure large changes undergo extra thorough manual review.",
      });
    } else {
      findings.push({
        check: CHECK_NAME,
        rule: RULE_NAME,
        severity: "error",
        message: `PR size (${metrics.reviewLines} review lines across ${metrics.totalFiles} files) exceeds hard limit of ${failLines} lines or ${failFiles} files (+${metrics.totalAdditions}, -${metrics.totalDeletions}).`,
        file: targetFile,
        line: 1,
        column: 1,
        why: "Research shows review quality degrades steeply beyond 200-400 lines of code (SmartBear/Cisco, Google Small CLs). Defects escape review when changes are oversized.",
        suggestion: "Split this pull request into smaller, independently reviewable changes, or add a 'size-override' label to waive the limit.",
      });
    }
  } else if (metrics.reviewLines > warnLines || metrics.totalFiles > warnFiles) {
    findings.push({
      check: CHECK_NAME,
      rule: RULE_NAME,
      severity: "warning",
      message: `PR size (${metrics.reviewLines} review lines across ${metrics.totalFiles} files) exceeds recommended threshold of ${warnLines} lines or ${warnFiles} files (+${metrics.totalAdditions}, -${metrics.totalDeletions}).`,
      file: targetFile,
      line: 1,
      column: 1,
      why: "Changes over 200 lines take significantly longer to review and have higher defect escape rates (Google, Cisco).",
      suggestion: "Consider splitting this change into smaller pull requests if practical.",
    });
  }

  return findings;
}
