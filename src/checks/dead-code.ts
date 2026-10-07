import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import type { Finding } from "../types.js";
import { loadParsedCommandLine } from "./ast.js";

const TEST_FILE_PATTERN =
  /\.(test|spec|cy|stories|story)\.([cm]?[jt]sx?)$|__(tests|mocks|fixtures|snapshots)__|[\\/]cypress[\\/]|\.storybook\/|\.config\.[cm]?[jt]s$|setup\.[jt]s$/;

export interface DeadCodeOptions {
  cwd?: string;
  tsconfigPath?: string;
  host?: ts.CompilerHost;
  entryFiles?: string[];
  projectFiles?: string[];
}

interface DeadCodeContext {
  cwd: string;
  entryFiles: Set<string>;
  importedFiles: Set<string>;
  program: ts.Program;
  checker: ts.TypeChecker;
  languageService: ts.LanguageService;
  customHost?: ts.CompilerHost | undefined;
}

export function isJsonObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function addEntryCandidate(entries: Set<string>, cwd: string, rawPath: unknown): void {
  if (typeof rawPath !== "string") return;
  const abs = path.resolve(cwd, rawPath);
  entries.add(abs);
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
    entries.add(abs.replace(/\.[^/.]+$/, "") + ext);
  }
}

function parseExportsField(entries: Set<string>, cwd: string, exportsField: unknown): void {
  if (typeof exportsField === "string") {
    addEntryCandidate(entries, cwd, exportsField);

    return;
  }
  if (isJsonObject(exportsField)) {
    for (const val of Object.values(exportsField)) {
      parseExportsField(entries, cwd, val);
    }
  }
}

function parsePackageBin(entries: Set<string>, cwd: string, bin: unknown): void {
  if (typeof bin === "string") {
    addEntryCandidate(entries, cwd, bin);
  } else if (isJsonObject(bin)) {
    for (const val of Object.values(bin)) {
      addEntryCandidate(entries, cwd, val);
    }
  }
}

function parsePackageScripts(entries: Set<string>, cwd: string, scripts: unknown): void {
  if (!isJsonObject(scripts)) return;
  for (const cmd of Object.values(scripts)) {
    if (typeof cmd !== "string") continue;
    for (const token of cmd.split(/\s+/)) {
      if (token.endsWith(".ts") || token.endsWith(".tsx") || token.endsWith(".js") || token.endsWith(".mjs")) {
        addEntryCandidate(entries, cwd, token);
      }
    }
  }
}

function isExecutableScript(filePath: string): boolean {
  try {
    if (!fs.statSync(filePath).isFile()) return false;

    const content = fs.readFileSync(filePath, "utf-8");

    return content.startsWith("#!") || content.includes("import.meta.main");
  } catch (statErr: unknown) {
    void statErr;

    return false;
  }
}

function scanExecutableScripts(entries: Set<string>, cwd: string): void {
  const scriptsDir = path.join(cwd, "scripts");
  if (!fs.existsSync(scriptsDir)) return;
  try {
    for (const entry of fs.readdirSync(scriptsDir)) {
      const fullPath = path.join(scriptsDir, entry);
      if (isExecutableScript(fullPath)) {
        addEntryCandidate(entries, cwd, path.join("scripts", entry));
      }
    }
  } catch (readDirErr: unknown) {
    void readDirErr;
  }
}

function resolvePackageEntryFiles(cwd: string): Set<string> {
  const entries = new Set<string>();
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const rawContent = fs.readFileSync(pkgPath, "utf-8");
      const pkg: unknown = JSON.parse(rawContent);
      if (isJsonObject(pkg)) {
        addEntryCandidate(entries, cwd, pkg.main);
        addEntryCandidate(entries, cwd, pkg.module);
        addEntryCandidate(entries, cwd, pkg.browser);
        parsePackageBin(entries, cwd, pkg.bin);
        parseExportsField(entries, cwd, pkg.exports);
        parsePackageScripts(entries, cwd, pkg.scripts);
      }
    } catch (err: unknown) {
      void err;
    }
  }

  for (const indexFile of ["src/index.ts", "src/index.tsx", "src/index.js", "src/main.ts"]) {
    const abs = path.resolve(cwd, indexFile);
    if (fs.existsSync(abs)) entries.add(abs);
  }

  scanExecutableScripts(entries, cwd);

  return entries;
}

function scanSourceFileImports(
  sf: ts.SourceFile,
  compilerOptions: ts.CompilerOptions,
  host: ts.CompilerHost | ts.System,
  targetPaths: Set<string>
): void {
  ts.forEachChild(sf, (node) => {
    const isImport = ts.isImportDeclaration(node);
    const isExport = ts.isExportDeclaration(node) && Boolean(node.moduleSpecifier);
    if ((isImport || isExport) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const resolved = ts.resolveModuleName(
        node.moduleSpecifier.text,
        sf.fileName,
        compilerOptions,
        host
      );
      if (resolved.resolvedModule?.resolvedFileName) {
        targetPaths.add(path.resolve(resolved.resolvedModule.resolvedFileName));
      }
    }
  });
}

function collectImportedFiles(
  program: ts.Program,
  compilerOptions: ts.CompilerOptions,
  customHost?: ts.CompilerHost,
  entryFiles?: Set<string>
): Set<string> {
  const importedFilePaths = new Set<string>();
  const host = customHost || ts.sys;

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    scanSourceFileImports(sf, compilerOptions, host, importedFilePaths);
  }

  if (entryFiles) {
    for (const entryPath of entryFiles) {
      if (path.extname(entryPath) === "" && fs.existsSync(entryPath)) {
        try {
          const content = fs.readFileSync(entryPath, "utf-8");
          const sf = ts.createSourceFile(
            entryPath,
            content,
            compilerOptions.target ?? ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.JS
          );
          scanSourceFileImports(sf, compilerOptions, host, importedFilePaths);
        } catch (readErr: unknown) {
          void readErr;
        }
      }
    }
  }

  return importedFilePaths;
}

function checkExportReferences(
  sf: ts.SourceFile,
  targetFile: string,
  relPath: string,
  checker: ts.TypeChecker,
  ls: ts.LanguageService
): Finding[] {
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) return [];

  const findings: Finding[] = [];
  const exports = checker.getExportsOfModule(moduleSymbol);

  for (const exp of exports) {
    const isValue = (exp.flags & ts.SymbolFlags.Value) !== 0;
    if (!isValue) continue;

    const decl = exp.declarations?.[0];
    if (!decl) continue;

    const refs = ls.findReferences(sf.fileName, decl.getStart()) || [];
    const externalRefs = refs
      .flatMap((ref) => ref.references)
      .filter((ref) => !ref.isDefinition && path.resolve(ref.fileName) !== targetFile);

    if (externalRefs.length === 0) {
      const { line, character } = sf.getLineAndCharacterOfPosition(decl.getStart());
      findings.push({
        check: "dead-code",
        rule: "unused-export",
        severity: "warning",
        message: `Unused export '${exp.name}' is never imported across the codebase.`,
        file: relPath,
        line: line + 1,
        column: character + 1,
        why: "Dead code prevention: Unused exports accumulate silently unless pruned.",
        suggestion: `Remove '${exp.name}' or export it only if part of a public contract.`,
      });
    }
  }

  return findings;
}

function getInterfaceImplementingClasses(
  interfaceName: string,
  program: ts.Program
): string[] {
  const implementingClasses: string[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;

    ts.forEachChild(sourceFile, (node) => {
      if (!ts.isClassDeclaration(node) || !node.heritageClauses) return;
      for (const clause of node.heritageClauses) {
        if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
        for (const heritageType of clause.types) {
          if (ts.isIdentifier(heritageType.expression) && heritageType.expression.text === interfaceName) {
            implementingClasses.push(node.name?.text ?? "AnonymousClass");
          }
        }
      }
    });
  }

  return implementingClasses;
}

function checkSingleImplInterfacesInFile(
  sf: ts.SourceFile,
  relPath: string,
  program: ts.Program
): Finding[] {
  const findings: Finding[] = [];

  ts.forEachChild(sf, (node) => {
    if (!ts.isInterfaceDeclaration(node)) return;
    const interfaceName = node.name.text;
    if (interfaceName.endsWith("Props") || interfaceName.endsWith("State")) return;

    const implementingClasses = getInterfaceImplementingClasses(interfaceName, program);
    if (implementingClasses.length === 1) {
      const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart());
      findings.push({
        check: "scars",
        rule: "no-single-impl-interface",
        severity: "warning",
        message: `Interface '${interfaceName}' has only one concrete implementation ('${implementingClasses[0]}') across the project.`,
        file: relPath,
        line: line + 1,
        column: character + 1,
        why: "Speculative generality: Declaring interfaces implemented by only a single class adds boilerplate abstraction before a second implementation exists (YAGNI).",
        suggestion: "Remove the interface and use the class directly, or inline the contract.",
      });
    }
  });

  return findings;
}

function checkTargetFile(targetFile: string, context: DeadCodeContext): Finding[] {
  const relPath = path.relative(context.cwd, targetFile);

  if (
    TEST_FILE_PATTERN.test(relPath) ||
    targetFile.endsWith(".d.ts") ||
    context.entryFiles.has(targetFile)
  ) {
    return [];
  }

  if (!context.importedFiles.has(targetFile)) {
    return [{
      check: "dead-code",
      rule: "unused-file",
      severity: "warning",
      message: `Unused file '${relPath}' is never imported or referenced across the codebase.`,
      file: relPath,
      line: 1,
      column: 1,
      why: "Dead code prevention: Unused files accumulate silently unless pruned.",
      suggestion: "Remove this unused file or import it from an entry point.",
    }];
  }

  const sf = context.program.getSourceFile(targetFile);
  if (!sf) return [];

  const exportFindings = checkExportReferences(sf, targetFile, relPath, context.checker, context.languageService);
  const singleImplFindings = checkSingleImplInterfacesInFile(sf, relPath, context.program);

  return [...exportFindings, ...singleImplFindings];
}

function createLanguageService(
  fileNames: string[],
  compilerOptions: ts.CompilerOptions,
  cwd: string,
  customHost?: ts.CompilerHost
): ts.LanguageService | null {
  const lsHost: ts.LanguageServiceHost = {
    getScriptFileNames: () => fileNames,
    getScriptVersion: () => "0",
    getScriptSnapshot: (fileName) => {
      let content: string | undefined;
      if (customHost) {
        content = customHost.readFile(fileName);
      } else if (fs.existsSync(fileName)) {
        content = fs.readFileSync(fileName, "utf-8");
      }

      return content !== undefined ? ts.ScriptSnapshot.fromString(content) : undefined;
    },
    getCurrentDirectory: () => cwd,
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: customHost ? (filePath) => customHost.fileExists(filePath) : ts.sys.fileExists,
    readFile: customHost ? (filePath) => customHost.readFile(filePath) : ts.sys.readFile,
    readDirectory: customHost?.readDirectory ?? ts.sys.readDirectory,
    directoryExists: customHost?.directoryExists ?? ts.sys.directoryExists,
    getDirectories: customHost?.getDirectories ?? ts.sys.getDirectories,
  };

  try {
    return ts.createLanguageService(lsHost, ts.createDocumentRegistry());
  } catch {
    return null;
  }
}

/**
 * Detect unused exports and unreferenced source files in the project.
 *
 * @param targetFiles Target file paths to analyze.
 * @param options Dead code scanner options.
 * @returns Array of dead code findings.
 */
export function checkDeadCode(
  targetFiles: string[],
  options: DeadCodeOptions = {}
): Finding[] {
  const cwd = path.resolve(options.cwd || process.cwd());
  const resolvedTargets = targetFiles.map((target) => path.resolve(cwd, target));
  const parsedConfig = loadParsedCommandLine(cwd, options.tsconfigPath);

  const compilerOptions: ts.CompilerOptions = parsedConfig?.options || {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };

  const allFileNames = Array.from(
    new Set([
      ...(options.projectFiles?.map((file) => path.resolve(cwd, file)) || []),
      ...(parsedConfig?.fileNames || []),
      ...resolvedTargets,
    ])
  );

  const ls = createLanguageService(allFileNames, compilerOptions, cwd, options.host);
  if (!ls) return [];

  const program = ls.getProgram();
  if (!program) return [];

  const resolvedEntries = options.entryFiles
    ? new Set(options.entryFiles.map((entry) => path.resolve(cwd, entry)))
    : resolvePackageEntryFiles(cwd);

  const context: DeadCodeContext = {
    cwd,
    entryFiles: resolvedEntries,
    importedFiles: collectImportedFiles(program, compilerOptions, options.host, resolvedEntries),
    program,
    checker: program.getTypeChecker(),
    languageService: ls,
    customHost: options.host,
  };

  const findings: Finding[] = [];
  for (const targetFile of resolvedTargets) {
    findings.push(...checkTargetFile(targetFile, context));
  }

  return findings;
}
