import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "bun:test";
import * as ts from "typescript";
import { checkDeadCode, isJsonObject } from "../src/checks/dead-code.js";
import type { Finding } from "../src/types.js";

const DEAD_CODE_CHECK = "dead-code";
const UNUSED_EXPORT_RULE = "unused-export";
const UNUSED_FILE_RULE = "unused-file";
const SCARS_CHECK = "scars";
const SINGLE_IMPL_RULE = "no-single-impl-interface";
const WARNING_SEVERITY = "warning";
const APP_DIR = "/app";
const INDEX_FILE = "/app/index.ts";
const CONTRACT_FILE = "/app/contract.ts";
const MODULE_FILE = "/app/module.ts";
const CONSUMER_FILE = "/app/consumer.ts";
const ORPHAN_FILE = "/app/orphan.ts";
const WHY_UNUSED_EXPORTS = "Dead code prevention: Unused exports accumulate silently unless pruned.";
const WHY_UNUSED_FILES = "Dead code prevention: Unused files accumulate silently unless pruned.";
const WHY_SINGLE_IMPL =
  "Speculative generality: Declaring interfaces implemented by only a single class adds boilerplate abstraction before a second implementation exists (YAGNI).";
const SUGGESTION_SINGLE_IMPL = "Remove the interface and use the class directly, or inline the contract.";
const SUGGESTION_UNUSED_FILE = "Remove this unused file or import it from an entry point.";

function createVirtualCompilerHost(files: Record<string, string>): ts.CompilerHost {
  const defaultHost = ts.createCompilerHost({});

  return {
    ...defaultHost,
    getSourceFile: (fileName, languageVersion, onError) => {
      if (files[fileName] !== undefined) {
        return ts.createSourceFile(fileName, files[fileName], languageVersion);
      }

      return defaultHost.getSourceFile(fileName, languageVersion, onError);
    },
    fileExists: (fileName) => {
      return files[fileName] !== undefined || defaultHost.fileExists(fileName);
    },
    readFile: (fileName) => {
      return files[fileName] ?? defaultHost.readFile(fileName);
    },
    directoryExists: (dirName) => {
      return (
        Object.keys(files).some((k) => k.startsWith(dirName)) ||
        (defaultHost.directoryExists?.(dirName) ?? false)
      );
    },
    readDirectory: (dirName, extensions, excludes, includes, depth) => {
      const matched = Object.keys(files).filter((k) => k.startsWith(dirName));

      return matched.length > 0
        ? matched
        : (defaultHost.readDirectory?.(dirName, extensions, excludes, includes, depth) ?? []);
    },
    getDirectories: (dirName) => {
      const dirs = new Set<string>();
      for (const k of Object.keys(files)) {
        if (k.startsWith(dirName) && k !== dirName) {
          const rel = k.slice(dirName.length).replace(/^\//, "");
          const part = rel.split("/")[0];
          if (part && !part.includes(".")) {
            dirs.add(part);
          }
        }
      }

      return Array.from(dirs);
    },
    getCurrentDirectory: () => APP_DIR,
  };
}

function checkContractDeadCode(files: Record<string, string>): Finding[] {
  const host = createVirtualCompilerHost(files);

  return checkDeadCode([CONTRACT_FILE], {
    cwd: APP_DIR,
    host,
    projectFiles: Object.keys(files),
    entryFiles: [INDEX_FILE],
  });
}
function findSingleImplFinding(files: Record<string, string>): Finding | undefined {
  return checkContractDeadCode(files).find((f) => f.rule === SINGLE_IMPL_RULE);
}

function checkVirtualDeadCode(
  files: Record<string, string>,
  targetFiles = [MODULE_FILE],
  entryFiles = [CONSUMER_FILE]
): Finding[] {
  const host = createVirtualCompilerHost(files);

  return checkDeadCode(targetFiles, {
    cwd: APP_DIR,
    host,
    projectFiles: Object.keys(files),
    entryFiles,
  });
}

function setupPackageFixture(
  tempDir: string,
  pkg: unknown,
  sourceFiles: Record<string, string>
): void {
  fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify(pkg));
  fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
  for (const [relPath, content] of Object.entries(sourceFiles)) {
    fs.writeFileSync(path.join(tempDir, relPath), content);
  }
}


describe("Dead Code Detection (In-Engine)", () => {
  it("flags unused value exports in target files", () => {
    const files = {
      [CONSUMER_FILE]: `
        import { usedHelper } from "./module";
        export function run() {
          return usedHelper();
        }
      `,
      [MODULE_FILE]: `
        export function usedHelper() {
          return 42;
        }
        export function deadHelper() {
          return 0;
        }
      `,
    };

    const host = createVirtualCompilerHost(files);
    const findings = checkDeadCode([MODULE_FILE], {
      cwd: APP_DIR,
      host,
      projectFiles: Object.keys(files),
      entryFiles: [CONSUMER_FILE],
    });

    const deadExport = findings.find((f) => f.rule === UNUSED_EXPORT_RULE);

    expect(deadExport).toEqual({
      check: DEAD_CODE_CHECK,
      rule: UNUSED_EXPORT_RULE,
      severity: WARNING_SEVERITY,
      message: "Unused export 'deadHelper' is never imported across the codebase.",
      file: "module.ts",
      line: 5,
      column: 9,
      why: WHY_UNUSED_EXPORTS,
      suggestion: "Remove 'deadHelper' or export it only if part of a public contract.",
    });

    expect(findings.some((f) => f.message.includes("'usedHelper'"))).toBe(false);
  });

  it("flags unused orphan files in target files", () => {
    const files = {
      [INDEX_FILE]: `
        export const app = "main";
      `,
      [ORPHAN_FILE]: `
        export function forgotten() {
          return true;
        }
      `,
    };

    const host = createVirtualCompilerHost(files);
    const findings = checkDeadCode([ORPHAN_FILE], {
      cwd: APP_DIR,
      host,
      entryFiles: [INDEX_FILE],
    });

    const unusedFileFinding = findings.find((f) => f.rule === UNUSED_FILE_RULE);

    expect(unusedFileFinding).toEqual({
      check: DEAD_CODE_CHECK,
      rule: UNUSED_FILE_RULE,
      severity: WARNING_SEVERITY,
      message: "Unused file 'orphan.ts' is never imported or referenced across the codebase.",
      file: "orphan.ts",
      line: 1,
      column: 1,
      why: WHY_UNUSED_FILES,
      suggestion: SUGGESTION_UNUSED_FILE,
    });
  });

  it("does not flag exports in configured entry files", () => {
    const files = {
      [INDEX_FILE]: `
        export function publicApi() {
          return "v1";
        }
      `,
    };

    const host = createVirtualCompilerHost(files);
    const findings = checkDeadCode([INDEX_FILE], {
      cwd: APP_DIR,
      host,
      entryFiles: [INDEX_FILE],
    });

    expect(findings).toEqual([]);
  });

const EXEMPT_TEST_FIXTURE_PATHS = [
  "/app/feature.test.ts",
  "/app/runner.test.js",
  "/app/helper.spec.ts",
  "/app/other.spec.jsx",
  "/app/button.stories.tsx",
  "/app/card.story.js",
  "/app/__tests__/util.ts",
  "/app/__mocks__/client.ts",
  "/app/__fixtures__/seed.ts",
  "/app/__snapshots__/view.ts",
  "/app/.storybook/main.ts",
  "/app/vite.config.ts",
  "/app/jest.config.js",
  "/app/setup.ts",
  "/app/setup.js",
  "/app/types.d.ts",
];

  it("does not flag test files as unused files or unused exports", () => {
    const files: Record<string, string> = Object.fromEntries(
      EXEMPT_TEST_FIXTURE_PATHS.map((f) => [
        f,
        `
        export const testValue = 1;
        export function testUtil() {
          return "mock";
        }
      `,
      ])
    );

    const host = createVirtualCompilerHost(files);
    const findings = checkDeadCode(EXEMPT_TEST_FIXTURE_PATHS, {
      cwd: APP_DIR,
      host,
    });

    expect(findings).toEqual([]);
  });

  it("scopes checks strictly to target files without checking untouched files", () => {
    const files = {
      "/app/untouched.ts": `
        export function untrackedDeadExport() {
          return "ignored";
        }
      `,
      "/app/changed.ts": `
        export function changedFn() {
          return "ok";
        }
      `,
      [INDEX_FILE]: `
        import { changedFn } from "./changed";
        changedFn();
      `,
    };

    const host = createVirtualCompilerHost(files);
    const findings = checkDeadCode(["/app/changed.ts"], {
      cwd: APP_DIR,
      host,
      projectFiles: Object.keys(files),
      entryFiles: [INDEX_FILE],
    });

    expect(findings.some((f) => f.file.includes("untouched"))).toBe(false);

    expect(findings).toEqual([]);
  });

  it("flags exported interface implemented by only a single class across project files", () => {
    const files = {
      [CONTRACT_FILE]: `
        export interface IUserRepository {
          getUser(id: string): unknown;
        }
      `,
      "/app/repo.ts": `
        import { IUserRepository } from "./contract";
        export class SqlUserRepository implements IUserRepository {
          getUser(id: string): unknown {
            return { id };
          }
        }
      `,
      [INDEX_FILE]: `
        import { SqlUserRepository } from "./repo";
        export const repo = new SqlUserRepository();
      `,
    };

    const singleImplFinding = findSingleImplFinding(files);

    expect(singleImplFinding).toEqual({
      check: SCARS_CHECK,
      rule: SINGLE_IMPL_RULE,
      severity: WARNING_SEVERITY,
      message:
        "Interface 'IUserRepository' has only one concrete implementation ('SqlUserRepository') across the project.",
      file: "contract.ts",
      line: 2,
      column: 9,
      why: WHY_SINGLE_IMPL,
      suggestion: SUGGESTION_SINGLE_IMPL,
    });
  });

  it("permits exported interface implemented by multiple classes across project files", () => {
    const files = {
      [CONTRACT_FILE]: `
        export interface INotifier {
          send(msg: string): void;
        }
      `,
      "/app/email.ts": `
        import { INotifier } from "./contract";
        export class EmailNotifier implements INotifier {
          send(_msg: string): void {}
        }
      `,
      "/app/sms.ts": `
        import { INotifier } from "./contract";
        export class SmsNotifier implements INotifier {
          send(_msg: string): void {}
        }
      `,
      [INDEX_FILE]: `
        import { EmailNotifier } from "./email";
        import { SmsNotifier } from "./sms";
        export const a = new EmailNotifier();
        export const b = new SmsNotifier();
      `,
    };

    const singleImplFinding = findSingleImplFinding(files);

    expect(singleImplFinding).toBeUndefined();
  });

  it("ignores interfaces ending in Props or State even when implemented by a single class", () => {
    const files = {
      [CONTRACT_FILE]: `
        export interface ButtonProps {
          label: string;
        }
        export interface AppState {
          count: number;
        }
      `,
      "/app/impl.ts": `
        import { ButtonProps, AppState } from "./contract";
        export class ButtonView implements ButtonProps {
          label = "hi";
        }
        export class AppStore implements AppState {
          count = 0;
        }
      `,
      [INDEX_FILE]: `
        import { ButtonView, AppStore } from "./impl";
        export const v = [new ButtonView(), new AppStore()];
      `,
    };

    const findings = checkContractDeadCode(files);

    expect(findings).toEqual([]);
  });

  it("records AnonymousClass when interface is implemented by an unnamed class", () => {
    const files = {
      [CONTRACT_FILE]: `
        export interface IRunner {
          run(): void;
        }
      `,
      "/app/anon.ts": `
        import { IRunner } from "./contract";
        export default class implements IRunner {
          run(): void {}
        }
      `,
      [INDEX_FILE]: `
        import AnonRunner from "./anon";
        export const runner = new AnonRunner();
      `,
    };

    const singleImplFinding = findSingleImplFinding(files);

    expect(singleImplFinding).toEqual({
      check: SCARS_CHECK,
      rule: SINGLE_IMPL_RULE,
      severity: WARNING_SEVERITY,
      message:
        "Interface 'IRunner' has only one concrete implementation ('AnonymousClass') across the project.",
      file: "contract.ts",
      line: 2,
      column: 9,
      why: WHY_SINGLE_IMPL,
      suggestion: SUGGESTION_SINGLE_IMPL,
    });
  });

  it("resolves index files, extensions like .tsx/.jsx, and re-export specifiers", () => {
    const files = {
      "/app/consumer.tsx": `
        import { Button } from "./components";
        import { Widget } from "./widget";
        import { reexportedHelper } from "./reexports";
        export function App() {
          return Button + Widget() + reexportedHelper();
        }
      `,
      "/app/components/index.ts": `
        export const Button = "btn";
        export const UnusedButton = "unused";
      `,
      "/app/widget.jsx": `
        export function Widget() {
          return "wid";
        }
      `,
      "/app/reexports.ts": `
        export { reexportedHelper } from "./helper";
      `,
      "/app/helper.ts": `
        export function reexportedHelper() {
          return "help";
        }
      `,
    };

    const host = createVirtualCompilerHost(files);
    const targets = [
      "/app/components/index.ts",
      "/app/widget.jsx",
      "/app/reexports.ts",
      "/app/helper.ts",
    ];

    const findings = checkDeadCode(targets, {
      cwd: APP_DIR,
      host,
      projectFiles: Object.keys(files),
      entryFiles: ["/app/consumer.tsx"],
    });

    expect(findings).toEqual([
      {
        check: DEAD_CODE_CHECK,
        rule: UNUSED_EXPORT_RULE,
        severity: WARNING_SEVERITY,
        message: "Unused export 'UnusedButton' is never imported across the codebase.",
        file: "components/index.ts",
        line: 3,
        column: 22,
        why: WHY_UNUSED_EXPORTS,
        suggestion: "Remove 'UnusedButton' or export it only if part of a public contract.",
      },
    ]);
  });

  it("flags export used only internally in the same target file as unused-export", () => {
    const files = {
      [CONSUMER_FILE]: `
        import { outerFn } from "./module";
        export const res = outerFn();
      `,
      [MODULE_FILE]: `
        export function internalDead() {
          return 100;
        }
        export function outerFn() {
          return internalDead();
        }
      `,
    };

    const findings = checkVirtualDeadCode(files);

    expect(findings).toEqual([
      {
        check: DEAD_CODE_CHECK,
        rule: UNUSED_EXPORT_RULE,
        severity: WARNING_SEVERITY,
        message: "Unused export 'internalDead' is never imported across the codebase.",
        file: "module.ts",
        line: 2,
        column: 9,
        why: WHY_UNUSED_EXPORTS,
        suggestion: "Remove 'internalDead' or export it only if part of a public contract.",
      },
    ]);
  });

  it("handles non-value exports and diverse export declarations", () => {
    const files = {
      [CONSUMER_FILE]: `
        import { usedFn, type UsedType } from "./module";
        export const x: UsedType = usedFn();
      `,
      [MODULE_FILE]: `
        export type UsedType = number;
        export type UnusedType = string;
        export interface UnusedInterface {
          name: string;
        }
        export function usedFn() {
          return 42;
        }
        export class DeadClass {
          run() {}
        }
        export default function deadDefault() {
          return false;
        }
      `,
    };

    const host = createVirtualCompilerHost(files);
    const findings = checkDeadCode([MODULE_FILE], {
      cwd: APP_DIR,
      host,
      projectFiles: Object.keys(files),
      entryFiles: [CONSUMER_FILE],
    });

    const deadExportNames = findings
      .filter((f) => f.rule === UNUSED_EXPORT_RULE)
      .map((f) => f.message);

    expect(deadExportNames.some((m) => m.includes("'default'"))).toBe(true);

    expect(deadExportNames.some((m) => m.includes("'DeadClass'"))).toBe(true);

    expect(deadExportNames.some((m) => m.includes("'UsedType'"))).toBe(false);

    expect(deadExportNames.some((m) => m.includes("'UnusedType'"))).toBe(false);

    expect(deadExportNames.some((m) => m.includes("'UnusedInterface'"))).toBe(false);

    expect(deadExportNames.some((m) => m.includes("'usedFn'"))).toBe(false);
  });

  it("supports aliased export imported in consumer without false positives", () => {
    const files = {
      [CONSUMER_FILE]: `
        import { usedHelper as aliasedHelper } from "./module";
        export const x = aliasedHelper();
      `,
      [MODULE_FILE]: `
        export function usedHelper() {
          return 1;
        }
        export function deadHelper() {
          return 2;
        }
      `,
    };

    const findings = checkVirtualDeadCode(files);

    expect(findings).toEqual([
      {
        check: DEAD_CODE_CHECK,
        rule: UNUSED_EXPORT_RULE,
        severity: WARNING_SEVERITY,
        message: "Unused export 'deadHelper' is never imported across the codebase.",
        file: "module.ts",
        line: 5,
        column: 9,
        why: WHY_UNUSED_EXPORTS,
        suggestion: "Remove 'deadHelper' or export it only if part of a public contract.",
      },
    ]);
  });

  it("resolves package entry files and conventional index files when entryFiles option is omitted", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-code-entry-"));

    try {
      const pkg = {
        main: "./dist/index.js",
        module: "./dist/index.mjs",
        browser: "./dist/index.browser.js",
        bin: {
          cli: "./bin/cli.js",
        },
        exports: {
          ".": "./src/main.ts",
          "./feature": "./src/feature.tsx",
          "./nested": {
            import: "./src/nested.js",
          },
        },
      };

      setupPackageFixture(tempDir, pkg, {
        "src/main.ts": "export const mainApp = 1;\n",
        "src/index.ts": "export const indexVal = 2;\n",
      });
      const targetMain = path.join(tempDir, "src/main.ts");
      const targetIndex = path.join(tempDir, "src/index.ts");
      const findings = checkDeadCode([targetMain, targetIndex], {
        cwd: tempDir,
      });

      expect(findings).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles string pkg.bin and string pkg.exports when resolving package entry files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-code-str-"));

    try {
      const pkg = {
        bin: "./bin/tool.js",
        exports: "./src/entry.ts",
      };

      setupPackageFixture(tempDir, pkg, {
        "src/entry.ts": "export const entryVal = 'ok';\n",
      });
      const targetEntry = path.join(tempDir, "src/entry.ts");
      const findings = checkDeadCode([targetEntry], {
        cwd: tempDir,
      });

      expect(findings).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles missing or invalid package.json gracefully when resolving package entry files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-code-nopkg-"));

    try {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{ invalid json ");
      fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "src/orphan.ts"), "export const orphan = 1;\n");

      const targetOrphan = path.join(tempDir, "src/orphan.ts");
      const findings = checkDeadCode([targetOrphan], {
        cwd: tempDir,
      });

      expect(findings.length).toBe(1);

      expect(findings[0]?.rule).toBe(UNUSED_FILE_RULE);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("distinguishes executable scripts, unreferenced helpers, and imported helpers' unused exports", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-code-scripts-"));
    try {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test-pkg" }));
      fs.mkdirSync(path.join(tempDir, "scripts"), { recursive: true });

      // 1. Executable entry with import.meta.main
      const entryScript = path.join(tempDir, "scripts/run-task.ts");
      fs.writeFileSync(
        entryScript,
        'import { usedHelper } from "./helper.ts";\nif (import.meta.main) { usedHelper(); }\n'
      );

      // 2. Imported helper with an unused export
      const helperScript = path.join(tempDir, "scripts/helper.ts");
      fs.writeFileSync(
        helperScript,
        "export function usedHelper() { return 1; }\nexport function unusedHelper() { return 2; }\n"
      );

      // 3. Unreferenced helper
      const orphanScript = path.join(tempDir, "scripts/orphan.ts");
      fs.writeFileSync(orphanScript, "export function neverCalled() { return 0; }\n");

      const allTargets = [entryScript, helperScript, orphanScript];
      const findings = checkDeadCode(allTargets, {
        cwd: tempDir,
        projectFiles: allTargets,
      });

      // Genuine entry script is not reported unused
      const entryUnused = findings.find((f) => f.file === "scripts/run-task.ts" && f.rule === UNUSED_FILE_RULE);

      expect(entryUnused).toBeUndefined();

      // Unreferenced helper is reported as unused-file
      const orphanFinding = findings.find((f) => f.file === "scripts/orphan.ts" && f.rule === UNUSED_FILE_RULE);

      expect(orphanFinding?.rule).toBe(UNUSED_FILE_RULE);

      // Imported helper's unused export is reported as unused-export
      const unusedExportFinding = findings.find(
        (f) => f.file === "scripts/helper.ts" && f.rule === UNUSED_EXPORT_RULE
      );

      expect(unusedExportFinding?.rule).toBe(UNUSED_EXPORT_RULE);
      expect(unusedExportFinding?.message).toContain("unusedHelper");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves entry files from package.json scripts and object bin and nested exports", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-code-pkg-entries-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "complex-pkg",
          bin: {
            "my-cli": "src/cli.ts",
          },
          scripts: {
            build: "node scripts/build.ts --production",
            dev: "tsx src/server.tsx",
            start: "node dist/index.js",
            test: "vitest run",
          },
          exports: {
            ".": {
              import: "./src/index.ts",
              require: "./src/index.js",
            },
            "./helpers": "./src/helpers.ts",
          },
        })
      );
      fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "scripts"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "src/cli.ts"), "export const cli = true;\n");
      fs.writeFileSync(path.join(tempDir, "scripts/build.ts"), "export const build = true;\n");
      fs.writeFileSync(path.join(tempDir, "src/server.tsx"), "export const server = true;\n");
      fs.writeFileSync(path.join(tempDir, "src/index.ts"), "export const main = true;\n");
      fs.writeFileSync(path.join(tempDir, "src/helpers.ts"), "export const helpers = true;\n");
      fs.writeFileSync(path.join(tempDir, "src/unreferenced.ts"), "export const unused = true;\n");

      const allTargets = [
        path.join(tempDir, "src/cli.ts"),
        path.join(tempDir, "scripts/build.ts"),
        path.join(tempDir, "src/server.tsx"),
        path.join(tempDir, "src/index.ts"),
        path.join(tempDir, "src/helpers.ts"),
        path.join(tempDir, "src/unreferenced.ts"),
      ];

      const findings = checkDeadCode(allTargets, {
        cwd: tempDir,
        projectFiles: allTargets,
      });

      // Only src/unreferenced.ts should be reported as unused-file
      const unusedFiles = findings.filter((f) => f.rule === UNUSED_FILE_RULE).map((f) => f.file);
      expect(unusedFiles).toEqual(["src/unreferenced.ts"]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects shebang executable script in scripts directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-code-scripts-"));
    try {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "tool-pkg" }));
      const scriptsDir = path.join(tempDir, "scripts");
      fs.mkdirSync(scriptsDir, { recursive: true });
      const toolScript = path.join(scriptsDir, "run-tool.ts");
      fs.writeFileSync(toolScript, "#!/usr/bin/env node\nconsole.log('running');\n");

      const findings = checkDeadCode([toolScript], {
        cwd: tempDir,
        projectFiles: [toolScript],
      });

      const unused = findings.find((f) => f.rule === UNUSED_FILE_RULE);
      expect(unused).toBeUndefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves entry files from pkg.module, pkg.browser, and main/index file variants", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-code-module-browser-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "mod-browser-pkg",
          module: "src/esm-entry.ts",
          browser: "src/browser-entry.ts",
        })
      );
      fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "src/esm-entry.ts"), "export const esm = true;\n");
      fs.writeFileSync(path.join(tempDir, "src/browser-entry.ts"), "export const browser = true;\n");
      fs.writeFileSync(path.join(tempDir, "src/main.ts"), "export const main = true;\n");

      const targets = [
        path.join(tempDir, "src/esm-entry.ts"),
        path.join(tempDir, "src/browser-entry.ts"),
        path.join(tempDir, "src/main.ts"),
      ];

      const findings = checkDeadCode(targets, {
        cwd: tempDir,
        projectFiles: targets,
      });

      const unusedFiles = findings.filter((f) => f.rule === UNUSED_FILE_RULE);
      expect(unusedFiles).toHaveLength(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("validates isJsonObject across objects, arrays, and primitives", () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject({ a: 1 })).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject([1, 2, 3])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject(undefined)).toBe(false);
    expect(isJsonObject("string")).toBe(false);
    expect(isJsonObject(42)).toBe(false);
    expect(isJsonObject(true)).toBe(false);
  });

  it("resolves extensionless binary entry files accurately", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-code-extless-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "extless-pkg", bin: "bin/cli-tool" })
      );
      fs.mkdirSync(path.join(tempDir, "bin"), { recursive: true });
      const cliFile = path.join(tempDir, "bin/cli-tool");
      fs.writeFileSync(cliFile, "#!/usr/bin/env node\nconsole.log(1);\n");

      const findings = checkDeadCode([cliFile], {
        cwd: tempDir,
        projectFiles: [cliFile],
      });

      const unused = findings.find((f) => f.rule === UNUSED_FILE_RULE);
      expect(unused).toBeUndefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves extensionless bin scripts and node --test entry points without flagging imported files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-code-issue68-"));

    try {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "repro-pkg",
          type: "module",
          bin: { r: "bin/r" },
          scripts: { test: "node --test tests/*.test.mjs" },
        })
      );

      fs.mkdirSync(path.join(tempDir, "bin"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "lib"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "tests"), { recursive: true });

      const binFile = path.join(tempDir, "bin/r");
      const libFile = path.join(tempDir, "lib/run.mjs");
      const unusedFile = path.join(tempDir, "lib/unused.mjs");
      const testFile = path.join(tempDir, "tests/run.test.mjs");

      fs.writeFileSync(
        binFile,
        '#!/usr/bin/env node\nimport { run } from "../lib/run.mjs";\nrun();\n'
      );
      fs.writeFileSync(libFile, "export const run = () => 1;\n");
      fs.writeFileSync(unusedFile, "export const unused = () => 2;\n");
      fs.writeFileSync(
        testFile,
        'import test from "node:test";\nimport { run } from "../lib/run.mjs";\ntest("runs", () => run());\n'
      );

      const allTargets = [binFile, libFile, unusedFile, testFile];
      const findings = checkDeadCode(allTargets, {
        cwd: tempDir,
        projectFiles: allTargets,
      });

      const unusedFiles = findings
        .filter((finding) => finding.rule === UNUSED_FILE_RULE)
        .map((finding) => finding.file);

      expect(unusedFiles).toEqual(["lib/unused.mjs"]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
