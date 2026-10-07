import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  auditTsConfig,
  discoverCodeFiles,
  resolveTargetFiles,
  runAntiSlop,
  scanFile,
} from "../src/index.js";

const TSCONFIG_NAME = "tsconfig.json";

describe("AntiSlop Core Runner", () => {
  function createSandbox(name: string): { dir: string; cleanup: () => void } {
    const tempDir = path.join(import.meta.dir, name);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });

    return {
      dir: tempDir,
      cleanup: () => {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true });
        }
      },
    };
  }

  it("orchestrates all deterministic checks across provided file contents", async () => {
    const sandbox = createSandbox("temp-test-sandbox");
    fs.mkdirSync(path.join(sandbox.dir, "src/services"), { recursive: true });

    fs.writeFileSync(
      path.join(sandbox.dir, TSCONFIG_NAME),
      JSON.stringify({ compilerOptions: { strict: false } })
    );

    fs.writeFileSync(
      path.join(sandbox.dir, "src/services/payroll.service.ts"),
      `
      import { Button } from "../components/Button";

      export class PayrollService {
        calculate(hours: number[]) {
          const sum = hours[0]!;
          return Math.round(sum * 10) / 10;
        }
      }
      `
    );

    const result = await runAntiSlop({
      cwd: sandbox.dir,
      files: [
        path.join(sandbox.dir, TSCONFIG_NAME),
        path.join(sandbox.dir, "src/services/payroll.service.ts"),
      ],
    });

    sandbox.cleanup();

    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.rule === "strict-mode")).toBe(true);
    expect(result.findings.some((f) => f.rule === "ui-free-service")).toBe(true);
    expect(result.findings.some((f) => f.rule === "no-non-null-assertion")).toBe(true);
    expect(result.findings.some((f) => f.rule === "no-service-rounding")).toBe(true);
  }, 30000);

  it("does not audit tsconfig when tsconfig is not in target files", async () => {
    const sandbox = createSandbox("temp-scoped-sandbox");

    fs.writeFileSync(
      path.join(sandbox.dir, TSCONFIG_NAME),
      JSON.stringify({ compilerOptions: { strict: false, noUncheckedIndexedAccess: false } })
    );

    fs.writeFileSync(
      path.join(sandbox.dir, "src/clean.ts"),
      `export function add(a: number, b: number): number { return a + b; }`
    );

    const result = await runAntiSlop({
      cwd: sandbox.dir,
      files: [path.join(sandbox.dir, "src/clean.ts")],
    });

    sandbox.cleanup();

    expect(result.findings.some((f) => f.file.includes(TSCONFIG_NAME))).toBe(false);
    expect(result.passed).toBe(true);
  }, 30000);

  it("ignores loose tsconfig when allowLooseTsConfig is true", async () => {
    const sandbox = createSandbox("temp-loose-sandbox");

    fs.writeFileSync(
      path.join(sandbox.dir, TSCONFIG_NAME),
      JSON.stringify({ compilerOptions: { strict: false } })
    );

    fs.writeFileSync(
      path.join(sandbox.dir, "src/index.ts"),
      `export const version = "1.0.0";`
    );

    const fullRunResult = await runAntiSlop({
      cwd: sandbox.dir,
      allowLooseTsConfig: true,
    });

    sandbox.cleanup();

    expect(fullRunResult.findings.some((f) => f.file.includes(TSCONFIG_NAME))).toBe(false);
    expect(fullRunResult.passed).toBe(true);
  }, 30000);

  it("runs CRAP analysis when options.crap is true and reports crapEntries", async () => {
    const sandbox = createSandbox("temp-crap-sandbox");

    fs.writeFileSync(
      path.join(sandbox.dir, "src/math.ts"),
      `export function add(a: number, b: number) { return a + b; }`
    );

    const result = await runAntiSlop({
      cwd: sandbox.dir,
      files: [path.join(sandbox.dir, "src/math.ts")],
      crap: true,
      allowLooseTsConfig: true,
    });

    sandbox.cleanup();

    expect(result.crapEntries?.length).toBe(1);
    expect(result.crapEntries?.[0]?.functionName).toBe("add");
    expect(result.crapEntries?.[0]?.complexity).toBe(1);
  }, 30000);
  it("isolates check execution when options.checks is specified (e.g. only crap)", async () => {
    const sandbox = createSandbox("temp-checks-isolation-sandbox");
    const testFile = path.join(sandbox.dir, "src/math.ts");
    // Contains implicit any which triggers a base linter finding in normal mode
    fs.writeFileSync(
      testFile,
      `export function add(a: number, b: number) { return a + b; }\nexport function bad(x) { return x; }`
    );

    // 1. With checks: ["crap"], base lint findings should be completely skipped
    const crapOnlyResult = await runAntiSlop({
      cwd: sandbox.dir,
      files: [testFile],
      checks: ["crap"],
    });

    expect(crapOnlyResult.crapEntries).toBeDefined();
    expect(crapOnlyResult.crapEntries?.some((e) => e.functionName === "add")).toBe(true);
    expect(crapOnlyResult.findings.some((f) => f.rule === "no-implicit-any")).toBe(false);

    // 2. Without checks filter, base lint findings are included
    const fullResult = await runAntiSlop({
      cwd: sandbox.dir,
      files: [testFile],
      crap: true,
    });
    expect(fullResult.findings.some((f) => f.rule === "no-implicit-any")).toBe(true);

    sandbox.cleanup();
  }, 30000);


  it("calibrates implicit-any findings to warning in loose mode, respecting explicit overrides", async () => {
    const sandbox = createSandbox("temp-loose-mode-sandbox");
    const testFile = path.join(sandbox.dir, "src/implicit.ts");
    fs.writeFileSync(testFile, "export function greet(name) { return 'Hello ' + name; }");

    // 1. Normal mode: implicit-any should be an error, causing overall failure
    const normalResult = await runAntiSlop({
      cwd: sandbox.dir,
      files: [testFile],
    });
    const normalFinding = normalResult.findings.find((f) => f.rule === "no-implicit-any");
    expect(normalFinding).toBeDefined();
    expect(normalFinding?.severity).toBe("error");
    expect(normalResult.passed).toBe(false);

    // 2. Loose mode: implicit-any defaults to warning, allowing overall pass
    const looseResult = await runAntiSlop({
      cwd: sandbox.dir,
      files: [testFile],
      allowLooseTsConfig: true,
    });
    const looseFinding = looseResult.findings.find((f) => f.rule === "no-implicit-any");
    expect(looseFinding).toBeDefined();
    expect(looseFinding?.severity).toBe("warning");
    expect(looseResult.passed).toBe(true);

    // 3. Loose mode with explicit repository override to "error"
    const overrideErrorResult = await runAntiSlop({
      cwd: sandbox.dir,
      files: [testFile],
      allowLooseTsConfig: true,
      rules: { "strict-ts/no-implicit-any": "error" },
    });
    const overrideErrorFinding = overrideErrorResult.findings.find((f) => f.rule === "no-implicit-any");
    expect(overrideErrorFinding?.severity).toBe("error");
    expect(overrideErrorResult.passed).toBe(false);

    // 4. Loose mode with explicit repository override to "off"
    const overrideOffResult = await runAntiSlop({
      cwd: sandbox.dir,
      files: [testFile],
      allowLooseTsConfig: true,
      rules: { "strict-ts/no-implicit-any": "off" },
    });
    const overrideOffFinding = overrideOffResult.findings.find((f) => f.rule === "no-implicit-any");
    expect(overrideOffFinding).toBeUndefined();
    expect(overrideOffResult.passed).toBe(true);

    sandbox.cleanup();
  }, 30000);

  it("runs PR size check when options.prSize is true or checks filter includes pr-size", async () => {
    const sandbox = createSandbox("temp-prsize-sandbox");
    const result = await runAntiSlop({
      cwd: sandbox.dir,
      prSize: true,
      checks: ["pr-size"],
    });
    expect(result.targetDir).toBe(path.resolve(sandbox.dir));
    expect(Array.isArray(result.findings)).toBe(true);
    sandbox.cleanup();
  });

  it("resolves directory targets into discovered code files", async () => {
    const sandbox = createSandbox("temp-dir-target-sandbox");
    fs.writeFileSync(path.join(sandbox.dir, "src/nested.ts"), "export const n = 1;");
    const result = await runAntiSlop({
      cwd: sandbox.dir,
      files: [path.join(sandbox.dir, "src")],
      checks: ["syntax"],
    });
    expect(result.totalFilesChecked).toBeGreaterThanOrEqual(1);
    sandbox.cleanup();
  });

  it("flags tsconfig-syntax-error when targeted tsconfig.json is malformed", async () => {
    const sandbox = createSandbox("temp-bad-tsconfig-sandbox");
    const badTsConfig = path.join(sandbox.dir, "tsconfig.json");
    fs.writeFileSync(badTsConfig, "{ malformed json: true, ");
    const result = await runAntiSlop({
      cwd: sandbox.dir,
      files: [badTsConfig],
    });
    const syntaxErrorFinding = result.findings.find((f) => f.rule === "tsconfig-syntax-error");
    expect(syntaxErrorFinding).toBeDefined();
    expect(syntaxErrorFinding?.severity).toBe("error");
    expect(result.passed).toBe(false);
    sandbox.cleanup();
  });

  it("deduplicates identical findings by file, line, and rule", async () => {
    const sandbox = createSandbox("temp-dedup-sandbox");
    const file = path.join(sandbox.dir, "src/dedup.ts");
    fs.writeFileSync(file, "export const a = 1;");
    // Passing the same file twice to verify duplicate findings are filtered
    const result = await runAntiSlop({
      cwd: sandbox.dir,
      files: [file, file],
    });
    const keys = result.findings.map((f) => `${f.file}:${f.line}:${f.rule}`);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
    sandbox.cleanup();
  });

  it("discovers code files ignoring dotfiles and ignored directories", () => {
    const sandbox = createSandbox("temp-discover-sandbox");
    fs.mkdirSync(path.join(sandbox.dir, ".hidden-dir"), { recursive: true });
    fs.mkdirSync(path.join(sandbox.dir, "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(sandbox.dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(sandbox.dir, ".hidden-dir/secret.ts"), "export const s = 1;");
    fs.writeFileSync(path.join(sandbox.dir, "node_modules/lib.js"), "export const l = 1;");
    fs.writeFileSync(path.join(sandbox.dir, ".env"), "KEY=VALUE");
    fs.writeFileSync(path.join(sandbox.dir, ".eslintrc.json"), "{}");
    fs.writeFileSync(path.join(sandbox.dir, "src/index.ts"), "export const a = 1;");
    fs.writeFileSync(path.join(sandbox.dir, "src/app.tsx"), "export const b = 2;");
    fs.writeFileSync(path.join(sandbox.dir, "src/README.md"), "# Readme");

    const files = discoverCodeFiles(sandbox.dir);
    expect(files.some((f) => f.endsWith("src/index.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("src/app.tsx"))).toBe(true);
    expect(files.some((f) => f.includes(".hidden-dir"))).toBe(false);
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
    expect(files.some((f) => f.endsWith(".env"))).toBe(false);
    expect(files.some((f) => f.endsWith("README.md"))).toBe(false);

    // When directory does not exist
    expect(discoverCodeFiles(path.join(sandbox.dir, "nonexistent"))).toEqual([]);
    sandbox.cleanup();
  });

  it("evaluates auditTsConfig across scoped, loose, and missing configurations", () => {
    const sandbox = createSandbox("temp-audit-tsconfig-sandbox");
    const tsconfig = path.join(sandbox.dir, "tsconfig.json");
    fs.writeFileSync(tsconfig, "{}");

    // 1. allowLooseTsConfig returns []
    expect(auditTsConfig(sandbox.dir, { allowLooseTsConfig: true }, [tsconfig])).toEqual([]);

    // 2. Scoped run where tsconfig is not in targetFiles returns []
    expect(auditTsConfig(sandbox.dir, { files: ["src/app.ts"] }, ["src/app.ts"])).toEqual([]);

    // Scoped runs with staged or since also skip tsconfig if not targeted
    expect(auditTsConfig(sandbox.dir, { staged: true }, ["src/app.ts"])).toEqual([]);
    expect(auditTsConfig(sandbox.dir, { since: "HEAD" }, ["src/app.ts"])).toEqual([]);

    // When tsconfig is targeted and has non-strict options
    fs.writeFileSync(tsconfig, JSON.stringify({ compilerOptions: { noImplicitAny: false } }));
    const findings = auditTsConfig(sandbox.dir, { files: [tsconfig] }, [tsconfig]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.check === "strict-ts")).toBe(true);

    // 3. Missing tsconfig returns []
    expect(auditTsConfig("/nonexistent/dir", {}, [])).toEqual([]);
    sandbox.cleanup();
  });

  it("resolves target files across files, staged, since, and default modes", () => {
    const sandbox = createSandbox("temp-resolve-targets-sandbox");
    const srcFile = path.join(sandbox.dir, "src/main.ts");
    fs.mkdirSync(path.join(sandbox.dir, "src"), { recursive: true });
    fs.writeFileSync(srcFile, "export const m = 1;");

    // 1. Specific files
    expect(resolveTargetFiles(sandbox.dir, { files: [srcFile] })).toEqual([srcFile]);

    // 2. Default (cwd discovery)
    const discovered = resolveTargetFiles(sandbox.dir, {});
    expect(discovered.some((f) => f.endsWith("src/main.ts"))).toBe(true);

    // 3. Staged files mode
    const stagedFiles = resolveTargetFiles(process.cwd(), { staged: true });
    expect(Array.isArray(stagedFiles)).toBe(true);

    // 4. Since diff mode
    const sinceFiles = resolveTargetFiles(process.cwd(), { since: "HEAD" });
    expect(Array.isArray(sinceFiles)).toBe(true);
    sandbox.cleanup();
  });

  it("resolves directory target respecting git-ignored subfolders", () => {
    const sandbox = createSandbox("temp-git-ignored-dir-sandbox");
    const srcDir = path.join(sandbox.dir, "src");
    const normalFile = path.join(srcDir, "index.ts");
    const ignoredDir = path.join(srcDir, "coverage");
    const ignoredFile = path.join(ignoredDir, "report.js");

    fs.mkdirSync(ignoredDir, { recursive: true });

    fs.writeFileSync(normalFile, "export const a = 1;");

    fs.writeFileSync(ignoredFile, "export const b = 2;");

    fs.writeFileSync(path.join(sandbox.dir, ".gitignore"), "coverage/\n");

    execSync("git init -q", { cwd: sandbox.dir });

    const targets = resolveTargetFiles(sandbox.dir, { files: [srcDir] });

    const hasNormal = targets.includes(normalFile);

    expect(hasNormal).toBe(true);

    const hasIgnored = targets.includes(ignoredFile);

    expect(hasIgnored).toBe(false);

    const explicitTargets = resolveTargetFiles(sandbox.dir, { files: [ignoredFile] });

    expect(explicitTargets).toEqual([ignoredFile]);

    sandbox.cleanup();
  });

  it("resolves default cwd scan respecting git-ignored subfolders", () => {
    const sandbox = createSandbox("temp-git-ignored-default-sandbox");
    const normalFile = path.join(sandbox.dir, "src/index.ts");
    const ignoredDir = path.join(sandbox.dir, "reports/coverage");
    const ignoredFile = path.join(ignoredDir, "index.js");

    fs.mkdirSync(ignoredDir, { recursive: true });

    fs.writeFileSync(normalFile, "export const a = 1;");

    fs.writeFileSync(ignoredFile, "export const b = 2;");

    fs.writeFileSync(path.join(sandbox.dir, ".gitignore"), "reports/\n");

    execSync("git init -q", { cwd: sandbox.dir });

    const targets = resolveTargetFiles(sandbox.dir, {});

    const hasNormal = targets.includes(normalFile);

    expect(hasNormal).toBe(true);

    const hasIgnored = targets.includes(ignoredFile);

    expect(hasIgnored).toBe(false);

    sandbox.cleanup();
  });
  it("returns empty findings from scanFile when path is a directory or missing, and handles read errors", async () => {
    const sandbox = createSandbox("temp-scan-file-sandbox");
    const mockConfig = { globalRules: {}, fileOverrides: [] };
    expect(await scanFile(sandbox.dir, sandbox.dir, mockConfig)).toEqual([]);
    expect(await scanFile(sandbox.dir, path.join(sandbox.dir, "missing.ts"), mockConfig)).toEqual([]);

    // Unreadable file test for file-read-error
    const unreadableFile = path.join(sandbox.dir, "unreadable.ts");
    fs.writeFileSync(unreadableFile, "export const x = 1;");
    try {
      fs.chmodSync(unreadableFile, 0o000);
      const errorFindings = await scanFile(sandbox.dir, unreadableFile, mockConfig);
      expect(errorFindings).toHaveLength(1);
      expect(errorFindings[0]?.rule).toBe("file-read-error");
      expect(errorFindings[0]?.check).toBe("system");
      expect(errorFindings[0]?.severity).toBe("warning");
    } finally {
      fs.chmodSync(unreadableFile, 0o666);
    }
    sandbox.cleanup();
  });

  it("executes runAntiSlop across various check filter combinations", async () => {
    const sandbox = createSandbox("temp-run-antislop-filters");
    const f1 = path.join(sandbox.dir, "f1.ts");
    const f2 = path.join(sandbox.dir, "f2.ts");
    fs.writeFileSync(f1, "export const a = 1;");
    fs.writeFileSync(f2, "export const b = 2;");

    // 1. Single file vs two files (tests targetFiles.length > 1 jscpd branch)
    const resSingle = await runAntiSlop({
      cwd: sandbox.dir,
      files: [f1],
      checks: ["syntax"],
    });
    expect(resSingle.passed).toBe(true);
    expect(resSingle.totalFilesChecked).toBe(1);
    expect(resSingle.durationMs).toBeGreaterThanOrEqual(0);

    const resMultiple = await runAntiSlop({
      cwd: sandbox.dir,
      files: [f1, f2],
      checks: ["base"],
    });
    expect(resMultiple.passed).toBe(true);
    expect(resMultiple.totalFilesChecked).toBe(2);

    // 2. Empty checks array (defaults to runBaseChecks = true)
    const resEmptyChecks = await runAntiSlop({
      cwd: sandbox.dir,
      files: [f1],
      checks: [],
    });
    expect(resEmptyChecks.passed).toBe(true);

    // 3. lint filter
    const resLint = await runAntiSlop({
      cwd: sandbox.dir,
      files: [f1],
      checks: ["lint"],
    });
    expect(resLint.passed).toBe(true);

    // 4. CRAP check filter with entry verification
    const resCrap = await runAntiSlop({
      cwd: sandbox.dir,
      files: [f1],
      checks: ["crap"],
      crapThreshold: 50,
    });
    expect(resCrap.crapEntries).toBeDefined();

    // 5. PR size check filter
    const resPr = await runAntiSlop({
      cwd: sandbox.dir,
      files: [f1],
      checks: ["pr-size"],
      since: "HEAD",
    });
    expect(resPr.passed).toBe(true);

    sandbox.cleanup();
  });

  it("yields exactly one finding for an unused variable in full run (#105)", async () => {
    const sandbox = createSandbox("temp-unused-var-runner");

    const filePath = path.join(sandbox.dir, "unused-var.ts");

    fs.writeFileSync(
      filePath,
      `export function compute(): number {
  const unusedValue = 3;

  return 1;
}
`
    );

    const res = await runAntiSlop({
      cwd: sandbox.dir,
      files: [filePath],
    });

    const unusedFindings = res.findings.filter(
      (finding) =>
        finding.line === 2 &&
        (finding.rule === "no-unused-locals" ||
          finding.rule === "@typescript-eslint/no-unused-vars")
    );

    expect(unusedFindings).toHaveLength(1);

    expect(unusedFindings.at(0)?.rule).toBe("no-unused-locals");

    sandbox.cleanup();
  });
});
