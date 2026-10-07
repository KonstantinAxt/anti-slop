import * as ts from "typescript";
import type { Finding } from "../types.js";
import { createSourceFile } from "./ast.js";

const SERVICE_LAYER_PATTERN = /(?:^|\/)(services|stores|models|calculators|computations)\/|\.(?:service|store|calc)\.[jt]sx?$/;
const EXCERPT_PREVIEW_LIMIT = 80;

function getReturnedObjectProperties(node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression): ts.ObjectLiteralElementLike[] | null {
  if (ts.isArrowFunction(node)) {
    if (ts.isObjectLiteralExpression(node.body)) {
      return Array.from(node.body.properties);
    }
    if (ts.isParenthesizedExpression(node.body) && ts.isObjectLiteralExpression(node.body.expression)) {
      return Array.from(node.body.expression.properties);
    }
  }

  if (node.body && ts.isBlock(node.body)) {
    const statements = node.body.statements;
    if (statements.length === 1) {
      const statement = statements[0];
      if (statement && ts.isReturnStatement(statement) && statement.expression && ts.isObjectLiteralExpression(statement.expression)) {
        return Array.from(statement.expression.properties);
      }
    }
  }

  return null;
}

function isPropertyForwardingParameter(property: ts.ObjectLiteralElementLike, paramNames: Set<string>): boolean {
  if (ts.isShorthandPropertyAssignment(property)) {
    return paramNames.has(property.name.text);
  }

  if (ts.isPropertyAssignment(property)) {
    return ts.isIdentifier(property.initializer) && paramNames.has(property.initializer.text);
  }

  return false;
}

function isTrivialObjectWrapper(node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression): boolean {
  const properties = getReturnedObjectProperties(node);
  if (!properties || properties.length === 0) return false;

  const paramNames = new Set<string>();
  for (const param of node.parameters) {
    if (ts.isIdentifier(param.name)) {
      paramNames.add(param.name.text);
    }
  }

  if (paramNames.size === 0) return false;

  return properties.every((property) => isPropertyForwardingParameter(property, paramNames));
}

function checkServiceRounding(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): Finding | null {
  if (!ts.isCallExpression(node)) return null;
  const expr = node.expression;
  let matchedRoundingMethod: string | null = null;

  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "Math" &&
    expr.name.text === "round"
  ) {
    matchedRoundingMethod = "Math.round";
  } else if (
    ts.isPropertyAccessExpression(expr) &&
    expr.name.text === "toFixed"
  ) {
    matchedRoundingMethod = "toFixed";
  }

  if (!matchedRoundingMethod) return null;

  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

  return {
    check: "scars",
    rule: "no-service-rounding",
    severity: "error",
    message: `${matchedRoundingMethod}() called inside service/computation file.`,
    file: filePath,
    line: line + 1,
    column: character + 1,
    excerpt: node.getText(sourceFile),
    why: "Precision invariant: Services compute, formatters round. Rounding twice moves values off true precision. Keep unrounded raw precision in business layers and format only at UI boundary.",
    suggestion: "Return the unrounded numeric value and perform rounding only in the presentation/formatting layer.",
  };
}

function checkTrivialWrapper(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): Finding | null {
  let funcNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null = null;
  let identifierName = "anonymous";

  if (ts.isFunctionDeclaration(node) && node.name) {
    funcNode = node;
    identifierName = node.name.text;
  } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
      funcNode = node.initializer;
      identifierName = node.name.text;
    }
  }

  if (!funcNode || !isTrivialObjectWrapper(funcNode)) return null;

  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

  return {
    check: "scars",
    rule: "no-trivial-object-wrapper",
    severity: "warning",
    message: `Trivial wrapper function '${identifierName}' merely packs parameters into an object literal without logic.`,
    file: filePath,
    line: line + 1,
    column: character + 1,
    excerpt: node.getText(sourceFile),
    why: "Unnecessary indirection: Extracting functions that solely forward parameters into an object without computation or branching adds cognitive overhead and circumvents linter intent.",
    suggestion: "Pass the object directly or use useMemo at the consumer call site instead of creating a passthrough wrapper.",
  };
}

function isEnclosedInPromiseCombinator(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let parent = node.parent;
  while (parent) {
    if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)) {
      const target = parent.expression.expression.getText(sourceFile);
      const method = parent.expression.name.text;
      if (target === "Promise" && (method === "all" || method === "allSettled" || method === "race" || method === "any")) {
        return true;
      }
    }
    parent = parent.parent;
  }

  return false;
}

function checkAsyncArrayCallback(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): Finding | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return null;
  }

  const method = node.expression.name.text;
  const checkedMethods = new Set(["forEach", "filter", "reduce", "reduceRight", "map"]);
  if (!checkedMethods.has(method)) {
    return null;
  }

  const firstArg = node.arguments[0];
  if (!firstArg || (!ts.isArrowFunction(firstArg) && !ts.isFunctionExpression(firstArg))) {
    return null;
  }

  const isAsync = firstArg.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  if (!isAsync) {
    return null;
  }

  // Promise.all(items.map(async ...)) or Promise.allSettled(...) is intentional and standard
  if (method === "map" && isEnclosedInPromiseCombinator(node, sourceFile)) {
    return null;
  }

  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

  if (method === "forEach") {
    return {
      check: "scars",
      rule: "no-async-array-callback",
      severity: "error",
      message: "Array.prototype.forEach with an async callback is not awaited and drops errors.",
      file: filePath,
      line: line + 1,
      column: character + 1,
      excerpt: node.getText(sourceFile).slice(0, EXCERPT_PREVIEW_LIMIT),
      why: "Array.prototype.forEach ignores returned promises, running async callbacks concurrently in the background without awaiting completion or catching rejected promises.",
      suggestion: "Use 'for (const item of items) { await ... }' for sequential execution or 'await Promise.all(items.map(...))' for concurrent execution.",
    };
  }

  if (method === "filter") {
    return {
      check: "scars",
      rule: "no-async-array-callback",
      severity: "error",
      message: "Array.prototype.filter with an async callback always evaluates to true.",
      file: filePath,
      line: line + 1,
      column: character + 1,
      excerpt: node.getText(sourceFile).slice(0, EXCERPT_PREVIEW_LIMIT),
      why: "Async functions return a Promise object, which is truthy in JavaScript regardless of whether the resolved boolean is true or false.",
      suggestion: "Map to resolved boolean values with Promise.all and filter based on resolved indices, or use a sequential for-loop.",
    };
  }

  return {
    check: "scars",
    rule: "no-async-array-callback",
    severity: "error",
    message: `Array.prototype.${method} with an unhandled async callback returns an array of Promises without awaiting.`,
    file: filePath,
    line: line + 1,
    column: character + 1,
    excerpt: node.getText(sourceFile).slice(0, EXCERPT_PREVIEW_LIMIT),
    why: "Passing an async function to Array methods produces unresolved Promise objects instead of values, causing silent data flow corruption.",
    suggestion: "Wrap the mapped expression in 'await Promise.all(...)', or iterate explicitly with 'for...of'.",
  };
}
function getCallExpressionFromStatement(statement: ts.Statement): ts.CallExpression | null {
  if ((ts.isReturnStatement(statement) || ts.isExpressionStatement(statement)) && statement.expression && ts.isCallExpression(statement.expression)) {
    return statement.expression;
  }

  return null;
}

function isMethodPassThrough(method: ts.MethodDeclaration, dependencyNames: Set<string>): boolean {
  if (!method.body || method.body.statements.length !== 1) return false;
  const statement = method.body.statements[0];
  if (!statement) return false;

  const callExpr = getCallExpressionFromStatement(statement);
  if (!callExpr) return false;

  const expr = callExpr.expression;
  if (!ts.isPropertyAccessExpression(expr)) return false;

  const subExpr = expr.expression;
  if (ts.isPropertyAccessExpression(subExpr) && subExpr.expression.kind === ts.SyntaxKind.ThisKeyword) {
    return dependencyNames.has(subExpr.name.text);
  }

  return false;
}

function extractClassDependencies(node: ts.ClassDeclaration): { dependencyNames: Set<string>; methods: ts.MethodDeclaration[] } {
  const dependencyNames = new Set<string>();
  const methods: ts.MethodDeclaration[] = [];

  for (const member of node.members) {
    if (ts.isConstructorDeclaration(member)) {
      for (const param of member.parameters) {
        const hasModifier = param.modifiers?.some((modifier) =>
          modifier.kind === ts.SyntaxKind.PrivateKeyword ||
          modifier.kind === ts.SyntaxKind.ProtectedKeyword ||
          modifier.kind === ts.SyntaxKind.PublicKeyword ||
          modifier.kind === ts.SyntaxKind.ReadonlyKeyword
        );
        if (hasModifier && ts.isIdentifier(param.name)) {
          dependencyNames.add(param.name.text);
        }
      }
    } else if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
      dependencyNames.add(member.name.text);
    } else if (ts.isMethodDeclaration(member)) {
      methods.push(member);
    }
  }

  return { dependencyNames, methods };
}

function checkPassThroughClass(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): Finding | null {
  if (!ts.isClassDeclaration(node)) return null;
  const className = node.name ? node.name.text : "AnonymousClass";

  const { dependencyNames, methods } = extractClassDependencies(node);
  if (dependencyNames.size === 0 || methods.length === 0) return null;

  const allPassThrough = methods.every((method) => isMethodPassThrough(method, dependencyNames));
  if (!allPassThrough) return null;

  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

  return {
    check: "scars",
    rule: "no-pass-through-class",
    severity: "warning",
    message: `Class '${className}' is a pass-through middleman that merely delegates all methods to an injected dependency.`,
    file: filePath,
    line: line + 1,
    column: character + 1,
    excerpt: node.getText(sourceFile).slice(0, EXCERPT_PREVIEW_LIMIT),
    why: "Over-engineering / Middle Man smell: Introducing wrapper classes that solely forward calls to an underlying service or client without adding business logic, validation, or transformation creates unnecessary indirection.",
    suggestion: "Use the underlying dependency directly or merge this logic into the calling code.",
  };
}

function getLocalImplementingClasses(sourceFile: ts.SourceFile, interfaceName: string): string[] {
  const implementingClasses: string[] = [];
  ts.forEachChild(sourceFile, (child) => {
    if (!ts.isClassDeclaration(child) || !child.heritageClauses) return;
    for (const clause of child.heritageClauses) {
      if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
      for (const heritageType of clause.types) {
        if (ts.isIdentifier(heritageType.expression) && heritageType.expression.text === interfaceName) {
          implementingClasses.push(child.name?.text ?? "AnonymousClass");
        }
      }
    }
  });

  return implementingClasses;
}

function checkSingleImplInterface(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): Finding | null {
  if (!ts.isInterfaceDeclaration(node)) return null;
  const isExported = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  if (isExported) return null;

  const interfaceName = node.name.text;
  if (interfaceName.endsWith("Props") || interfaceName.endsWith("State")) return null;

  const implementingClasses = getLocalImplementingClasses(sourceFile, interfaceName);
  if (implementingClasses.length !== 1) return null;

  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

  return {
    check: "scars",
    rule: "no-single-impl-interface",
    severity: "warning",
    message: `Interface '${interfaceName}' has only one concrete implementation ('${implementingClasses[0]}') and is not exported.`,
    file: filePath,
    line: line + 1,
    column: character + 1,
    excerpt: node.getText(sourceFile).slice(0, EXCERPT_PREVIEW_LIMIT),
    why: "Speculative generality: Declaring non-exported interfaces implemented by only a single local class adds boilerplate abstraction before a second implementation exists (YAGNI).",
    suggestion: "Remove the interface and use the class directly, or inline the contract.",
  };
}
/**
 * Scan source file for defensive rounding and architectural code scars.
 *
 * @param filePath Source file path.
 * @param code Source code contents.
 * @returns Array of code scar findings.
 */
export function checkScars(
  filePath: string,
  code: string,
  parsedSourceFile?: ts.SourceFile
): Finding[] {
  const findings: Finding[] = [];
  const isServiceLayer = SERVICE_LAYER_PATTERN.test(filePath);

  const sourceFile = parsedSourceFile ?? createSourceFile(filePath, code);

  function visit(node: ts.Node): void {
    if (isServiceLayer) {
      const roundingFinding = checkServiceRounding(node, sourceFile, filePath);
      if (roundingFinding) {
        findings.push(roundingFinding);
      }
    }

    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      findings.push({
        check: "scars",
        rule: "no-empty-catch",
        severity: "error",
        message: "Empty catch block silently swallowing exceptions.",
        file: filePath,
        line: line + 1,
        column: character + 1,
        excerpt: node.getText(sourceFile),
        why: "Silent error suppression is a common AI pattern that masks fatal operational failures.",
        suggestion: "Log the error, rethrow, or handle the specific failure explicitly.",
      });
    }

    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const targetExpr = node.expression;
      const text = targetExpr.getText(sourceFile);
      if (text.includes(".json()") || text.includes("fetch(") || text.includes("axios.get")) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        findings.push({
          check: "scars",
          rule: "no-unvalidated-api-cast",
          severity: "error",
          message: "Unvalidated API response type assertion ('as Type').",
          file: filePath,
          line: line + 1,
          column: character + 1,
          excerpt: node.getText(sourceFile),
          why: "Contract integrity: Unvalidated type assertions allow nonexistent API fields to compile. Use contract-generated clients or runtime schema validation (e.g. Zod).",
          suggestion: "Parse API responses with a Zod schema or use OpenAPI generated client contracts (@hey-api/openapi-ts) instead of unsafe compile-time assertions.",
        });
      }
    }

    const wrapperFinding = checkTrivialWrapper(node, sourceFile, filePath);
    if (wrapperFinding) {
      findings.push(wrapperFinding);
    }
    const asyncArrayFinding = checkAsyncArrayCallback(node, sourceFile, filePath);
    if (asyncArrayFinding) {
      findings.push(asyncArrayFinding);
    }
    const passThroughClassFinding = checkPassThroughClass(node, sourceFile, filePath);
    if (passThroughClassFinding) {
      findings.push(passThroughClassFinding);
    }
    const singleImplFinding = checkSingleImplInterface(node, sourceFile, filePath);
    if (singleImplFinding) {
      findings.push(singleImplFinding);
    }


    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return findings;
}
