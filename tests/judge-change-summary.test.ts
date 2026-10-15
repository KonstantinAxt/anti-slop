import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLlmReview } from "../src/judge/gate.js";
import { buildChangeSummary } from "../src/judge/change-summary.js";
import { buildUserPrompt } from "../src/judge/prompt.js";
import type { JudgeCompletionRequest, JudgeProvider, ReviewSource } from "../src/judge/types.js";

let repoDir = "";

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: repoDir, stdio: "ignore" });
}

function createRepo(): void {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "anti-slop-change-summary-"));
  fs.mkdirSync(path.join(repoDir, "src"));
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(repoDir, "src/a.ts"), "function alpha() {\n  return 1;\n}\n");
  fs.writeFileSync(path.join(repoDir, "src/b.ts"), "function beta() {\n  return 1;\n}\n");
  git("add", ".");
  git("commit", "-qm", "Base revision");
  fs.writeFileSync(path.join(repoDir, "src/a.ts"), "function alpha() {\n  return 2;\n}\n");
  git("add", ".");
  git("commit", "-qm", "Change alpha behavior");
  fs.writeFileSync(path.join(repoDir, "src/b.ts"), "function beta() {\n  return 3;\n}\n");
  git("add", ".");
  git("commit", "-qm", "Change beta behavior");
}

function createCaptureProvider(capture: (request: JudgeCompletionRequest) => void): JudgeProvider {
  return {
    name: "capture",
    model: "capture",
    endpoint: "capture://",
    async complete(request) {
      capture(request);

      return { text: JSON.stringify({ verdict: "ALLOW", findings: [] }) };
    },
  };
}

afterEach(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe("judge change summary", () => {
  it("lists changed files, changed top-level declarations, and commit subjects", () => {
    createRepo();

    expect(buildChangeSummary(repoDir, { kind: "since", ref: "HEAD~2" })).toBe([
      "Change summary:",
      "Files:",
      "- src/a.ts (+1 -1): alpha",
      "- src/b.ts (+1 -1): beta",
      "Commits:",
      "- Change alpha behavior",
      "- Change beta behavior",
    ].join("\n"));
  });

  it("lists changed declarations when the summary is built from a subdirectory", () => {
    createRepo();
    const nestedDir = path.join(repoDir, "src/nested");
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(nestedDir, "example.ts"), "export function nestedFeature() {\n  return 1;\n}\n");
    git("add", "src/nested/example.ts");
    git("commit", "-qm", "Add nested file");
    fs.writeFileSync(path.join(nestedDir, "example.ts"), "export function nestedFeature() {\n  return 2;\n}\n");
    git("add", "src/nested/example.ts");

    expect(buildChangeSummary(nestedDir, { kind: "staged" })).toBe([
      "Change summary:",
      "Files:",
      "- example.ts (+1 -1): nestedFeature",
    ].join("\n"));
  });

  it("lists a staged rename and its declaration names", () => {
    createRepo();
    git("mv", "src/a.ts", "src/renamed.ts");
    fs.writeFileSync(path.join(repoDir, "src/renamed.ts"), "function alpha() {\n  return 5;\n}\n");
    git("add", "src/renamed.ts");

    expect(buildChangeSummary(repoDir, { kind: "staged" })).toBe([
      "Change summary:",
      "Files:",
      "- src/a.ts (+0 -3)",
      "- src/renamed.ts (+3 -0): alpha",
    ].join("\n"));
  });

  it("starts every review request with the whole-change summary", async () => {
    createRepo();
    const requests: JudgeCompletionRequest[] = [];
    const provider = createCaptureProvider((request) => { requests.push(request); });
    const targets = ["src/a.ts", "src/b.ts"].map((file) => path.join(repoDir, file));

    await runLlmReview(repoDir, { kind: "since", ref: "HEAD~2" }, targets, provider);

    const expectedHeader = `<change_summary>\nChange summary:\nFiles:\n- src/a.ts (+1 -1): alpha\n- src/b.ts (+1 -1): beta\nCommits:\n- Change alpha behavior\n- Change beta behavior\n</change_summary>\n\n`;

    expect(requests).toHaveLength(2);
    expect(requests[0]?.user.startsWith(expectedHeader)).toBe(true);
    expect(requests[1]?.user.startsWith(expectedHeader)).toBe(true);
  });

  it("lists files and declarations without commit subjects for staged changes", async () => {
    createRepo();
    fs.writeFileSync(path.join(repoDir, "src/a.ts"), "function alpha() {\n  return 5;\n}\n");
    git("add", "src/a.ts");
    const requests: JudgeCompletionRequest[] = [];
    const provider = createCaptureProvider((request) => { requests.push(request); });

    await runLlmReview(repoDir, { kind: "staged" }, [path.join(repoDir, "src/a.ts")], provider);

    expect(requests[0]?.user.startsWith("<change_summary>\nChange summary:\nFiles:\n- src/a.ts (+1 -1): alpha\n</change_summary>\n\n")).toBe(true);
    expect(requests[0]?.user).not.toContain("Commits:");
  });

  it("lists only changed top-level declaration names", () => {
    createRepo();
    fs.writeFileSync(path.join(repoDir, "src/b.ts"), [
      "function beta() {",
      "  return 1;",
      "}",
      "export class Box {}",
      "export interface Shape {}",
      "export type Color = string;",
      "export enum Status { Ready }",
      "export const first = 1, second = 2;",
      "export const { ignored } = { ignored: 1 };",
    ].join("\n") + "\n");
    git("add", "src/b.ts");

    expect(buildChangeSummary(repoDir, { kind: "staged" })).toBe([
      "Change summary:",
      "Files:",
      "- src/b.ts (+7 -1): beta, Box, Shape, Color, Status, first, second",
    ].join("\n"));
  });

  it("summarizes a deletion without declaration names", () => {
    createRepo();
    fs.rmSync(path.join(repoDir, "src/a.ts"));
    git("add", "src/a.ts");

    expect(buildChangeSummary(repoDir, { kind: "staged" })).toBe([
      "Change summary:",
      "Files:",
      "- src/a.ts (+0 -3)",
    ].join("\n"));
  });

  it("omits anonymous declarations and lists duplicate declaration names once", () => {
    createRepo();
    fs.writeFileSync(path.join(repoDir, "src/b.ts"), [
      "function beta() {",
      "  return 1;",
      "}",
      "export default function () {}",
      "function repeated() {}",
      "function repeated() {}",
    ].join("\n") + "\n");
    git("add", "src/b.ts");

    expect(buildChangeSummary(repoDir, { kind: "staged" })).toBe([
      "Change summary:",
      "Files:",
      "- src/b.ts (+4 -1): beta, repeated",
    ].join("\n"));
  });

  it("names changed declarations and omits unchanged top-level declarations", () => {
    createRepo();
    fs.writeFileSync(path.join(repoDir, "src/b.ts"), "function beta() {\n  return 3;\n}\n\nfunction gamma() {\n  return 3;\n}\n");
    git("add", "src/b.ts");

    expect(buildChangeSummary(repoDir, { kind: "staged" })).toBe([
      "Change summary:",
      "Files:",
      "- src/b.ts (+4 -0): gamma",
    ].join("\n"));
  });

  it("reports commit subjects omitted by the summary limit", () => {
    createRepo();
    for (let index = 0; index < 10; index++) {
      git("commit", "--allow-empty", "-qm", `Change-${index}-${"x".repeat(190)}`);
    }

    const summary = buildChangeSummary(repoDir, { kind: "since", ref: "HEAD~10" });

    expect(summary).toContain("Commits:\n- Change-0-");
    expect(summary.endsWith("... 7 more commits")).toBe(true);
  });

  it("redacts secret-looking commit subjects before sending the prompt", async () => {
    createRepo();
    const secretSubject = `token ghp_${"a".repeat(36)}`;
    fs.writeFileSync(path.join(repoDir, "src/a.ts"), "function alpha() {\n  return 8;\n}\n");
    git("add", "src/a.ts");
    git("commit", "-qm", secretSubject);
    const requests: JudgeCompletionRequest[] = [];
    const provider = createCaptureProvider((request) => { requests.push(request); });

    await runLlmReview(repoDir, { kind: "since", ref: "HEAD~1" }, [path.join(repoDir, "src/a.ts")], provider);

    expect(requests[0]?.user).toContain("[REDACTED]");
    expect(requests[0]?.user).not.toContain(secretSubject);
  });

  it("marks binary changes in the public summary", () => {
    createRepo();
    fs.writeFileSync(path.join(repoDir, "src/image.png"), Buffer.from([0, 255, 1]));
    git("add", "src/image.png");

    expect(buildChangeSummary(repoDir, { kind: "staged" })).toBe([
      "Change summary:",
      "Files:",
      "- src/image.png (+binary -binary)",
    ].join("\n"));
  });

  it("omits empty commit subjects for a since range with no commits", () => {
    createRepo();

    expect(buildChangeSummary(repoDir, { kind: "since", ref: "HEAD" })).toBe([
      "Change summary:",
      "Files:",
    ].join("\n"));
  });

  it("preserves replacement sequences in change subjects and diffs", () => {
    expect(buildUserPrompt("diff $' TOKEN", [], "Subject $' TOKEN")).toBe([
      "<change_summary>",
      "Subject $' TOKEN",
      "</change_summary>",
      "",
      "Please review the numbered file below. The left column gives line numbers in the new file. A + marker identifies an added line. A - marker identifies a removed line, which has no line number.",
      "",
      "",
    ].join("\n"));
  });

  it("caps the summary at whole lines and reports omitted files", () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "anti-slop-change-summary-cap-"));
    fs.mkdirSync(path.join(repoDir, "src"));
    git("init", "-q");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    for (let index = 0; index < 40; index++) {
      fs.writeFileSync(path.join(repoDir, `src/file-${index}.ts`), `export const value${index} = 1;\n`);
    }
    git("add", ".");
    git("commit", "-qm", "Base revision");
    for (let index = 0; index < 40; index++) {
      fs.writeFileSync(path.join(repoDir, `src/file-${index}.ts`), `export const value${index} = 2;\n`);
    }
    git("add", ".");

    const summary = buildChangeSummary(repoDir, { kind: "staged" });

    expect(summary.length).toBeLessThanOrEqual(800);
    expect(summary.endsWith("... 18 more files")).toBe(true);
  });

  it("shows removed lines without assigning them new-file line numbers", () => {
    const diff = ["diff --git a/u.ts b/u.ts", "--- a/u.ts", "+++ b/u.ts", "@@ -1,3 +1,2 @@", " unchanged", "-removed", " context"].join("\n");

    expect(buildUserPrompt(diff, [{ path: "u.ts", content: "unchanged\ncontext" }])).toContain("\t1   | unchanged\n\t  - | removed\n\t2   | context");
  });
  it("places deletion-only hunks after their preceding new-file line", () => {
    const diff = ["diff --git a/u.ts b/u.ts", "--- a/u.ts", "+++ b/u.ts", "@@ -2 +1,0 @@", "-removed"].join("\n");

    expect(buildUserPrompt(diff, [{ path: "u.ts", content: "unchanged" }])).toContain("\t1   | unchanged\n\t  - | removed");
  });
  it("keeps removed lines with their deleted file path", () => {
    const diff = [
      "diff --git a/deleted.ts b/deleted.ts",
      "--- a/deleted.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-export const removedOne = 1;",
      "-export const removedTwo = 2;",
      "diff --git a/u.ts b/u.ts",
      "--- a/u.ts",
      "+++ b/u.ts",
      "@@ -1 +1,2 @@",
      " unchanged",
      "+added",
    ].join("\n");

    const prompt = buildUserPrompt(diff, [{ path: "u.ts", content: "unchanged\nadded" }, { path: "caller.ts", content: "context" }]);

    expect(prompt).toContain('<file path="u.ts">');
    expect(prompt).toContain("\t1   | unchanged");
    expect(prompt).not.toContain("removedOne");
    expect(prompt).not.toContain("removedTwo");
    expect(prompt).toContain('<file path="caller.ts">');
  });

  it("numbers the new file, marks added lines, and includes removed lines without new-file numbers", () => {
    const diff = [
      "diff --git a/src/u.ts b/src/u.ts",
      "--- a/src/u.ts",
      "+++ b/src/u.ts",
      "@@ -1,4 +1,5 @@",
      " unchanged one",
      "-removed",
      "+added one",
      " unchanged two",
      "+added two",
    ].join("\n");

    expect(buildUserPrompt(diff, [{ path: "src/u.ts", content: "unchanged one\nadded one\nunchanged two\nadded two\n" }])).toBe([
      "Please review the numbered file below. The left column gives line numbers in the new file. A + marker identifies an added line. A - marker identifies a removed line, which has no line number.",
      "",
      '<file path="src/u.ts">',
      "\t1   | unchanged one",
      "\t  - | removed",
      "\t2 + | added one",
      "\t3   | unchanged two",
      "\t4 + | added two",
      "</file>",
    ].join("\n"));
  });

  it("keeps the change summary before numbered files", () => {
    expect(buildUserPrompt("", [{ path: "src/a.ts", content: "alpha" }], "intent")).toContain("<change_summary>\nintent\n</change_summary>\n\n");
  });

  it("omits the summary block when summary is absent", () => {
    expect(buildUserPrompt("", [])).toBe("Please review the numbered file below. The left column gives line numbers in the new file. A + marker identifies an added line. A - marker identifies a removed line, which has no line number.\n\n");
  });
});
