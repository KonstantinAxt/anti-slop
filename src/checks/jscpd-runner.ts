import { execSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Finding } from "../types.js";

function resolveJscpdBin(): string {
  try {
    const req = createRequire(import.meta.url);

    return req.resolve("jscpd/run-jscpd.js");
  } catch {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));

    return path.resolve(__dirname, "../../node_modules/jscpd/run-jscpd.js");
  }
}

const JSCPD_BIN = resolveJscpdBin();
const DEFAULT_MIN_TOKENS = 50;
const DEFAULT_MIN_LINES = 5;
const EXCERPT_LINE_LIMIT = 5;


export interface JscpdOptions {
  minTokens?: number;
  minLines?: number;
}

export function buildJscpdCommand(
  validPaths: string[],
  tempDir: string,
  minTokens: number,
  minLines: number
): string {
  const quotedPaths = validPaths.map((targetPath) => `"${targetPath}"`).join(" ");
  const runtime = process.versions.bun ? "bun" : "node";

  return `"${runtime}" "${JSCPD_BIN}" --reporters json --output "${tempDir}" --min-tokens ${minTokens} --min-lines ${minLines} --silent ${quotedPaths}`;
}
/**
 * Scan target paths for duplicate and copy-pasted code blocks.
 *
 * @param pathsToCheck Array of file or directory paths to check.
 * @param cwd Current working directory.
 * @param options Duplication scanner thresholds.
 * @returns Array of code duplication findings.
 */
export function checkDuplicationWithJscpd(
  pathsToCheck: string[],
  cwd: string = process.cwd(),
  options: JscpdOptions = {}
): Finding[] {
  if (pathsToCheck.length === 0) return [];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "anti-slop-jscpd-"));
  const minTokens = options.minTokens || DEFAULT_MIN_TOKENS;
  const minLines = options.minLines || DEFAULT_MIN_LINES;

  const findings: Finding[] = [];

  try {
    const validPaths = pathsToCheck.filter((targetPath) => fs.existsSync(targetPath));
    if (validPaths.length === 0) return [];

    const isInducedFailure =
      process.env.ANTI_SLOP_INJECT_JSCPD_FAILURE === "true" ||
      validPaths.some((targetPath) => {
        if (targetPath.endsWith("jscpd-runner.ts")) return false;
        try {
          return fs.readFileSync(targetPath, "utf-8").includes(["__ANTI", "SLOP_INDUCED_JSCPD_FAILURE__"].join("_"));
        } catch {
          return false;
        }
      });
    if (isInducedFailure) {
      throw new Error("Induced jscpd checker execution failure");
    }

    const cmd = buildJscpdCommand(validPaths, tempDir, minTokens, minLines);
    let execError: unknown = null;
    try {
      execSync(
        cmd,
        {
          cwd,
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf-8",
        }
      );
    } catch (err: unknown) {
      execError = err;
    }
    const reportPath = path.join(tempDir, "jscpd-report.json");
    if (!fs.existsSync(reportPath)) {
      const detail = execError instanceof Error ? execError.message : String(execError ?? "Report file not created");
      throw new Error(`jscpd failed to produce report: ${detail}`);
    }
    let data: { duplicates?: Array<{ firstFile: { name: string; startLoc?: { line?: number; column?: number }; start?: number }; secondFile: { name: string; startLoc?: { line?: number; column?: number }; start?: number }; lines: number; tokens: number; fragment?: string }> };
    try {
      data = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    } catch (parseErr: unknown) {
      throw new Error(`jscpd produced invalid JSON report: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
    }
    const duplicates = data.duplicates || [];

    for (const dup of duplicates) {
      const first = dup.firstFile;
      const second = dup.secondFile;

      findings.push({
        check: "jscpd",
        rule: "duplicate-code",
        severity: "warning",
        message: `Duplicated block (${dup.lines} lines, ${dup.tokens} tokens) duplicated in ${second.name}:${second.startLoc?.line || second.start}.`,
        file: first.name,
        line: first.startLoc?.line || first.start || 1,
        column: first.startLoc?.column || 1,
        excerpt: dup.fragment?.split("\n").slice(0, EXCERPT_LINE_LIMIT).join("\n"),
        why: "Duplication risk: Repeated business logic creates maintenance divergence when parallel copies drift.",
        suggestion: "Extract the duplicate logic into a shared helper or service.",
      });
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupErr: unknown) {
      // Ignore temp dir cleanup errors
      void cleanupErr;
    }
  }

  return findings;
}
