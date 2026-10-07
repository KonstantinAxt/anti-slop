import * as ts from "typescript";
import type { Finding } from "../types.js";
import { createSourceFile } from "./ast.js";
const CHECK_NAME = "hollow-tests";
const TEST_FILE_PATTERN = /\.(test|spec|cy)\.[jt]sx?$|__(tests|mocks)__|[\\/]cypress[\\/]/;
const MIN_TEST_ARGUMENTS = 2;
const MIN_ARRAY_FIXTURE_ITEMS = 6;
const MIN_OBJECT_FIXTURE_PROPERTIES = 8;
const TEST_CASE_NAMES = ["it", "test"];
const ALL_TEST_NAMES = ["it", "test", "describe"];

function findLocalFunction(name: string, sourceFile: ts.SourceFile): ts.Node | null {
  let found: ts.Node | null = null;
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node;

      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      if (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        found = node.initializer;

        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return found;
}

function tracesToCypressRoot(expr: ts.LeftHandSideExpression): boolean {
  let curr: ts.Node = expr;
  while (true) {
    if (ts.isIdentifier(curr)) {
      return curr.text === "cy" || curr.text === "Cypress";
    }
    if (ts.isCallExpression(curr) || ts.isPropertyAccessExpression(curr)) {
      curr = curr.expression;
    } else {
      return false;
    }
  }
}

function isValidCypressArgument(firstArg: ts.Expression, sourceFile: ts.SourceFile): boolean {
  if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
    return firstArg.text.trim().length > 0;
  }
  if (ts.isArrowFunction(firstArg) || ts.isFunctionExpression(firstArg)) {
    return countAssertionsInNode(firstArg, sourceFile) > 0;
  }
  if (ts.isIdentifier(firstArg)) {
    const localFn = findLocalFunction(firstArg.text, sourceFile);
    if (localFn) {
      return countAssertionsInNode(localFn, sourceFile) > 0;
    }
  }

  return false;
}

function isCypressAssertion(node: ts.CallExpression, sourceFile: ts.SourceFile): boolean {
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) return false;
  if (expr.name.text !== "should" && expr.name.text !== "and") return false;
  if (node.arguments.length === 0) return false;
  if (!tracesToCypressRoot(expr.expression)) return false;

  const firstArg = node.arguments[0];
  if (!firstArg) return false;

  return isValidCypressArgument(firstArg, sourceFile);
}

function countAssertionsInNode(node: ts.Node, sourceFile: ts.SourceFile): number {
  let count = 0;
  function walk(child: ts.Node): void {
    if (ts.isCallExpression(child)) {
      const text = child.expression.getText(sourceFile);
      if (text === "expect" || text.startsWith("expect") || text.startsWith("assert") || isCypressAssertion(child, sourceFile)) {
        count++;
      }
    }
    ts.forEachChild(child, walk);
  }
  walk(node);

  return count;
}

function checkFocusedTest(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding | null {
  const expr = node.expression;
  if (
    ts.isPropertyAccessExpression(expr) &&
    expr.name.text === "only" &&
    ts.isIdentifier(expr.expression) &&
    ["it", "test", "describe"].includes(expr.expression.text)
  ) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    return {
      check: CHECK_NAME,
      rule: "no-focused-test",
      severity: "error",
      message: `Forbidden focused test '${expr.expression.text}.only()' found.`,
      file: filePath,
      line: line + 1,
      column: character + 1,
      excerpt: node.getText(sourceFile).split("\n")[0] ?? "",
      why: "Test hygiene: Forgotten .only turns one test green instead of running the complete suite.",
      suggestion: "Remove .only so the complete test suite runs in review and CI.",
    };
  }

  return null;
}

function checkMissingAssertion(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding | null {
  const expr = node.expression;
  let callback: ts.Node | undefined;

  if (
    ts.isIdentifier(expr) &&
    ["it", "test"].includes(expr.text) &&
    node.arguments.length >= MIN_TEST_ARGUMENTS
  ) {
    callback = node.arguments[1];
  } else if (
    (ts.isCallExpression(expr) || ts.isTaggedTemplateExpression(expr)) &&
    node.arguments.length >= 1
  ) {
    callback = node.arguments.find(
      (arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)
    );
  }

  if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
    const assertionsCount = countAssertionsInNode(callback.body, sourceFile);
    if (assertionsCount === 0) {
      const firstArg = node.arguments[0];
      const argText = firstArg ? firstArg.getText(sourceFile) : "unnamed";
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

      return {
        check: CHECK_NAME,
        rule: "missing-assertion",
        severity: "error",
        message: `Test '${argText}' has zero assertions.`,
        file: filePath,
        line: line + 1,
        column: character + 1,
        excerpt: node.getText(sourceFile).split("\n")[0] ?? "",
        why: "Assertion coverage: A test that merely executes code without asserting behavior gives false confidence.",
        suggestion: "Add meaningful expect(...) assertions that verify state changes or outputs.",
      };
    }
  }

  return null;
}

function checkHollowAssertion(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding | null {
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) return null;

  const methodName = expr.name.text;
  const isNegated =
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === "not";

  if (methodName === "toHaveBeenCalled" && node.arguments.length === 0 && !isNegated) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    return {
      check: CHECK_NAME,
      rule: "hollow-call-assertion",
      severity: "warning",
      message: "Hollow assertion: 'toHaveBeenCalled()' checks call existence without verifying arguments.",
      file: filePath,
      line: line + 1,
      column: character + 1,
      excerpt: node.getText(sourceFile),
      why: "Assertion quality: toHaveBeenCalled() checks call existence without verifying arguments.",
      suggestion: "Use toHaveBeenCalledWith(...) to verify the exact payload passed to the collaborator.",
    };
  }

  if (["toBeDefined", "toBeTruthy"].includes(methodName)) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    return {
      check: CHECK_NAME,
      rule: "hollow-shape-assertion",
      severity: "warning",
      message: `Hollow assertion: '${methodName}()' checks value presence instead of value correctness.`,
      file: filePath,
      line: line + 1,
      column: character + 1,
      excerpt: node.getText(sourceFile),
      why: "Assertion quality: toBeDefined() or toBeTruthy() lets mutated return values survive undetected while keeping tests green.",
      suggestion: "Assert the concrete value (e.g. toEqual(...) or toBe(...)) instead of merely checking existence.",
    };
  }

  return null;
}

function checkTautologicalAssertion(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const { name, expression: targetCall } = call.expression;
  const methodName = name.text;
  if (!["toBe", "toEqual", "toStrictEqual"].includes(methodName)) return null;
  if (!ts.isCallExpression(targetCall)) return null;
  if (!ts.isIdentifier(targetCall.expression) || targetCall.expression.text !== "expect") {
    return null;
  }
  if (targetCall.arguments.length === 0 || call.arguments.length === 0) return null;

  const expectedArg = targetCall.arguments[0];
  const actualArg = call.arguments[0];
  if (!expectedArg || !actualArg) return null;

  const expectedText = expectedArg.getText(sourceFile).trim();
  const actualText = actualArg.getText(sourceFile).trim();

  if (expectedText === actualText) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart());

    return {
      check: CHECK_NAME,
      rule: "tautological-assertion",
      severity: "error",
      message: `Tautological assertion: 'expect(${expectedText}).${methodName}(${actualText})' compares identical expressions.`,
      file: filePath,
      line: line + 1,
      column: character + 1,
      excerpt: call.getText(sourceFile),
      why: "Assertion integrity: Comparing an expression to itself always passes regardless of whether the system under test works.",
      suggestion: "Assert the concrete expected invariant or value instead of comparing identical expressions.",
    };
  }

  return null;
}

function isStringLike(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  );
}

function isArithmeticBinaryExpression(node: ts.Node): node is ts.BinaryExpression {
  if (!ts.isBinaryExpression(node)) return false;

  const op = node.operatorToken.kind;
  if (
    op === ts.SyntaxKind.AsteriskToken ||
    op === ts.SyntaxKind.SlashToken ||
    op === ts.SyntaxKind.PercentToken ||
    op === ts.SyntaxKind.AsteriskAsteriskToken ||
    op === ts.SyntaxKind.MinusToken
  ) {
    return true;
  }

  if (op === ts.SyntaxKind.PlusToken) {
    if (isStringLike(node.left) || isStringLike(node.right)) {
      return false;
    }

    return true;
  }

  return false;
}

function findArithmeticCalculation(node: ts.Node): ts.BinaryExpression | null {
  if (isArithmeticBinaryExpression(node)) {
    return node;
  }

  let found: ts.BinaryExpression | null = null;
  ts.forEachChild(node, (child) => {
    if (!found) {
      found = findArithmeticCalculation(child);
    }
  });

  return found;
}

function getExpectTargetCall(node: ts.CallExpression): ts.CallExpression | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;

  let current: ts.Expression = node.expression.expression;
  while (ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }

  if (ts.isCallExpression(current)) {
    const callee = current.expression;
    if (ts.isIdentifier(callee) && (callee.text === "expect" || callee.text === "assert")) {
      return current;
    }
  }

  return null;
}

function checkAssertionCalculation(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding | null {
  const target = getExpectTargetCall(call);
  if (!target) return null;

  for (const arg of call.arguments) {
    const calc = findArithmeticCalculation(arg);
    if (calc) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(calc.getStart());

      return {
        check: CHECK_NAME,
        rule: "no-assertion-calculation",
        severity: "error",
        message: `Assertion contains inline calculation ('${calc.getText(sourceFile)}').`,
        file: filePath,
        line: line + 1,
        column: character + 1,
        excerpt: call.getText(sourceFile).split("\n")[0] ?? "",
        why: "Test determinism: Inline arithmetic in assertions duplicates implementation logic and can hide incorrect assumptions. Declare explicit expected constants or pre-computed fixtures instead.",
        suggestion: "Replace the inline calculation with a pre-computed constant or explicit expected value.",
      };
    }
  }

  return null;
}

function checkStaticSleep(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding | null {
  const expr = node.expression;

  if (ts.isIdentifier(expr)) {
    if (expr.text === "sleep" || expr.text === "setTimeout") {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

      return {
        check: CHECK_NAME,
        rule: "no-static-sleep",
        severity: "error",
        message: `Anti-pattern: Static sleep/timeout '${expr.text}()' detected in test.`,
        file: filePath,
        line: line + 1,
        column: character + 1,
        excerpt: node.getText(sourceFile).split("\n")[0] ?? "",
        why: "Test flakiness & performance: Static sleeps mask timing bugs and arbitrarily inflate CI runtime.",
        suggestion: "Use framework auto-waiting, event promises, or condition polling instead of static delays.",
      };
    }
  }

  if (ts.isPropertyAccessExpression(expr)) {
    const propName = expr.name.text;
    const isWaitForTimeout = propName === "waitForTimeout";
    const firstArg = node.arguments[0];
    const isCyWaitNumber =
      propName === "wait" &&
      firstArg !== undefined &&
      ts.isNumericLiteral(firstArg);

    if (isWaitForTimeout || isCyWaitNumber) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

      return {
        check: CHECK_NAME,
        rule: "no-static-sleep",
        severity: "error",
        message: `Anti-pattern: Static wait '${expr.getText(sourceFile)}()' detected in test.`,
        file: filePath,
        line: line + 1,
        column: character + 1,
        excerpt: node.getText(sourceFile).split("\n")[0] ?? "",
        why: "Test flakiness & performance: Fixed delays fail on throttled CI runners and slow down test execution.",
        suggestion: "Use Playwright/Cypress locators with automatic retries or intercept API responses instead of fixed sleeps.",
      };
    }
  }

  return null;
}

function getControlFlowStatementType(node: ts.Node): string | null {
  if (ts.isIfStatement(node)) return "if";
  if (ts.isForStatement(node)) return "for";
  if (ts.isForOfStatement(node)) return "for..of";
  if (ts.isForInStatement(node)) return "for..in";
  if (ts.isWhileStatement(node)) return "while";
  if (ts.isDoStatement(node)) return "do..while";
  if (ts.isSwitchStatement(node)) return "switch";
  if (ts.isConditionalExpression(node)) return "ternary";

  return null;
}

function countControlFlowAssertions(node: ts.Node, sourceFile: ts.SourceFile): number {
  if (ts.isIfStatement(node)) {
    const thenCount = countAssertionsInNode(node.thenStatement, sourceFile);
    const elseCount = node.elseStatement ? countAssertionsInNode(node.elseStatement, sourceFile) : 0;

    return thenCount + elseCount;
  }
  if (
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  ) {
    return countAssertionsInNode(node.statement, sourceFile);
  }
  if (ts.isSwitchStatement(node)) {
    return countAssertionsInNode(node.caseBlock, sourceFile);
  }
  if (ts.isConditionalExpression(node)) {
    return countAssertionsInNode(node.whenTrue, sourceFile) + countAssertionsInNode(node.whenFalse, sourceFile);
  }

  return 0;
}

function checkTestControlFlow(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding | null {
  const statementType = getControlFlowStatementType(node);
  if (!statementType) return null;

  const assertions = countControlFlowAssertions(node, sourceFile);
  if (assertions > 0) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    return {
      check: CHECK_NAME,
      rule: "no-logic-in-test",
      severity: "error",
      message: `Test contains iteration or branching logic ('${statementType}') wrapping assertions.`,
      file: filePath,
      line: line + 1,
      column: character + 1,
      excerpt: node.getText(sourceFile).split("\n")[0] ?? "",
      why: "Test determinism: Loops and branch conditions in test bodies can pass silently on empty data, obscure failure traces, and introduce test bugs. Use straight-line assertions, exact array matchers, or it.each instead.",
      suggestion: "Replace loops with explicit indexed assertions or parameterized it.each cases.",
    };
  }

  const LOOP_STATEMENT_TYPES = ["for", "for..of", "for..in", "while", "do..while"];
  if (LOOP_STATEMENT_TYPES.includes(statementType)) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

    return {
      check: CHECK_NAME,
      rule: "no-loop-in-test",
      severity: "warning",
      message: `Test contains a '${statementType}' loop. Tests should be straight-line and declarative.`,
      file: filePath,
      line: line + 1,
      column: character + 1,
      excerpt: node.getText(sourceFile).split("\n")[0] ?? "",
      why: "Readability and determinism: Loops in test setup or assertions obscure test flow. Use straight-line actions, array utilities, or it.each instead.",
      suggestion: "Unroll the loop into explicit straight-line actions or use it.each.",
    };
  }

  return null;
}

function isTestCall(node: ts.CallExpression, allowedNames: string[] = ALL_TEST_NAMES): boolean {
  const expr = node.expression;
  if (ts.isIdentifier(expr) && allowedNames.includes(expr.text)) {
    return true;
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    allowedNames.includes(expr.expression.text)
  ) {
    return true;
  }
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    ts.isIdentifier(expr.expression.expression) &&
    allowedNames.includes(expr.expression.expression.text)
  ) {
    return true;
  }
  if (
    ts.isTaggedTemplateExpression(expr) &&
    ts.isPropertyAccessExpression(expr.tag) &&
    ts.isIdentifier(expr.tag.expression) &&
    allowedNames.includes(expr.tag.expression.text)
  ) {
    return true;
  }

  return false;
}
function checkCallFindings(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding[] {
  const list: Finding[] = [];
  const hollow = checkHollowAssertion(node, sourceFile, filePath);
  if (hollow) list.push(hollow);

  const tautological = checkTautologicalAssertion(node, sourceFile, filePath);
  if (tautological) list.push(tautological);

  const staticSleep = checkStaticSleep(node, sourceFile, filePath);
  if (staticSleep) list.push(staticSleep);


  const calculation = checkAssertionCalculation(node, sourceFile, filePath);
  if (calculation) list.push(calculation);

  return list;
}

const MAX_EACH_CASES = 15;

interface EachRow {
  text: string;
  node: ts.Node;
}

interface EachInfo {
  rows: EachRow[];
  callback?: ts.ArrowFunction | ts.FunctionExpression | undefined;
}

function extractBindingIdentifiers(name: ts.BindingName): ts.Identifier[] {
  const ids: ts.Identifier[] = [];
  function collect(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      ids.push(node);
    } else if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
      for (const element of node.elements) {
        if (ts.isBindingElement(element)) {
          collect(element.name);
        }
      }
    }
  }
  collect(name);

  return ids;
}

function isIdentifierDeclarationOrProperty(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;

  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isJsxAttribute(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node)
  );
}

function isParameterReferenced(paramName: string, body: ts.Node): boolean {
  let found = false;
  function walk(node: ts.Node): void {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === paramName && !isIdentifierDeclarationOrProperty(node)) {
      found = true;

      return;
    }
    ts.forEachChild(node, walk);
  }
  walk(body);

  return found;
}

function findTestCallback(node: ts.CallExpression): ts.ArrowFunction | ts.FunctionExpression | undefined {
  return node.arguments.find(
    (arg): arg is ts.ArrowFunction | ts.FunctionExpression =>
      ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)
  );
}

function extractArrayEachInfo(
  expr: ts.CallExpression,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile
): EachInfo | null {
  const callee = expr.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "each") {
    return null;
  }

  const dataArg = expr.arguments[0];
  if (!dataArg || !ts.isArrayLiteralExpression(dataArg)) {
    return null;
  }

  const rows: EachRow[] = [];
  for (const element of dataArg.elements) {
    rows.push({
      text: element.getText(sourceFile).replaceAll(/\s+/g, " ").trim(),
      node: element,
    });
  }

  return { rows, callback: findTestCallback(node) };
}

function extractTaggedEachRows(template: ts.TemplateExpression, sourceFile: ts.SourceFile): EachRow[] {
  const headText = template.head.text;
  const headerLine = headText.trim().split("\n").find((line) => line.trim().length > 0);
  if (!headerLine) return [];

  const columns = headerLine.split("|").map((col) => col.trim()).filter(Boolean);
  const colCount = columns.length;
  if (colCount === 0) return [];

  const spans = template.templateSpans;
  const rows: EachRow[] = [];
  for (let spanIndex = 0; spanIndex < spans.length; spanIndex += colCount) {
    const rowSpans = spans.slice(spanIndex, spanIndex + colCount);
    const rowText = rowSpans
      .map((span) => span.expression.getText(sourceFile).trim())
      .join(", ");
    const firstSpan = rowSpans[0];
    if (firstSpan) {
      rows.push({ text: rowText, node: firstSpan });
    }
  }

  return rows;
}

function extractTaggedEachInfo(
  expr: ts.TaggedTemplateExpression,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile
): EachInfo | null {
  const tag = expr.tag;
  if (!ts.isPropertyAccessExpression(tag) || tag.name.text !== "each") {
    return null;
  }

  if (!ts.isTemplateExpression(expr.template)) {
    return null;
  }

  const rows = extractTaggedEachRows(expr.template, sourceFile);

  return { rows, callback: findTestCallback(node) };
}

function extractEachInfo(node: ts.CallExpression, sourceFile: ts.SourceFile): EachInfo | null {
  const expr = node.expression;
  if (ts.isCallExpression(expr)) {
    return extractArrayEachInfo(expr, node, sourceFile);
  }
  if (ts.isTaggedTemplateExpression(expr)) {
    return extractTaggedEachInfo(expr, node, sourceFile);
  }

  return null;
}

function checkDuplicateEachCases(
  rows: EachRow[],
  sourceFile: ts.SourceFile,
  filePath: string
): Finding[] {
  const findings: Finding[] = [];
  const seenRows = new Map<string, ts.Node>();

  for (const row of rows) {
    if (seenRows.has(row.text)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(row.node.getStart());
      findings.push({
        check: CHECK_NAME,
        rule: "duplicate-each-case",
        severity: "error",
        message: `Duplicate test case in parameterized table: '${row.text}'.`,
        file: filePath,
        line: line + 1,
        column: character + 1,
        excerpt: row.node.getText(sourceFile).split("\n")[0] ?? "",
        why: "Test redundancy: Duplicate test cases execute identical inputs, bloating test runtime without adding unique coverage or fault-detection capability.",
        suggestion: "Remove redundant test table rows or provide distinct inputs and expectations.",
      });
    } else {
      seenRows.set(row.text, row.node);
    }
  }

  return findings;
}

function checkOverParameterizedCases(
  rows: EachRow[],
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding | null {
  if (rows.length <= MAX_EACH_CASES) {
    return null;
  }

  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

  return {
    check: CHECK_NAME,
    rule: "over-parameterized-test",
    severity: "warning",
    message: `Parameterized test contains ${rows.length} cases (exceeds threshold of ${MAX_EACH_CASES}).`,
    file: filePath,
    line: line + 1,
    column: character + 1,
    excerpt: node.getText(sourceFile).split("\n")[0] ?? "",
    why: "Test hygiene & performance: Bloated data-driven tables slow down CI and often disguise missing equivalence partitioning or lack of property-based testing.",
    suggestion: "Consolidate cases to distinct boundary equivalence classes, or replace with property-based testing (e.g. fast-check).",
  };
}

function checkDeadEachParameters(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding[] {
  const findings: Finding[] = [];

  for (const param of callback.parameters) {
    const idNodes = extractBindingIdentifiers(param.name);
    for (const idNode of idNodes) {
      const paramName = idNode.text;
      if (paramName.startsWith("_")) {
        continue;
      }
      if (!isParameterReferenced(paramName, callback.body)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(idNode.getStart());
        findings.push({
          check: CHECK_NAME,
          rule: "dead-each-parameter",
          severity: "error",
          message: `Parameterized test parameter '${paramName}' is declared but never referenced in test body.`,
          file: filePath,
          line: line + 1,
          column: character + 1,
          excerpt: node.getText(sourceFile).split("\n")[0] ?? "",
          why: "Test veracity: A parameterized test that ignores its parameters provides false confidence by appearing data-driven while testing static values.",
          suggestion: "Use the parameter in an assertion or expectation, or remove it from the parameterized test signature.",
        });
      }
    }
  }

  return findings;
}

function checkParameterizedTestCases(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding[] {
  const eachInfo = extractEachInfo(node, sourceFile);
  if (!eachInfo) return [];

  const findings = checkDuplicateEachCases(eachInfo.rows, sourceFile, filePath);
  const overParam = checkOverParameterizedCases(eachInfo.rows, node, sourceFile, filePath);
  if (overParam) findings.push(overParam);

  if (eachInfo.callback) {
    findings.push(...checkDeadEachParameters(eachInfo.callback, node, sourceFile, filePath));
  }

  return findings;
}

function extractFixtureSize(initializer: ts.Expression | undefined): number | null {
  if (!initializer) {
    return null;
  }
  if (
    ts.isArrayLiteralExpression(initializer) &&
    initializer.elements.length >= MIN_ARRAY_FIXTURE_ITEMS
  ) {
    return initializer.elements.length;
  }
  if (
    ts.isObjectLiteralExpression(initializer) &&
    initializer.properties.length >= MIN_OBJECT_FIXTURE_PROPERTIES
  ) {
    return initializer.properties.length;
  }

  return null;
}

function checkTestFixtureScope(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding[] {
  if (!isTestCall(node, TEST_CASE_NAMES)) {
    return [];
  }

  const callback = node.arguments.find(
    (arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)
  );
  if (!callback || !ts.isBlock(callback.body)) {
    return [];
  }

  const findings: Finding[] = [];
  for (const statement of callback.body.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const decl of statement.declarationList.declarations) {
      const fixtureCount = extractFixtureSize(decl.initializer);
      if (fixtureCount !== null) {
        const varName = decl.name.getText(sourceFile);
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(decl.getStart());
        findings.push({
          check: CHECK_NAME,
          rule: "test-fixture-scope",
          severity: "warning",
          message: `Large test fixture '${varName}' (${fixtureCount} items) declared inside test case body.`,
          file: filePath,
          line: line + 1,
          column: character + 1,
          excerpt: statement.getText(sourceFile).split("\n")[0] ?? "",
          why: "Test clarity & fixture scoping: Declaring massive static fixture data inside test scope clutters test bodies and obscures assertion logic.",
          suggestion: "Move large static fixture declarations outside the test scope (module-level or dedicated mock/fixture files).",
        });
      }
    }
  }

  return findings;
}

const MIN_TEST_CALL_ARGS = 2;

function extractTestTitleAndCallback(node: ts.CallExpression): {
  titleText: string | null;
  titleNode: ts.Node | null;
  callback: ts.ArrowFunction | ts.FunctionExpression | null;
} {
  const expr = node.expression;
  const isDirectTest = ts.isIdentifier(expr) && ["it", "test"].includes(expr.text);
  const isChainTest = ts.isCallExpression(expr) || ts.isTaggedTemplateExpression(expr);

  if ((!isDirectTest && !isChainTest) || node.arguments.length < MIN_TEST_CALL_ARGS) {
    return { titleText: null, titleNode: null, callback: null };
  }

  const titleNode = node.arguments[0] ?? null;
  const second = node.arguments[1];
  const callback = second && (ts.isArrowFunction(second) || ts.isFunctionExpression(second)) ? second : null;
  const titleText = titleNode && ts.isStringLiteral(titleNode) ? titleNode.text : null;

  return { titleText, titleNode, callback };
}

function isExplicitValueMatch(
  expectedType: string,
  arg: ts.Node | undefined,
  sourceFile: ts.SourceFile
): boolean {
  if (!arg) return false;
  if (expectedType === "null") return arg.kind === ts.SyntaxKind.NullKeyword;
  if (expectedType === "undefined") return arg.getText(sourceFile) === "undefined";
  if (expectedType === "false") return arg.kind === ts.SyntaxKind.FalseKeyword;
  if (expectedType === "true") return arg.kind === ts.SyntaxKind.TrueKeyword;

  return false;
}

const MATCHER_NAMES_BY_TYPE: Record<string, string> = {
  null: "toBeNull",
  undefined: "toBeUndefined",
  false: "toBeFalsy",
  true: "toBeTruthy",
};

function matchesExpectedReturnValue(
  expectedType: string,
  propName: string,
  firstArg: ts.Node | undefined,
  sourceFile: ts.SourceFile
): boolean {
  if (propName === MATCHER_NAMES_BY_TYPE[expectedType]) {
    return true;
  }
  if (propName === "toBe" || propName === "toEqual") {
    return isExplicitValueMatch(expectedType, firstArg, sourceFile);
  }

  return false;
}

function hasExpectedReturnAssertion(
  root: ts.Node,
  expectedType: string,
  sourceFile: ts.SourceFile
): boolean {
  let matched = false;

  function walk(child: ts.Node): void {
    if (matched) return;

    if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) {
      const propName = child.expression.name.text;
      const firstArg = child.arguments[0];
      if (matchesExpectedReturnValue(expectedType, propName, firstArg, sourceFile)) {
        matched = true;

        return;
      }
    }

    ts.forEachChild(child, walk);
  }

  walk(root);

  return matched;
}

function getExpectedTypeMatcherSuggestion(expectedType: string): string {
  if (expectedType === "null") return "toBeNull()";
  if (expectedType === "undefined") return "toBeUndefined()";

  return `toBe(${expectedType})`;
}

function checkTestTitleContractMismatch(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding | null {
  const { titleText, titleNode, callback } = extractTestTitleAndCallback(node);
  if (!titleText || !titleNode || !callback) return null;

  const match = titleText.match(/\breturns?\s+(null|undefined|false|true)\b/i);
  if (!match) return null;

  const expectedType = match[1]?.toLowerCase() ?? "";
  if (hasExpectedReturnAssertion(callback.body, expectedType, sourceFile)) {
    return null;
  }

  const { line, character } = sourceFile.getLineAndCharacterOfPosition(titleNode.getStart());
  const matcherSuggestion = getExpectedTypeMatcherSuggestion(expectedType);

  return {
    check: CHECK_NAME,
    rule: "test-title-contract-mismatch",
    severity: "warning",
    message: `Test title claims to verify returning '${expectedType}', but no corresponding matcher ('${matcherSuggestion}') exists in the test body.`,
    file: filePath,
    line: line + 1,
    column: character + 1,
    excerpt: titleNode.getText(sourceFile),
    why: "Test veracity & title accuracy: A test title that promises return-value contracts but verifies unaligned fallback behavior creates false confidence and misleads reviewers.",
    suggestion: `Assert the return value explicitly with '${matcherSuggestion}', or rename the test title to accurately describe what is being verified.`,
  };
}

function extractNonEmptinessVariable(stmt: ts.Statement, sourceFile: ts.SourceFile): string | null {
  if (!ts.isVariableStatement(stmt)) return null;

  for (const decl of stmt.declarationList.declarations) {
    if (decl.initializer && ts.isCallExpression(decl.initializer)) {
      const initText = decl.initializer.getText(sourceFile);
      if ((initText.includes("getAllBy") || initText.includes("queryAllBy")) && ts.isIdentifier(decl.name)) {
        return decl.name.text;
      }
    }
  }

  return null;
}

function extractGuardedVariable(stmt: ts.Statement): { varName: string; guardNode: ts.Node } | null {
  if (!ts.isExpressionStatement(stmt) || !ts.isCallExpression(stmt.expression)) {
    return null;
  }

  const expr = stmt.expression;
  if (ts.isIdentifier(expr.expression) && expr.expression.text === "assertDefined" && expr.arguments.length > 0) {
    const arg = expr.arguments[0];
    if (arg && ts.isIdentifier(arg)) {
      return { varName: arg.text, guardNode: expr };
    }
  }

  if (ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === "toBeDefined") {
    const innerCall = expr.expression.expression;
    if (ts.isCallExpression(innerCall) && ts.isIdentifier(innerCall.expression) && innerCall.expression.text === "expect") {
      const firstArg = innerCall.arguments[0];
      if (firstArg && ts.isIdentifier(firstArg)) {
        return { varName: firstArg.text, guardNode: expr };
      }
    }
  }

  return null;
}

function findArraySourceForVariable(
  targetVar: string,
  statements: readonly ts.Statement[],
  limitIndex: number,
  knownArrays: Set<string>
): string | null {
  for (let j = 0; j < limitIndex; j++) {
    const prevStmt = statements[j];
    if (!prevStmt || !ts.isVariableStatement(prevStmt)) continue;

    for (const decl of prevStmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === targetVar && decl.initializer && ts.isElementAccessExpression(decl.initializer)) {
        const arrExpr = decl.initializer.expression;
        if (ts.isIdentifier(arrExpr) && knownArrays.has(arrExpr.text)) {
          return arrExpr.text;
        }
      }
    }
  }

  return null;
}

function checkRedundantGuardAssertions(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding[] {
  if (!isTestCall(node, TEST_CASE_NAMES)) return [];

  const { callback } = extractTestTitleAndCallback(node);
  if (!callback || !ts.isBlock(callback.body)) return [];

  const findings: Finding[] = [];
  const statements = callback.body.statements;
  const nonEmptinessVars = new Set<string>();

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (!stmt) continue;

    const queryVar = extractNonEmptinessVariable(stmt, sourceFile);
    if (queryVar) {
      nonEmptinessVars.add(queryVar);
    }

    const guardInfo = extractGuardedVariable(stmt);
    if (guardInfo) {
      const arraySource = findArraySourceForVariable(guardInfo.varName, statements, i, nonEmptinessVars);
      if (arraySource) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(guardInfo.guardNode.getStart());
        findings.push({
          check: CHECK_NAME,
          rule: "no-redundant-guard-assertion",
          severity: "warning",
          message: `Redundant defensive guard assertion: '${guardInfo.varName}' was retrieved from '${arraySource}' which is already guaranteed non-empty by preceding queries/assertions.`,
          file: filePath,
          line: line + 1,
          column: character + 1,
          excerpt: stmt.getText(sourceFile).split("\n")[0] ?? "",
          why: "Test bloat & redundant assertions: Defensive guards on query results that already guarantee element existence or throw if missing add visual noise without enhancing test verification.",
          suggestion: `Remove the redundant 'assertDefined(${guardInfo.varName})' call.`,
        });
      }
    }
  }

  return findings;
}

const MIN_DUPLICATE_TEST_STATEMENTS = 2;

interface ParsedTestCase {
  callNode: ts.CallExpression;
  title: string | null;
  callback: ts.ArrowFunction | ts.FunctionExpression;
  isEach: boolean;
  eachTableNode: ts.Node | null;
  scopeNode: ts.Node;
}
interface TestTargetInfo {
  isTest: boolean;
  isEach: boolean;
  eachTableNode: ts.Node | null;
}

function getCallPropertyChain(expr: ts.Expression): string[] {
  const parts: string[] = [];
  let curr: ts.Expression = expr;

  while (ts.isPropertyAccessExpression(curr)) {
    parts.unshift(curr.name.text);
    curr = curr.expression;
  }

  if (ts.isIdentifier(curr)) {
    parts.unshift(curr.text);
  }

  return parts;
}

function isTestCallTarget(expr: ts.Expression): TestTargetInfo {
  if (ts.isCallExpression(expr)) {
    const chain = getCallPropertyChain(expr.expression);

    if (chain.length > 0 && (chain.at(0) === "it" || chain.at(0) === "test") && chain.includes("each")) {
      return { isTest: true, isEach: true, eachTableNode: expr.arguments.at(0) ?? null };
    }
  }

  if (ts.isTaggedTemplateExpression(expr)) {
    const chain = getCallPropertyChain(expr.tag);

    if (chain.length > 0 && (chain.at(0) === "it" || chain.at(0) === "test") && chain.includes("each")) {
      return { isTest: true, isEach: true, eachTableNode: expr.template };
    }
  }

  const chain = getCallPropertyChain(expr);
  const isTest = chain.length > 0 && (chain.at(0) === "it" || chain.at(0) === "test");

  return { isTest, isEach: false, eachTableNode: null };
}

function isSuiteCall(expr: ts.Expression): boolean {
  if (ts.isCallExpression(expr)) {
    const chain = getCallPropertyChain(expr.expression);

    return chain.length > 0 && ["describe", "suite", "context"].includes(chain.at(0) ?? "");
  }

  if (ts.isTaggedTemplateExpression(expr)) {
    const chain = getCallPropertyChain(expr.tag);

    return chain.length > 0 && ["describe", "suite", "context"].includes(chain.at(0) ?? "");
  }

  const chain = getCallPropertyChain(expr);

  return chain.length > 0 && ["describe", "suite", "context"].includes(chain.at(0) ?? "");
}

function serializeLiteralOrIdentifier(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) {
    return `Id:${node.text}`;
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return `Str:${node.text}`;
  }

  if (
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    return `Tpl:${node.text}`;
  }

  if (ts.isNumericLiteral(node)) {
    return `Num:${node.text}`;
  }

  if (ts.isBigIntLiteral(node)) {
    return `BigInt:${node.text}`;
  }

  if (ts.isRegularExpressionLiteral(node)) {
    return `Regex:${node.text}`;
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return "True";
  }

  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return "False";
  }

  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return "Null";
  }

  return null;
}

function serializeAstNode(node: ts.Node): string {
  let targetNode = node;

  while (ts.isParenthesizedExpression(targetNode)) {
    targetNode = targetNode.expression;
  }

  const literal = serializeLiteralOrIdentifier(targetNode);

  if (literal !== null) {
    return literal;
  }

  const parts: string[] = [];

  targetNode.forEachChild((child) => {
    parts.push(serializeAstNode(child));
  });

  return `${ts.SyntaxKind[targetNode.kind]}(${parts.join(",")})`;
}

function parseTestCall(
  node: ts.CallExpression,
  scopeNode: ts.Node
): ParsedTestCase | null {
  const target = isTestCallTarget(node.expression);

  if (!target.isTest) {
    return null;
  }

  let callback: ts.ArrowFunction | ts.FunctionExpression | null = null;

  for (const arg of node.arguments) {
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
      callback = arg;
      break;
    }
  }

  if (!callback) {
    return null;
  }

  const firstArg = node.arguments.at(0);
  const title =
    firstArg &&
    (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg))
      ? firstArg.text
      : null;

  return {
    callNode: node,
    title,
    callback,
    isEach: target.isEach,
    eachTableNode: target.eachTableNode,
    scopeNode,
  };
}

function collectTestCalls(sourceFile: ts.SourceFile): ParsedTestCase[] {
  const testCases: ParsedTestCase[] = [];

  function visit(node: ts.Node, currentScope: ts.Node): void {
    let nextScope = currentScope;

    if (ts.isCallExpression(node) && isSuiteCall(node.expression)) {
      for (const arg of node.arguments) {
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
          nextScope = arg;
          break;
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const testCase = parseTestCall(node, currentScope);

      if (testCase) {
        testCases.push(testCase);
      }
    }

    ts.forEachChild(node, (child) => visit(child, nextScope));
  }

  visit(sourceFile, sourceFile);

  return testCases;
}

function getTestCaseDedupeKey(testCase: ParsedTestCase): string {
  const bodyKey = serializeAstNode(testCase.callback.body);

  if (!testCase.isEach) {
    return `test:${bodyKey}`;
  }

  const tableKey = testCase.eachTableNode
    ? serializeAstNode(testCase.eachTableNode)
    : "";

  return `each:${tableKey}:${bodyKey}`;
}

function createDuplicateFinding(
  testCase: ParsedTestCase,
  previousLine: number,
  sourceFile: ts.SourceFile,
  filePath: string
): Finding {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    testCase.callNode.getStart(sourceFile)
  );
  const message = testCase.title
    ? `Duplicate test body: test case '${testCase.title}' duplicates the test on line ${previousLine}.`
    : `Duplicate test body: test case duplicates the test on line ${previousLine}.`;

  return {
    check: CHECK_NAME,
    rule: "duplicate-test-body",
    severity: "error",
    message,
    file: filePath,
    line: line + 1,
    column: character + 1,
    excerpt: testCase.callNode.getText(sourceFile).split("\n").at(0) ?? "",
    why: "Test hygiene: Duplicate test bodies execute identical assertions and logic, bloating suite execution time without testing distinct behavior.",
    suggestion:
      "Remove the duplicate test case or adjust its inputs and assertions to test unique behavior.",
  };
}

function checkDuplicateTestBodies(
  sourceFile: ts.SourceFile,
  filePath: string
): Finding[] {
  const testCases = collectTestCalls(sourceFile);
  const seenBodiesByScope = new Map<
    ts.Node,
    Map<string, { line: number; title: string | null }>
  >();
  const findings: Finding[] = [];

  for (const testCase of testCases) {
    if (!ts.isBlock(testCase.callback.body)) {
      continue;
    }

    if (testCase.callback.body.statements.length < MIN_DUPLICATE_TEST_STATEMENTS) {
      continue;
    }

    let seenBodies = seenBodiesByScope.get(testCase.scopeNode);

    if (!seenBodies) {
      seenBodies = new Map<string, { line: number; title: string | null }>();
      seenBodiesByScope.set(testCase.scopeNode, seenBodies);
    }

    const dedupeKey = getTestCaseDedupeKey(testCase);
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      testCase.callNode.getStart(sourceFile)
    );
    const currentLine = line + 1;
    const previous = seenBodies.get(dedupeKey);

    if (previous) {
      findings.push(
        createDuplicateFinding(testCase, previous.line, sourceFile, filePath)
      );
    } else {
      seenBodies.set(dedupeKey, { line: currentLine, title: testCase.title });
    }
  }

  return findings;
}

export function checkHollowTests(
  filePath: string,
  code: string,
  parsedSourceFile?: ts.SourceFile
): Finding[] {
  if (!TEST_FILE_PATTERN.test(filePath)) {
    return [];
  }

  const findings: Finding[] = [];
  const sourceFile = parsedSourceFile ?? createSourceFile(filePath, code);

  function visit(node: ts.Node, inTest: boolean): void {
    let currentInTest = inTest;

    if (ts.isCallExpression(node)) {

      const focused = checkFocusedTest(node, sourceFile, filePath);
      if (focused) findings.push(focused);

      if (isTestCall(node, TEST_CASE_NAMES)) {
        currentInTest = true;
        const missing = checkMissingAssertion(node, sourceFile, filePath);
        if (missing) findings.push(missing);
        findings.push(...checkTestFixtureScope(node, sourceFile, filePath));

        const titleMismatch = checkTestTitleContractMismatch(node, sourceFile, filePath);
        if (titleMismatch) findings.push(titleMismatch);

        findings.push(...checkRedundantGuardAssertions(node, sourceFile, filePath));
      }
      findings.push(...checkCallFindings(node, sourceFile, filePath));
      findings.push(...checkParameterizedTestCases(node, sourceFile, filePath));
    }

    if (currentInTest) {
      const controlFlow = checkTestControlFlow(node, sourceFile, filePath);
      if (controlFlow) findings.push(controlFlow);
    }

    ts.forEachChild(node, (child) => visit(child, currentInTest));
  }

  visit(sourceFile, false);
  findings.push(...checkDuplicateTestBodies(sourceFile, filePath));

  return findings;
}
