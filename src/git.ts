import { execFileSync, execSync, spawnSync } from "node:child_process";
import * as path from "node:path";

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function runGitDiff(cwd: string, args: string): string[] {
  try {
    const stdout = execSync(`git diff ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => CODE_EXTENSIONS.has(path.extname(line)) || path.basename(line) === "tsconfig.json")
      .map((rel) => path.resolve(cwd, rel));
  } catch {
    return [];
  }
}

// Query git index for staged files matching code extensions
export function getStagedFiles(cwd: string): string[] {
  return runGitDiff(cwd, "--cached --name-only --diff-filter=ACMR");
}

// Query git for modified code files between a reference revision and HEAD
export function getDiffFilesSince(cwd: string, ref: string): string[] {
  const normalizedRef = ref.replace(/^(origin\/)?refs\/heads\//, "$1");
  return runGitDiff(cwd, `${normalizedRef}...HEAD --name-only --diff-filter=ACMR`);
}

const REF_HEADS_PREFIX = /^(origin\/)?refs\/heads\//;
const DIFF_NEW_PATH_PREFIX_LENGTH = 6;
export interface ChangedLineRange {
  start: number;
  end: number;
}

// Query added or changed line ranges between a reference revision and HEAD.
export function getChangedLineRangesSince(cwd: string, ref: string): Map<string, ChangedLineRange[]> {
  const normalizedRef = ref.replace(REF_HEADS_PREFIX, "$1");
  let diff: string;
  try {
    diff = execSync(`git diff --unified=0 ${normalizedRef}...HEAD`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return new Map();
  }

  return parseChangedLineRanges(cwd, diff);
}

function parseChangedLineRanges(cwd: string, diff: string): Map<string, ChangedLineRange[]> {
  const changedRanges = new Map<string, ChangedLineRange[]>();
  let currentFile: string | null = null;
  let newLine = 0;
  let isDeletedRange = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      currentFile = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      currentFile = line.startsWith("+++ b/") ? resolveDiffPath(cwd, line) : null;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      isDeletedRange = Number(hunk[2] ?? "1") === 0;
      continue;
    }
    if (isDeletedRange || !currentFile || !line) continue;
    if (line.startsWith("+")) {
      addChangedLine(changedRanges, currentFile, newLine);
      newLine++;
    } else if (!line.startsWith("-")) {
      newLine++;
    }
  }

  return changedRanges;
}

function resolveDiffPath(cwd: string, line: string): string | null {
  const relativeFile = line.slice(DIFF_NEW_PATH_PREFIX_LENGTH);

  return CODE_EXTENSIONS.has(path.extname(relativeFile)) ? path.resolve(cwd, relativeFile) : null;
}

function addChangedLine(rangesByFile: Map<string, ChangedLineRange[]>, file: string, line: number): void {
  const ranges = rangesByFile.get(file) ?? [];
  const previousRange = ranges.at(-1);
  if (previousRange && previousRange.end === line - 1) {
    previousRange.end = line;
  } else {
    ranges.push({ start: line, end: line });
  }
  rangesByFile.set(file, ranges);
}

// Query git repository for tracked and untracked code files respecting .gitignore.
// Returns null outside a repository or when the directory itself is ignored, so the caller walks the filesystem.
export function getTrackedCodeFiles(dir: string, customIgnored?: Set<string>): string[] | null {
  // An explicitly targeted ignored directory would otherwise list as empty instead of failing
  if (spawnSync("git", ["-C", dir, "check-ignore", "-q", "."]).status === 0) return null;

  try {
    const stdout = execFileSync(
      "git",
      ["-C", dir, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    );

    return stdout
      .split("\0")
      .filter((line) => {
        if (!CODE_EXTENSIONS.has(path.extname(line))) return false;
        if (!customIgnored) return true;
        const segments = line.split("/");

        return !segments.some((seg) => customIgnored.has(seg) || seg.startsWith("."));
      })
      .map((rel) => path.resolve(dir, rel));
  } catch {
    return null;
  }
}
