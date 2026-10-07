import * as ts from "typescript";
import type { Finding } from "../types.js";
import { createSourceFile, getImportOrExportSpecifier } from "./ast.js";

const TEST_FILE_PATTERN = /\.(test|spec|stories)\.[jt]sx?$|__(tests|mocks|fixtures)__|\.storybook\/|\.config\.[jt]s$|setup\.[jt]s$/;
const SERVICE_LAYER_PATTERN = /(?:^|\/)(services|stores|models|lib)\/|\.(?:service|store)\.[jt]sx?$/;
const UTILS_LAYER_PATTERN = /(?:^|\/)(utils|config)\//;
const UI_IMPORT_PATTERN = /(?:^|\/)(components|pages|views|hooks)\/|use[A-Z]\w+/;
const MOCK_IMPORT_PATTERN = /__(mocks|fixtures)__|\.mock(?:$|\/)|^(?:msw|@faker-js\/|vitest|@testing-library)/;
const DOMAIN_IMPORT_PATTERN = /(?:^|\/)(services|stores|models)\//;

/**
 * Verify architectural layer boundaries and mock leakages.
 *
 * @param filePath Path of source file.
 * @param code Source code contents.
 * @returns Array of architectural boundary findings.
 */
export function checkBoundaries(
  filePath: string,
  code: string,
  parsedSourceFile?: ts.SourceFile
): Finding[] {
  const findings: Finding[] = [];
  const isTestFile = TEST_FILE_PATTERN.test(filePath);
  const isServiceLayer = SERVICE_LAYER_PATTERN.test(filePath);
  const isUtilsLayer = UTILS_LAYER_PATTERN.test(filePath);

  const sourceFile = parsedSourceFile ?? createSourceFile(filePath, code);

  function checkImport(moduleSpecifier: string, node: ts.Node): void {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    // Rule 1: Services/stores must not import UI components or hooks
    if (isServiceLayer && UI_IMPORT_PATTERN.test(moduleSpecifier)) {
      findings.push({
        check: "boundaries",
        rule: "ui-free-service",
        severity: "error",
        message: `Business layer (${filePath}) imports UI component or hook from '${moduleSpecifier}'.`,
        file: filePath,
        line: line + 1,
        column: character + 1,
        excerpt: node.getText(sourceFile),
        why: "Architecture invariant: Business layers stay UI-free. A service, store, lib or type file must not import components, pages or hooks. Shared types belong in src/types or next to the service.",
        suggestion: "Extract shared types or business logic so UI depends on services, not vice versa.",
      });
    }

    // Rule 2: Mocks must not leak into production builds
    if (!isTestFile && MOCK_IMPORT_PATTERN.test(moduleSpecifier)) {
      findings.push({
        check: "boundaries",
        rule: "mock-leak",
        severity: "error",
        message: `Production file (${filePath}) imports mock or test dependency '${moduleSpecifier}'.`,
        file: filePath,
        line: line + 1,
        column: character + 1,
        excerpt: node.getText(sourceFile),
        why: "Architecture invariant: Test mocks and fixtures must stay out of production builds.",
        suggestion: "Move mock data into test files or separate development fixtures.",
      });
    }

    // Rule 3: Utilities and configs must not import domain layers
    if (isUtilsLayer && DOMAIN_IMPORT_PATTERN.test(moduleSpecifier)) {
      findings.push({
        check: "boundaries",
        rule: "isolated-utils",
        severity: "error",
        message: `Utility or config file (${filePath}) imports domain service or store from '${moduleSpecifier}'.`,
        file: filePath,
        line: line + 1,
        column: character + 1,
        excerpt: node.getText(sourceFile),
        why: "Architecture invariant: Utilities, types, and configuration stay free of domain logic.",
        suggestion: "Move business logic into the service layer, keeping utilities pure and generic.",
      });
    }
  }

  function visit(node: ts.Node): void {
    const specifier = getImportOrExportSpecifier(node);
    if (specifier !== undefined) {
      checkImport(specifier, node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return findings;
}
