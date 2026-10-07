import { execFileSync, execSync } from "node:child_process";
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

// Query git repository for tracked and untracked code files respecting .gitignore
export function getTrackedCodeFiles(dir: string, customIgnored?: Set<string>): string[] | null {
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
        if (!line) return false;
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
