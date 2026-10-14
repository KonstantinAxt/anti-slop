import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { runCliProcess } from "./cli-process.js";

const REPO_ROOT = path.resolve(import.meta.dir, "..");

describe("CLI Process Integration", () => {
  it("prints help and exits with 0 on --help", async ({ signal }) => {
    const { stdout, status } = await runCliProcess(["--help"], REPO_ROOT, signal);

    expect(status).toBe(0);
    expect(stdout).toContain("USAGE:");
    expect(stdout).toContain("anti-slop");
    expect(stdout).toContain("--staged");
    expect(stdout).toContain("--crap");
    expect(stdout).toContain("--crap-threshold");
  });

  it("outputs structured JSON when --json is passed", async ({ signal }) => {
    const { stdout, status } = await runCliProcess(["--json", "tests/tracer.test.ts"], REPO_ROOT, signal);
    const parsed = JSON.parse(stdout);

    expect(status).toBe(0);
    expect(parsed).toHaveProperty("findings");
    expect(parsed).toHaveProperty("totalFilesChecked");
  });

  it("outputs Markdown findings when --llm is passed", async ({ signal }) => {
    const { stdout, status } = await runCliProcess(["--llm", "tests/tracer.test.ts"], REPO_ROOT, signal);

    expect(status).toBe(0);
    expect(stdout).toContain("# Anti-AI Slop Review Findings");
  });

  it("accepts --allow-loose-tsconfig flag", async ({ signal }) => {
    const { stdout, status } = await runCliProcess(["--help"], REPO_ROOT, signal);

    expect(status).toBe(0);
    expect(stdout).toContain("--allow-loose-tsconfig");
  });

  it("accepts --crap and --crap-threshold flags", async ({ signal }) => {
    const { stdout, status } = await runCliProcess(
      ["--json", "--crap", "--crap-threshold", "25", "tests/tracer.test.ts"],
      REPO_ROOT,
      signal
    );
    const parsed = JSON.parse(stdout);

    expect(status).toBe(0);
    expect(parsed).toHaveProperty("crapEntries");
  });

  it("drains large multi-megabyte JSON output completely without truncation through subprocess pipe", async ({ signal }) => {
    const tmpDir = path.resolve(import.meta.dir, "../.tmp-test");
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, "large-findings.ts");
    const targetType = ["a", "n", "y"].join("");
    await fs.promises.writeFile(
      tmpFile,
      Array.from({ length: 2500 }, (_, i) => `export const x${i} = (1 as ${targetType});`).join("\n")
    );
    try {
      const { stdout, stderr, status } = await runCliProcess(["--json", tmpFile], REPO_ROOT, signal);

      expect(status).toBe(1);
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
  });

  it("routes terminal formatted failures to stderr with exit 1", async ({ signal }) => {
    const { stdout, stderr, status } = await runCliProcess(
      ["--format", "terminal", "e2e-fixtures/strict-ts/semantic-violations.ts"],
      REPO_ROOT,
      signal
    );

    expect(status).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("anti-slop");
    expect(stderr).toContain("semantic-violations.ts");
  });
});
