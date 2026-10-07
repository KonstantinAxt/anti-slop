import * as path from "node:path";
import * as ts from "typescript";

/**
 * Parse source code into a TypeScript AST SourceFile representation.
 *
 * @param filePath Path of the source file.
 * @param code Raw source code text.
 * @returns Parsed TypeScript SourceFile node.
 */
export function createSourceFile(filePath: string, code: string): ts.SourceFile {
  const isJsx = filePath.endsWith(".tsx") || filePath.endsWith(".jsx");

  return ts.createSourceFile(
    filePath,
    code,
    ts.ScriptTarget.Latest,
    true,
    isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/**
 * Load and parse tsconfig command line configuration.
 *
 * @param cwd Current working directory.
 * @param tsconfigPath Optional explicit path to tsconfig.json.
 * @returns Parsed command line options or undefined when missing.
 */
export function loadParsedCommandLine(
  cwd: string,
  tsconfigPath?: string
): ts.ParsedCommandLine | undefined {
  const resolvedPath =
    tsconfigPath || ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");

  if (!resolvedPath || !ts.sys.fileExists(resolvedPath)) {
    return undefined;
  }

  const configFile = ts.readConfigFile(resolvedPath, ts.sys.readFile);
  if (configFile.error || !configFile.config) {
    return undefined;
  }

  return ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(resolvedPath)
  );
}

function getStaticImportOrExportSpecifier(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }

  if (
    ts.isExportDeclaration(node) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }

  return undefined;
}

function getDynamicImportSpecifier(node: ts.Node): string | undefined {
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length > 0
  ) {
    const firstArg = node.arguments[0];
    if (firstArg && ts.isStringLiteral(firstArg)) {
      return firstArg.text;
    }
  }

  return undefined;
}

/**
 * Extract module specifier string from an import declaration, export declaration, or dynamic import call expression.
 *
 * @param node TypeScript AST node to inspect.
 * @returns Specifier text or undefined when not an import/export with string literal specifier.
 */
export function getImportOrExportSpecifier(node: ts.Node): string | undefined {
  return getStaticImportOrExportSpecifier(node) ?? getDynamicImportSpecifier(node);
}
