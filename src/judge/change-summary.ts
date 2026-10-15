import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as ts from "typescript";
import { createSourceFile } from "../checks/ast.js";
import { parseAddedLineNumbers } from "../git.js";
import { readReviewFile, resolveReviewDiffSource } from "./review-source.js";
import type { ReviewDiffSource } from "./review-source.js";
import type { ReviewSource } from "./types.js";

const SUMMARY_CHAR_LIMIT = 800;
const REVIEWABLE_EXTENSIONS: Record<string, true> = { ".ts": true, ".tsx": true, ".js": true, ".jsx": true, ".mjs": true, ".cjs": true };

interface ChangeCounts {
  added: string;
  removed: string;
}

function parseNumstat(output: string): Map<string, ChangeCounts> {
  const files = new Map<string, ChangeCounts>();
  for (const line of output.split("\n")) {
    const firstTab = line.indexOf("\t");
    const secondTab = line.indexOf("\t", firstTab + 1);
    const filePath = line.slice(secondTab + 1);
    if (firstTab < 0 || secondTab < 0 || !filePath) continue;
    files.set(filePath, { added: line.slice(0, firstTab), removed: line.slice(firstTab + 1, secondTab) });
  }

  return files;
}

function declarationName(statement: ts.Statement): string | undefined {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
    return statement.name.text;
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map((declaration) => ts.isIdentifier(declaration.name) ? declaration.name.text : undefined).filter((name): name is string => name !== undefined).join(", ");
  }

  return undefined;
}

function declarationNames(filePath: string, content: string, diff: string): string[] {
  const addedLines = parseAddedLineNumbers(diff).get(filePath) ?? new Set<number>();
  const sourceFile = createSourceFile(filePath, content);
  const names: string[] = [];
  for (const statement of sourceFile.statements) {
    const start = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
    const end = sourceFile.getLineAndCharacterOfPosition(statement.end).line + 1;
    let changed = false;
    for (const line of addedLines) {
      if (line >= start && line <= end) {
        changed = true;
        break;
      }
    }
    if (!changed) continue;
    const name = declarationName(statement);
    if (name && !names.includes(name)) names.push(name);
  }

  return names;
}

function displayLineCount(value: string): string {
  return value === "-" ? "binary" : String(Number(value) || 0);
}

function changedFileLines(cwd: string, source: ReviewDiffSource, files: Map<string, ChangeCounts>): string[] {
  const result: string[] = [];
  for (const [filePath, counts] of files) {
    const diff = REVIEWABLE_EXTENSIONS[path.extname(filePath)] && counts.added !== "0" && counts.added !== "-"
      ? execFileSync("git", ["diff", ...source.args, "--relative", "--", filePath], { cwd, encoding: "utf-8", maxBuffer: Infinity })
      : "";
    const names = diff === "" ? [] : declarationNames(filePath, readReviewFile(cwd, path.join(cwd, filePath), source), diff);
    result.push(`- ${filePath} (+${displayLineCount(counts.added)} -${displayLineCount(counts.removed)})${names.length > 0 ? `: ${names.join(", ")}` : ""}`);
  }

  return result;
}

function commitSubjects(cwd: string, source: ReviewSource): string[] {
  if (source.kind === "staged") return [];

  return execFileSync("git", ["log", "--format=%s", `${source.ref}..HEAD`], { cwd, encoding: "utf-8", maxBuffer: Infinity }).trim().split("\n").filter(Boolean).reverse();
}

function truncateSummary(fileLines: string[], subjects: string[]): string {
  const lines = ["Change summary:", "Files:"];
  let fileIndex = 0;
  let subjectIndex = 0;

  for (const fileLine of fileLines) {
    const omittedFiles = fileLines.length - fileIndex - 1;
    const omittedSubjects = subjects.length - subjectIndex;
    const suffix = [
      ...(omittedFiles > 0 ? [`... ${omittedFiles} more files`] : []),
      ...(subjects.length > 0 ? ["Commits:", `... ${omittedSubjects} more commits`] : []),
    ];
    if ([...lines, fileLine, ...suffix].join("\n").length > SUMMARY_CHAR_LIMIT) break;
    lines.push(fileLine);
    fileIndex++;
  }

  if (fileIndex < fileLines.length) lines.push(`... ${fileLines.length - fileIndex} more files`);
  if (subjects.length > 0) lines.push("Commits:");
  for (; subjectIndex < subjects.length; subjectIndex++) {
    const subjectLine = `- ${subjects[subjectIndex]}`;
    const suffix = subjectIndex < subjects.length - 1 ? `... ${subjects.length - subjectIndex - 1} more commits` : "";
    if ([...lines, subjectLine, ...(suffix ? [suffix] : [])].join("\n").length > SUMMARY_CHAR_LIMIT) break;
    lines.push(subjectLine);
  }
  if (subjectIndex < subjects.length) lines.push(`... ${subjects.length - subjectIndex} more commits`);

  return lines.join("\n");
}

export function buildChangeSummary(cwd: string, source: ReviewSource): string {
  const reviewSource = resolveReviewDiffSource(source);
  const numstat = execFileSync("git", ["diff", ...reviewSource.args, "--numstat"], { cwd, encoding: "utf-8", maxBuffer: Infinity });
  const files = parseNumstat(numstat);
  const fileLines = changedFileLines(cwd, reviewSource, files);
  const subjects = commitSubjects(cwd, source);
  const full = ["Change summary:", "Files:", ...fileLines, ...(subjects.length > 0 ? ["Commits:", ...subjects.map((subject) => `- ${subject}`)] : [])].join("\n");

  return full.length <= SUMMARY_CHAR_LIMIT ? full : truncateSummary(fileLines, subjects);
}
