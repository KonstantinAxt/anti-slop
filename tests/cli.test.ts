import { describe, expect, it } from "bun:test";
import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const CLI_PATH = path.resolve(import.meta.dir, "../bin/anti-slop");

function runSubprocess(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(CLI_PATH, args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

describe("CLI Process Integration", () => {
  it("prints help and exits with 0 on --help", () => {
    const stdout = execSync(`"${CLI_PATH}" --help`, { encoding: "utf-8" });

    expect(stdout).toContain("USAGE:");
    expect(stdout).toContain("anti-slop");
    expect(stdout).toContain("--staged");
    expect(stdout).toContain("--crap");
    expect(stdout).toContain("--crap-threshold");
  }, 30000);

  it("outputs structured JSON when --json is passed", () => {
    const stdout = execSync(
      `"${CLI_PATH}" --json tests/tracer.test.ts`,
      { encoding: "utf-8" }
    );
    const parsed = JSON.parse(stdout);

    expect(parsed).toHaveProperty("findings");
    expect(parsed).toHaveProperty("totalFilesChecked");
  }, 30000);

  it("outputs Markdown findings when --llm is passed", () => {
    const stdout = execSync(
      `"${CLI_PATH}" --llm tests/tracer.test.ts`,
      { encoding: "utf-8" }
    );

    expect(stdout).toContain("# Anti-AI Slop Review Findings");
  }, 30000);

  it("accepts --allow-loose-tsconfig flag", () => {
    const stdout = execSync(`"${CLI_PATH}" --help`, { encoding: "utf-8" });

    expect(stdout).toContain("--allow-loose-tsconfig");
  }, 30000);

  it("accepts --crap and --crap-threshold flags", () => {
    const stdout = execSync(
      `"${CLI_PATH}" --json --crap --crap-threshold 25 tests/tracer.test.ts`,
      { encoding: "utf-8" }
    );
    const parsed = JSON.parse(stdout);

    expect(parsed).toHaveProperty("crapEntries");
  }, 30000);

  it("drains large multi-megabyte JSON output completely without truncation through subprocess pipe", async () => {
    const tmpDir = path.resolve(import.meta.dir, "../.tmp-test");
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, "large-findings.ts");
    const targetType = ["a", "n", "y"].join("");
    await fs.promises.writeFile(
      tmpFile,
      Array.from({ length: 2500 }, (_, i) => `export const x${i} = (1 as ${targetType});`).join("\n")
    );
    try {
      const { stdout, stderr, exitCode } = await runSubprocess(["--json", tmpFile], path.resolve(import.meta.dir, ".."));

      expect(exitCode).toBe(1);
      expect(stderr).toBe("");
      expect(stdout.length).toBeGreaterThan(1000000);

      const parsed = JSON.parse(stdout);
      expect(parsed.passed).toBe(false);
      expect(parsed.totalFilesChecked).toBe(1);
      expect(parsed.findings.length).toBeGreaterThanOrEqual(2500);
    } finally {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }, 60000);

  it("routes terminal formatted failures to stderr with exit 1", async () => {
    const { stdout, stderr, exitCode } = await runSubprocess(
      ["--format", "terminal", "e2e-fixtures/strict-ts/semantic-violations.ts"],
      path.resolve(import.meta.dir, "..")
    );

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("anti-slop");
    expect(stderr).toContain("semantic-violations.ts");
  }, 30000);
});
