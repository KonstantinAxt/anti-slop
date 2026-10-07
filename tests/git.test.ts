import { describe, it, expect, vi } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import * as path from "node:path";
import { getStagedFiles, getDiffFilesSince, getTrackedCodeFiles } from "../src/git.js";
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
    execFileSync: vi.fn(),
  };
});

describe("Git Diff Helpers (src/git.ts)", () => {
  const cwd = "/test/repo";

  it("filters staged files to only code extensions and tsconfig.json", () => {
    const stdout = "src/index.ts\nREADME.md\ntsconfig.json\nassets/logo.png\nsrc/comp.tsx\n";
    vi.mocked(execSync).mockReturnValue(stdout as never);

    const files = getStagedFiles(cwd);

    expect(files).toEqual([
      path.resolve(cwd, "src/index.ts"),
      path.resolve(cwd, "tsconfig.json"),
      path.resolve(cwd, "src/comp.tsx"),
    ]);
    expect(execSync).toHaveBeenCalledWith("git diff --cached --name-only --diff-filter=ACMR", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  });

  it("filters diff files since a git reference to only code files", () => {
    const stdout = "src/service.js\nsrc/server.mjs\nsrc/module.cjs\nstyle.css\n";
    vi.mocked(execSync).mockReturnValue(stdout as never);

    const files = getDiffFilesSince(cwd, "origin/main");

    expect(files).toEqual([
      path.resolve(cwd, "src/service.js"),
      path.resolve(cwd, "src/server.mjs"),
      path.resolve(cwd, "src/module.cjs"),
    ]);
    expect(execSync).toHaveBeenCalledWith("git diff origin/main...HEAD --name-only --diff-filter=ACMR", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  });

  it("normalizes git refs containing refs/heads/ prefix", () => {
    const stdout = "src/service.js\n";
    vi.mocked(execSync).mockReturnValue(stdout as never);

    getDiffFilesSince(cwd, "origin/refs/heads/main");
    expect(execSync).toHaveBeenCalledWith("git diff origin/main...HEAD --name-only --diff-filter=ACMR", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    getDiffFilesSince(cwd, "refs/heads/main");
    expect(execSync).toHaveBeenCalledWith("git diff main...HEAD --name-only --diff-filter=ACMR", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  });

  it("returns an empty array when git execution fails or throws", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("fatal: not a git repository");
    });

    const files = getStagedFiles(cwd);

    expect(files).toEqual([]);
  });

  it("handles empty output and whitespace cleanly", () => {
    const stdout = "  \n  src/trimmed.ts  \n\n  src/legacy.cjs  \n  ";
    vi.mocked(execSync).mockReturnValue(stdout as never);

    const files = getStagedFiles(cwd);

    expect(files).toEqual([
      path.resolve(cwd, "src/trimmed.ts"),
      path.resolve(cwd, "src/legacy.cjs"),
    ]);
  });

  it("returns tracked code files respecting custom ignored directories", () => {
    const stdout = "src/index.ts\0src/comp.tsx\0dist/bundle.js\0assets/logo.png\0.hidden/secret.ts\0";
    vi.mocked(execFileSync).mockReturnValue(stdout as never);

    const files = getTrackedCodeFiles(cwd, new Set(["dist"]));

    expect(files).toEqual([
      path.resolve(cwd, "src/index.ts"),
      path.resolve(cwd, "src/comp.tsx"),
    ]);
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["-C", cwd, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
  });

  it("returns null when git ls-files throws or fails", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("fatal: not a git repository");
    });

    const files = getTrackedCodeFiles(cwd);

    expect(files).toBeNull();
  });
});
