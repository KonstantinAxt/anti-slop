import { getChangedLineRangesSince, getDiffFilesSince, getStagedFiles, getTrackedCodeFiles, parseAddedLineNumbers } from "../src/git.js";
import { describe, it, expect, vi } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import * as path from "node:path";
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
    execFileSync: vi.fn(),
    // Real git exits 1 from check-ignore when the directory is not ignored
    spawnSync: vi.fn(() => ({ status: 1 })),
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
    expect(execSync).toHaveBeenLastCalledWith("git diff origin/main...HEAD --name-only --diff-filter=ACMR", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    getDiffFilesSince(cwd, "refs/heads/main");

    expect(execSync).toHaveBeenLastCalledWith("git diff main...HEAD --name-only --diff-filter=ACMR", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  });

  it("parses a headerless hunk", () => {
    expect(parseAddedLineNumbers("@@ -3 +3 @@\n+added")).toEqual(new Map([["", new Set([3])]]));
  });

  it("parses added lines across files", () => {
    const diff = [
      "diff --git a/u.ts b/u.ts", "--- a/u.ts", "+++ b/u.ts", "@@ -1 +2 @@", "+first",
      "diff --git a/v.ts b/v.ts", "--- a/v.ts", "+++ b/v.ts", "@@ -4 +5 @@", "+second",
    ].join("\n");

    expect(parseAddedLineNumbers(diff)).toEqual(new Map([["u.ts", new Set([2])], ["v.ts", new Set([5])]]));
  });

  it("parses a hunk header without counts", () => {
    const diff = ["diff --git a/u.ts b/u.ts", "--- a/u.ts", "+++ b/u.ts", "@@ -3 +3 @@", "+added"].join("\n");

    expect(parseAddedLineNumbers(diff)).toEqual(new Map([["u.ts", new Set([3])]]));
  });

  it("returns an empty set for a deletion-only hunk", () => {
    const diff = ["diff --git a/u.ts b/u.ts", "--- a/u.ts", "+++ b/u.ts", "@@ -3 +2,0 @@", "-removed"].join("\n");

    expect(parseAddedLineNumbers(diff)).toEqual(new Map([["u.ts", new Set()]]));
  });

  it("counts added lines whose content starts with a plus", () => {
    const diff = ["diff --git a/u.ts b/u.ts", "--- a/u.ts", "+++ b/u.ts", "@@ -1 +1,2 @@", "+++ x", "+next"].join("\n");

    expect(parseAddedLineNumbers(diff)).toEqual(new Map([["u.ts", new Set([1, 2])]]));
  });
  it("resets file state at each git diff header", () => {
    const diff = ["diff --git a/u.ts b/u.ts", "--- a/u.ts", "+++ b/u.ts", "@@ -1 +1 @@", "+first", "diff --git a/v.ts b/v.ts", "--- a/v.ts", "+++ b/v.ts", "@@ -1 +1 @@", "+second"].join("\n");

    expect(parseAddedLineNumbers(diff)).toEqual(new Map([["u.ts", new Set([1])], ["v.ts", new Set([1])]]));
  });
  it("resets the file name before a headerless next diff", () => {
    const diff = ["diff --git a/u.ts b/u.ts", "--- a/u.ts", "+++ b/u.ts", "@@ -1 +1 @@", "+first", "diff --git a/v.ts b/v.ts", "@@ -3 +3 @@", "+second"].join("\n");

    expect(parseAddedLineNumbers(diff)).toEqual(new Map([["u.ts", new Set([1])], ["", new Set([3])]]));
  });

  it("does not treat a partial file prefix as a file header", () => {
    expect(parseAddedLineNumbers("+++ a/other.ts\n@@ -1 +1 @@\n+added")).toEqual(new Map([["", new Set([1])]]));
  });

  it("ignores additions before the first hunk", () => {
    expect(parseAddedLineNumbers("diff --git a/u.ts b/u.ts\n+++ b/u.ts\n+header text")).toEqual(new Map());
  });

  it("advances only for context lines in a hunk", () => {
    const diff = ["@@ -1,2 +1,2 @@", "-removed", "\\ No newline at end of file", " context", "+added"].join("\n");

    expect(parseAddedLineNumbers(diff)).toEqual(new Map([["", new Set([2])]]));
  });

  it("parses additions in a new file", () => {
    const diff = ["diff --git a/u.ts b/u.ts", "new file mode 100644", "--- /dev/null", "+++ b/u.ts", "@@ -0,0 +1,2 @@", "+first", "+second"].join("\n");

    expect(parseAddedLineNumbers(diff)).toEqual(new Map([["u.ts", new Set([1, 2])]]));
  });

  it("parses added and changed lines from multiple diff hunks and omits deletions", () => {
    const stdout = [
      "diff --git a/src/first.ts b/src/first.ts",
      "--- a/src/first.ts",
      "+++ b/src/first.ts",
      "@@ -2,0 +3,2 @@",
      "+added",
      "+line",
      "@@ -8,2 +10,1 @@",
      "-old",
      "-older",
      "+changed",
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,2 @@",
      "+new",
      "+file",
      "diff --git a/src/deleted.ts b/src/deleted.ts",
      "--- a/src/deleted.ts",
      "+++ b/src/deleted.ts",
      "@@ -4,2 +4,0 @@",
      "-gone",
      "-lines",
      "",
    ].join("\n");
    vi.mocked(execSync).mockReturnValue(stdout as never);

    const ranges = getChangedLineRangesSince(cwd, "origin/main");

    expect(ranges).toEqual(new Map([
      [path.resolve(cwd, "src/first.ts"), [{ start: 3, end: 4 }, { start: 10, end: 10 }]],
      [path.resolve(cwd, "src/new.ts"), [{ start: 1, end: 2 }]],
    ]));
    expect(execSync).toHaveBeenLastCalledWith("git diff --unified=0 origin/main...HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  });

  it("reads single-line hunks, ignores non-code and removed files, and is not fooled by hunk-like content", () => {
    const stdout = [
      "diff --git a/src/edge.ts b/src/edge.ts",
      "--- a/src/edge.ts",
      "+++ b/src/edge.ts",
      "@@ -7 +12 @@",
      "+one line",
      "@@ -30,3 +20,10 @@",
      "+@@ -1 +40 @@",
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "+docs",
      "diff --git a/src/removed.ts b/src/removed.ts",
      "--- a/src/removed.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "",
    ].join("\n");
    vi.mocked(execSync).mockReturnValue(stdout as never);

    const ranges = getChangedLineRangesSince(cwd, "origin/refs/heads/main");

    expect(ranges).toEqual(new Map([
      [path.resolve(cwd, "src/edge.ts"), [{ start: 12, end: 12 }, { start: 20, end: 29 }]],
    ]));

    expect(execSync).toHaveBeenLastCalledWith("git diff --unified=0 origin/main...HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  });

  it("returns an empty range map when git diff fails", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("fatal: unknown revision");
    });

    expect(getChangedLineRangesSince(cwd, "missing-ref")).toEqual(new Map());
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

  it("keeps dot and build directories when no ignore set is given", () => {
    vi.mocked(execFileSync).mockReturnValue("dist/bundle.js\0.hidden/secret.ts\0" as never);

    expect(getTrackedCodeFiles(cwd)).toEqual([path.resolve(cwd, "dist/bundle.js"), path.resolve(cwd, ".hidden/secret.ts")]);
  });

  it("strips refs/heads only as a leading prefix", () => {
    vi.mocked(execSync).mockReturnValue("" as never);

    getDiffFilesSince(cwd, "feature/refs/heads/x");

    expect(execSync).toHaveBeenCalledWith("git diff feature/refs/heads/x...HEAD --name-only --diff-filter=ACMR", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  });

  it("returns null when git ls-files throws or fails", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("fatal: not a git repository");
    });

    const files = getTrackedCodeFiles(cwd);

    expect(files).toBeNull();
  });
});
