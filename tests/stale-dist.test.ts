import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "..");

const BIN_CLI = path.join(REPO_ROOT, "bin/anti-slop");

const SANDBOX_DIR = path.join(REPO_ROOT, ".tmp-stale-dist-test");

interface SandboxPaths {
  binTarget: string;
  distTarget: string;
  tsTarget: string;
  srcTarget: string;
}

function setupSandboxEnvironment(includeSrc: boolean): SandboxPaths {
  const binDir = path.join(SANDBOX_DIR, "bin");

  const distDir = path.join(SANDBOX_DIR, "dist");

  fs.mkdirSync(binDir, { recursive: true });

  fs.mkdirSync(distDir, { recursive: true });

  const binTarget = path.join(binDir, "anti-slop");

  fs.copyFileSync(BIN_CLI, binTarget);

  fs.chmodSync(binTarget, 0o755);

  const distTarget = path.join(distDir, "cli.js");

  fs.writeFileSync(distTarget, "console.log('OUTPUT_FROM_DIST');\n");

  const tsTarget = path.join(binDir, "anti-slop.ts");

  const srcTarget = path.join(SANDBOX_DIR, "src", "index.ts");

  if (includeSrc) {
    const srcDir = path.join(SANDBOX_DIR, "src");

    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(tsTarget, "console.log('OUTPUT_FROM_SOURCE');\n");

    fs.writeFileSync(srcTarget, "export const marker = 1;\n");
  }

  return { binTarget, distTarget, tsTarget, srcTarget };
}

describe("Stale dist detection in bin/anti-slop", () => {
  beforeEach(() => {
    fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });

    fs.mkdirSync(SANDBOX_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });
  });

  it("executes source when dist is older than source files", () => {
    const { binTarget, distTarget } = setupSandboxEnvironment(true);

    const pastTimestampSeconds = 1000;

    fs.utimesSync(distTarget, pastTimestampSeconds, pastTimestampSeconds);

    const stdout = execSync(`node "${binTarget}"`, {
      encoding: "utf-8",
    });

    const trimmed = stdout.trim();

    expect(trimmed).toBe("OUTPUT_FROM_SOURCE");
  });

  it("executes dist when dist is newer than source files", () => {
    const { binTarget, distTarget, tsTarget, srcTarget } = setupSandboxEnvironment(true);

    const pastTimestampSeconds = 1000;

    fs.utimesSync(tsTarget, pastTimestampSeconds, pastTimestampSeconds);

    fs.utimesSync(srcTarget, pastTimestampSeconds, pastTimestampSeconds);

    const nowTimestampSeconds = 2000;

    fs.utimesSync(distTarget, nowTimestampSeconds, nowTimestampSeconds);

    const stdout = execSync(`node "${binTarget}"`, {
      encoding: "utf-8",
    });

    const trimmed = stdout.trim();

    expect(trimmed).toBe("OUTPUT_FROM_DIST");
  });

  it("executes dist in a published-like layout without src", () => {
    const { binTarget } = setupSandboxEnvironment(false);

    const stdout = execSync(`node "${binTarget}"`, {
      encoding: "utf-8",
    });

    const trimmed = stdout.trim();

    expect(trimmed).toBe("OUTPUT_FROM_DIST");
  });

  it("executes source when ANTI_SLOP_FORCE_SOURCE is set even if dist is fresh", () => {
    const { binTarget } = setupSandboxEnvironment(true);

    const stdout = execSync(`node "${binTarget}"`, {
      encoding: "utf-8",
      env: {
        ...process.env,
        ANTI_SLOP_FORCE_SOURCE: "true",
      },
    });

    const trimmed = stdout.trim();

    expect(trimmed).toBe("OUTPUT_FROM_SOURCE");
  });
});
