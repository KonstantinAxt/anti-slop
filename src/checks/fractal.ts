import * as path from "node:path";
import * as ts from "typescript";
import type { Finding } from "../types.js";
import { createSourceFile, getImportOrExportSpecifier } from "./ast.js";

const TEST_FILE_PATTERN =
  /\.(test|spec|stories)\.[jt]sx?$|__(tests|mocks|fixtures)__|\.storybook\/|\.config\.[jt]s$|setup\.[jt]s$/;

// Role suffixes commonly used in Fractal Architecture Framework (FAF) & Domain-Fractal React Architecture (DFRA)
const FRACTAL_ROLE_SUFFIX_PATTERN =
  /\.(component|hook|model|style|util|view|controller|presenter|slice|service|store|type|schema|boundary|recipe|instance|factory)(?:\.[jt]sx?)?$/;

// Common internal subfolders nested inside a Fragment
const FRACTAL_INTERNAL_FOLDER_PATTERN =
  /(?:^|\/)[^/]+\/(?:components|widgets|pages|features|domains|modules|app)\/[^/]+\/(model|hooks|components|internal|utils|views|styles|slices|controllers|presenters|stores|apis|state)\//;

const ALIAS_PREFIX_LENGTH = 2;

interface ImportContext {
  currentFilePath: string;
  normCurrent: string;
  resolvedTarget: string;
  normTarget: string;
  moduleSpecifier: string;
  node: ts.Node;
  sourceFile: ts.SourceFile;
  findings: Finding[];
}

/**
 * Normalizes an import module specifier to a relative project path based on current file location.
 */
function resolveImportPath(currentFilePath: string, moduleSpecifier: string): string | null {
  // Ignore non-relative and standard package imports unless they look like workspace aliases
  if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) {
    const currentDir = path.dirname(currentFilePath);

    return path.normalize(path.join(currentDir, moduleSpecifier)).replaceAll("\\", "/");
  }

  // Handle common project aliases like "@/..." or "~/... " or direct "src/..."
  if (moduleSpecifier.startsWith("@/") || moduleSpecifier.startsWith("~/")) {
    const stripped = moduleSpecifier.slice(ALIAS_PREFIX_LENGTH);

    return path.normalize(path.join("src", stripped)).replaceAll("\\", "/");
  }

  if (moduleSpecifier.startsWith("src/")) {
    return path.normalize(moduleSpecifier).replaceAll("\\", "/");
  }

  return null;
}

/**
 * Checks whether an imported path reaches inside an external Fragment's internal files.
 * In Fractal Architecture, cross-fragment dependencies must go through the Fragment's
 * public access node (e.g. index.ts or the fragment root directory).
 */
function checkDirectFragmentImport(ctx: ImportContext): void {
  // If the import is targeting a barrel or access node, it is valid
  const basename = path.basename(ctx.resolvedTarget);
  const isAccessNode =
    basename === "index" ||
    basename === "index.ts" ||
    basename === "index.tsx" ||
    basename === "index.js" ||
    basename === "index.jsx";

  if (isAccessNode) {
    return;
  }

  // Check if target points to an internal file (has a fractal role suffix or internal subfolder)
  const hasRoleSuffix = FRACTAL_ROLE_SUFFIX_PATTERN.test(ctx.resolvedTarget);
  const hasInternalFolder = FRACTAL_INTERNAL_FOLDER_PATTERN.test(ctx.resolvedTarget);

  if (!hasRoleSuffix && !hasInternalFolder) {
    return;
  }

  // Determine the fragment root of the target
  let fragmentRoot = path.dirname(ctx.resolvedTarget);
  const internalMatch = ctx.resolvedTarget.match(
    /^(.*?\/(?:components|widgets|pages|features|domains|modules|app)\/[^/]+)\/(?:model|hooks|components|internal|utils|views|styles|slices|controllers|presenters|stores|apis|state)\//,
  );
  if (internalMatch && internalMatch[1]) {
    fragmentRoot = internalMatch[1];
  }

  // If the current file is inside the same fragment root, it's an internal sibling reference
  const normCurrentDir = path.dirname(ctx.currentFilePath);
  if (normCurrentDir === fragmentRoot || normCurrentDir.startsWith(fragmentRoot + "/")) {
    return;
  }

  const { line, character } = ctx.sourceFile.getLineAndCharacterOfPosition(ctx.node.getStart());

  ctx.findings.push({
    check: "fractal",
    rule: "no-direct-fragment-import",
    severity: "error",
    message: `External module (${ctx.currentFilePath}) imports internal fragment file '${ctx.moduleSpecifier}'. Cross-fragment imports must consume through the public access node (index).`,
    file: ctx.currentFilePath,
    line: line + 1,
    column: character + 1,
    excerpt: ctx.node.getText(ctx.sourceFile),
    why: "Fractal Architecture Invariant: Access Node Encapsulation. An external module must only interact with a Fragment's public interface, never its internal implementation details.",
    suggestion: `Import through the Fragment's root access node (e.g. '${fragmentRoot}') instead of referencing internal files directly.`,
  });
}

/**
 * Checks for private fractal branch leaks.
 * Private branches (@Scope, __scope) belong exclusively to their owning parent scope.
 */
function checkPrivateBranchLeak(ctx: ImportContext): void {
  const match = ctx.resolvedTarget.match(/^(.*?)\/(@[A-Za-z0-9_.-]+|__[A-Za-z0-9_.-]+)(?:$|\/)/);
  if (!match || !match[1]) {
    return;
  }

  const owningScopeDir = match[1]; // e.g. "src/widgets/desktop-sidebar"
  const branchName = match[2]; // e.g. "@DesktopSidebar"

  // If the importing file is not inside the owning scope directory, it's a private leak!
  if (ctx.normCurrent !== owningScopeDir && !ctx.normCurrent.startsWith(owningScopeDir + "/")) {
    const { line, character } = ctx.sourceFile.getLineAndCharacterOfPosition(ctx.node.getStart());
    ctx.findings.push({
      check: "fractal",
      rule: "no-private-leak",
      severity: "error",
      message: `File (${ctx.currentFilePath}) leaks private fractal branch '${branchName}' from '${ctx.moduleSpecifier}'. Private branches are encapsulated within their parent scope.`,
      file: ctx.currentFilePath,
      line: line + 1,
      column: character + 1,
      excerpt: ctx.node.getText(ctx.sourceFile),
      why: "Fractal Architecture Invariant: Private Branch Encapsulation. Private fractal branches (@Scope, __scope) exist solely to decompose a parent component and must not leak outside their owning scope.",
      suggestion: `Promote shared functionality to an ancestor shared branch (e.g. __shared) or import through the parent component's public interface.`,
    });
  }
}

/**
 * Checks for upward dependencies where a nested sub-component imports its parent or ancestor component.
 */
function checkUpwardDependency(ctx: ImportContext): void {
  const match = ctx.normCurrent.match(/^(.*?)\/(@[A-Za-z0-9_.-]+|__[A-Za-z0-9_.-]+)\//);
  if (!match || !match[1] || !match[2]) {
    return;
  }

  const owningScopeDir = match[1]; // e.g. "src/widgets/desktop-sidebar"
  const branchName = match[2];

  const targetMatchesOwningScope =
    ctx.normTarget === owningScopeDir ||
    (ctx.normTarget.startsWith(owningScopeDir + "/") && !ctx.normTarget.includes(branchName));

  if (targetMatchesOwningScope) {
    const { line, character } = ctx.sourceFile.getLineAndCharacterOfPosition(ctx.node.getStart());
    ctx.findings.push({
      check: "fractal",
      rule: "no-upward-dependency",
      severity: "error",
      message: `Sub-component (${ctx.currentFilePath}) imports ancestor component '${ctx.moduleSpecifier}'. Dependencies in fractal architecture must flow downward.`,
      file: ctx.currentFilePath,
      line: line + 1,
      column: character + 1,
      excerpt: ctx.node.getText(ctx.sourceFile),
      why: "Fractal Architecture Invariant: Unidirectional Dependency Flow. Higher-level components compose lower-level sub-components. Sub-components must not import their parent containers.",
      suggestion: "Pass required data down via props, context, or hoist common state to a shared model/store.",
    });
  }
}

/**
 * Checks for lateral peer dependency between sibling sub-components within a private branch.
 */
function checkPeerIsolation(ctx: ImportContext): void {
  const branchRegex = /^(.*?\/(@[A-Za-z0-9_.-]+|__[A-Za-z0-9_.-]+))\//;
  const currentBranchMatch = ctx.normCurrent.match(branchRegex);
  const targetBranchMatch = ctx.normTarget.match(branchRegex);

  if (
    currentBranchMatch &&
    targetBranchMatch &&
    currentBranchMatch[1] === targetBranchMatch[1]
  ) {
    const branchPrefix = currentBranchMatch[1] + "/";
    const currentSub = ctx.normCurrent.slice(branchPrefix.length).split("/")[0];
    const targetSub = ctx.normTarget.slice(branchPrefix.length).split("/")[0];

    // If both reside in subfolders of the branch and they are different peers
    if (currentSub && targetSub && currentSub !== targetSub) {
      const { line, character } = ctx.sourceFile.getLineAndCharacterOfPosition(ctx.node.getStart());
      ctx.findings.push({
        check: "fractal",
        rule: "peer-isolation",
        severity: "error",
        message: `Peer sub-component (${ctx.currentFilePath}) directly imports sibling peer '${ctx.moduleSpecifier}'. Sibling sub-components must remain isolated.`,
        file: ctx.currentFilePath,
        line: line + 1,
        column: character + 1,
        excerpt: ctx.node.getText(ctx.sourceFile),
        why: "Fractal Architecture Invariant: Law of Separation Between Peers. Sibling modules at the same fractal hierarchy level must not form lateral coupling.",
        suggestion: `Extract shared logic into a shared module under '__shared' or pass it through the parent component.`,
      });
    }
  }
}

/**
 * Verify Fractal Architecture invariants (FAF & DFRA) across source files.
 *
 * @param filePath Path of source file.
 * @param code Source code contents.
 * @returns Array of fractal architecture findings.
 */
export function checkFractalArchitecture(
  filePath: string,
  code: string,
  parsedSourceFile?: ts.SourceFile
): Finding[] {
  // Tests are exempt from architectural boundary checks when testing internals
  if (TEST_FILE_PATTERN.test(filePath)) {
    return [];
  }

  const findings: Finding[] = [];
  const sourceFile = parsedSourceFile ?? createSourceFile(filePath, code);

  function inspectImport(moduleSpecifier: string, node: ts.Node): void {
    const resolvedTarget = resolveImportPath(filePath, moduleSpecifier);
    if (!resolvedTarget) {
      return;
    }

    const ctx: ImportContext = {
      currentFilePath: filePath,
      normCurrent: filePath.replaceAll("\\", "/"),
      resolvedTarget,
      normTarget: resolvedTarget.replaceAll("\\", "/"),
      moduleSpecifier,
      node,
      sourceFile,
      findings,
    };

    checkDirectFragmentImport(ctx);
    checkPrivateBranchLeak(ctx);
    checkUpwardDependency(ctx);
    checkPeerIsolation(ctx);
  }

  function visit(node: ts.Node): void {
    const specifier = getImportOrExportSpecifier(node);
    if (specifier !== undefined) {
      inspectImport(specifier, node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return findings;
}
