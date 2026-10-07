import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import type { Finding } from "../types.js";
import { createSourceFile } from "./ast.js";
const MIN_MOCK_ARGUMENTS = 2;


export type ExportResolver = (specifier: string, fromFile: string) => string[] | null;
function extractNamedExports(node: ts.ExportDeclaration): string[] {
  if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    return node.exportClause.elements.map((elem) => elem.name.text);
  }

  return [];
}

type NamedDeclaration =
  | ts.FunctionDeclaration
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.EnumDeclaration;

function isNamedDeclaration(node: ts.Node): node is NamedDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  );
}

function extractDeclarationExports(node: ts.Node): string[] {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  const isExported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  if (!isExported) return [];

  if (ts.isVariableStatement(node)) {
    const names: string[] = [];
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        names.push(decl.name.text);
      }
    }

    return names;
  }

  if (isNamedDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
    return [node.name.text];
  }

  return [];
}

function extractModuleExports(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const code = fs.readFileSync(filePath, "utf-8");
  const sourceFile = createSourceFile(filePath, code);
  const exports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isExportDeclaration(node)) {
      exports.push(...extractNamedExports(node));
    } else {
      exports.push(...extractDeclarationExports(node));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return exports;
}

/**
 * Resolve real exported symbols for a relative module specifier.
 *
 * @param specifier Import module specifier.
 * @param fromFile Path of file containing the import.
 * @returns List of exported symbol names or null when unresolvable.
 */
export function defaultFsExportResolver(specifier: string, fromFile: string): string[] | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const dir = path.dirname(fromFile);
  const extensions = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];
  const baseSpecifier = specifier.replace(/\.(js|jsx|mjs|cjs)$/, "");

  for (const ext of extensions) {
    const candidate = path.resolve(dir, baseSpecifier + ext);
    if (fs.existsSync(candidate)) {
      return extractModuleExports(candidate);
    }
  }

  const direct = path.resolve(dir, specifier);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    return extractModuleExports(direct);
  }

  return null;
}

function findObjectLiteralFromBlock(block: ts.Block): ts.ObjectLiteralExpression | null {
  for (const stmt of block.statements) {
    if (ts.isReturnStatement(stmt) && stmt.expression) {
      const expr = ts.isParenthesizedExpression(stmt.expression)
        ? stmt.expression.expression
        : stmt.expression;
      if (ts.isObjectLiteralExpression(expr)) {
        return expr;
      }
    }
  }

  return null;
}

function findObjectLiteral(body: ts.ConciseBody): ts.ObjectLiteralExpression | null {
  if (ts.isParenthesizedExpression(body) && ts.isObjectLiteralExpression(body.expression)) {
    return body.expression;
  }
  if (ts.isObjectLiteralExpression(body)) {
    return body;
  }
  if (ts.isBlock(body)) {
    return findObjectLiteralFromBlock(body);
  }

  return null;
}

function extractMockedKeys(factoryNode: ts.Node): { name: string; node: ts.Node }[] {
  if (!ts.isArrowFunction(factoryNode) && !ts.isFunctionExpression(factoryNode)) {
    return [];
  }

  const objectLiteral = findObjectLiteral(factoryNode.body);
  if (!objectLiteral) {
    return [];
  }

  const keys: { name: string; node: ts.Node }[] = [];
  for (const prop of objectLiteral.properties) {
    if (
      (ts.isPropertyAssignment(prop) ||
        ts.isShorthandPropertyAssignment(prop) ||
        ts.isMethodDeclaration(prop)) &&
      prop.name &&
      ts.isIdentifier(prop.name)
    ) {
      keys.push({ name: prop.name.text, node: prop });
    }
  }

  return keys;
}

function checkMockCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  testFilePath: string,
  resolver: ExportResolver
): Finding[] {
  const expr = node.expression;
  const isMockCall =
    ts.isPropertyAccessExpression(expr) &&
    ["vi", "jest"].includes(expr.expression.getText(sourceFile)) &&
    expr.name.text === "mock";

  if (!isMockCall || node.arguments.length < MIN_MOCK_ARGUMENTS) return [];

  const specifierArg = node.arguments[0];
  const factoryArg = node.arguments[1];
  if (!specifierArg || !factoryArg || !ts.isStringLiteral(specifierArg)) return [];

  const specifier = specifierArg.text;
  const realExports = resolver(specifier, testFilePath);
  if (!realExports || realExports.length === 0) return [];

  const realExportSet = new Set(realExports);
  const mockedKeys = extractMockedKeys(factoryArg);
  const findings: Finding[] = [];

  for (const mocked of mockedKeys) {
    if (!realExportSet.has(mocked.name)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(mocked.node.getStart());
      findings.push({
        check: "stale-mocks",
        rule: "stale-mock-export",
        severity: "error",
        message: `Stale mock key '${mocked.name}' is not exported by '${specifier}'.`,
        file: testFilePath,
        line: line + 1,
        column: character + 1,
        excerpt: mocked.node.getText(sourceFile),
        why: `Contract drift: A mock factory defines keys that are not exported by the real module. Real exports: [${realExports.join(", ")}].`,
        suggestion: `Remove '${mocked.name}' from the mock factory or update the mock to match real module exports.`,
      });
    }
  }

  return findings;
}

/**
 * Verify that mocked modules match the real exported interface.
 *
 * @param testFilePath Path of test file containing mocks.
 * @param testCode Source code of test file.
 * @param resolver Export resolver strategy.
 * @returns Array of stale mock findings.
 */
export function checkStaleMocks(
  testFilePath: string,
  testCode: string,
  resolver: ExportResolver = defaultFsExportResolver,
  parsedSourceFile?: ts.SourceFile
): Finding[] {
  const findings: Finding[] = [];
  const sourceFile = parsedSourceFile ?? createSourceFile(testFilePath, testCode);

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      findings.push(...checkMockCall(node, sourceFile, testFilePath, resolver));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return findings;
}
