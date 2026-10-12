import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkMutation } from "../src/checks/stryker-runner.js";
import { getChangedLineRangesSince } from "../src/git.js";

const MUTATION_REPO_CONFIG = "stryker.config.json";

interface FixtureMutant {
  fileName: string;
  status: "Survived" | "Killed";
  mutatorName: string;
  id: string;
  location: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

const MUTANTS: FixtureMutant[] = [
  { fileName: "src/service.ts", status: "Survived", mutatorName: "StringLiteral", id: "unchanged", location: { start: { line: 6, column: 10 }, end: { line: 6, column: 15 } } },
  { fileName: "src/service.ts", status: "Survived", mutatorName: "StringLiteral", id: "changed", location: { start: { line: 2, column: 10 }, end: { line: 2, column: 15 } } },
  { fileName: "src/service.ts", status: "Killed", mutatorName: "StringLiteral", id: "killed", location: { start: { line: 2, column: 1 }, end: { line: 2, column: 4 } } },
];

vi.mock("@stryker-mutator/core", () => ({
  Stryker: class {
    constructor(private readonly options: { mutate?: string[] }) {}

    async runMutationTest(): Promise<FixtureMutant[]> {
      return MUTANTS.filter((mutant) => this.options.mutate?.some((target) => {
        if (target === mutant.fileName) return true;
        const separator = target.lastIndexOf(":");
        const fileName = target.slice(0, separator);
        const range = target.slice(separator + 1);
        const [startText, endText] = range.split("-");
        const start = Number(startText);
        const end = Number(endText ?? startText);

        return fileName === mutant.fileName && mutant.location.start.line >= start && mutant.location.start.line <= end;
      }) ?? false);
    }
  },
}));

let repoDir = "";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
}

function createMutationRepo(): { cwd: string; base: string; source: string; unchangedSource: string } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "anti-slop-mutation-scope-"));
  repoDir = cwd;
  fs.mkdirSync(path.join(cwd, "src"));
  fs.writeFileSync(path.join(cwd, MUTATION_REPO_CONFIG), "{}\n");
  const source = path.join(cwd, "src/service.ts");
  fs.writeFileSync(source, [
    "export function changed(): string {",
    '  return "old";',
    "}",
    "",
    "export function unchanged(): string {",
    '  return "old";',
    "}",
    "",
  ].join("\n"));
  const unchangedSource = path.join(cwd, "src/other.ts");
  fs.writeFileSync(unchangedSource, 'export const other = "same";\n');
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "test@example.invalid");
  git(cwd, "config", "user.name", "Test");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "base");
  const base = git(cwd, "rev-parse", "HEAD").trim();
  fs.writeFileSync(source, [
    "export function changed(): string {",
    '  return "new";',
    "}",
    "",
    "export function unchanged(): string {",
    '  return "old";',
    "}",
    "",
  ].join("\n"));
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "change one line");

  return { cwd, base, source, unchangedSource };
}

afterEach(() => {
  if (repoDir) fs.rmSync(repoDir, { recursive: true, force: true });
  repoDir = "";
});

describe("mutation scope from changed lines", () => {
  it("reports a changed-line survivor but ignores an unchanged-line survivor with --since", async () => {
    const { cwd, base, source } = createMutationRepo();

    const result = await checkMutation(cwd, [source], { since: base });

    expect(result.findings).toEqual([
      expect.objectContaining({ rule: "surviving-mutant", severity: "error", line: 2 }),
    ]);
    expect(result.findings.some((finding) => finding.line === 6)).toBe(false);
    expect(result.metrics).toMatchObject({ total: 2, killed: 1, survived: 1, score: 50 });
  });

  it("keeps the whole file in mutation scope without --since", async () => {
    const { cwd, source } = createMutationRepo();

    const result = await checkMutation(cwd, [source]);

    expect(result.findings.filter((finding) => finding.rule === "surviving-mutant").map((finding) => finding.line)).toEqual([6, 2]);
  });

  it("does not count unchanged target files against the file limit with --since", async () => {
    const { cwd, base, source, unchangedSource } = createMutationRepo();

    const result = await checkMutation(cwd, [source, unchangedSource], { since: base, maxMutationFiles: 1 });

    expect(result.findings.map((finding) => finding.rule)).toEqual(["surviving-mutant"]);
  });

  it("skips mutation when --since has no changed production lines", async () => {
    const { cwd, source } = createMutationRepo();

    const result = await checkMutation(cwd, [source], { since: "HEAD" });

    expect(result).toEqual({ findings: [] });
  });

  it("parses multiple hunks, added files, and deletion-only files from a real diff", () => {
    const { cwd } = createMutationRepo();
    const multiHunk = path.join(cwd, "src/multi.ts");
    const deletionOnly = path.join(cwd, "src/deleted.ts");
    const added = path.join(cwd, "src/added.ts");
    fs.writeFileSync(multiHunk, "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n");
    fs.writeFileSync(deletionOnly, "remove one\nremove two\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "add diff fixtures");
    const diffBase = git(cwd, "rev-parse", "HEAD").trim();
    fs.writeFileSync(multiHunk, "one\nTWO\nthree\nfour\nfive\nsix\nseven\nEIGHT\nnine\nten\n");
    fs.rmSync(deletionOnly);
    fs.writeFileSync(added, "added one\nadded two\n");
    git(cwd, "add", "-A");
    git(cwd, "commit", "-qm", "change multiple files");
    const ranges = getChangedLineRangesSince(cwd, diffBase);

    expect(ranges.get(multiHunk)).toEqual([{ start: 2, end: 2 }, { start: 8, end: 8 }]);

    expect(ranges.get(added)).toEqual([{ start: 1, end: 2 }]);

    expect(ranges.has(deletionOnly)).toBe(false);
  });
});
