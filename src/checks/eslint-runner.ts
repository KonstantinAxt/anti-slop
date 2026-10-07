import { ESLint, type Rule } from "eslint";
import type { Comment as ESTreeComment, Node as ESTreeNode } from "estree";
import * as ts from "typescript";
import type { Finding } from "../types.js";
import { applyRepoRuleGuard } from "../rule-overrides.js";
import { createSourceFile } from "./ast.js";
// Import bundled plugins
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import sonarjs from "eslint-plugin-sonarjs";
import reactNoEffect from "eslint-plugin-react-you-might-not-need-an-effect";
import vitestPlugin from "@vitest/eslint-plugin";
import playwrightPlugin from "eslint-plugin-playwright";
import jsxA11y from "eslint-plugin-jsx-a11y";
import slop from "eslint-plugin-slop";
import { noEnvShellCommandRule } from "./no-env-shell-command-rule.js";
import unicorn from "eslint-plugin-unicorn";
import useClientPlugin from "eslint-plugin-use-client";
import barrelFilesPlugin from "eslint-plugin-barrel-files";
import stylistic from "@stylistic/eslint-plugin";
import testingLibrary from "eslint-plugin-testing-library";
import testSmells from "eslint-plugin-test-smells";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import reactPerfPlugin from "eslint-plugin-react-perf";
import reactRefreshPlugin from "eslint-plugin-react-refresh";
import eslintReactPlugin from "@eslint-react/eslint-plugin";
import jsdoc from "eslint-plugin-jsdoc";
import deMorganPlugin from "eslint-plugin-de-morgan";
let eslintInstance: ESLint | null = null;
const MAX_COGNITIVE_COMPLEXITY = 15;
const DUPLICATE_STRING_THRESHOLD = 4;
const ESLINT_ERROR_SEVERITY = 2;


const TEST_FILE_GLOBS = [
  // Test & story file patterns
  "**/*.{test,spec,stories,story}.{ts,tsx,js,jsx,mjs,cjs}",
  "**/*.mock.{ts,tsx,js,jsx}",
  // Test directories
  "**/test/**",
  "**/tests/**",
  "**/__test__/**",
  "**/__tests__/**",
  "**/spec/**",
  "**/specs/**",
  // Mock directories
  "**/mock/**",
  "**/mocks/**",
  "**/__mock__/**",
  "**/__mocks__/**",
  // Snapshot directories
  "**/snapshot/**",
  "**/snapshots/**",
  "**/__snapshot__/**",
  "**/__snapshots__/**",
  // Fixture directories
  "**/fixture/**",
  "**/fixtures/**",
  "**/__fixture__/**",
  "**/__fixtures__/**",
  // E2E & integration directories
  "**/e2e/**",
  "**/cypress/**",
  "**/playwright/**",
  // Storybook
  "**/.storybook/**",
  "**/stories/**",
];

const MIN_RESTATEMENT_MATCHED_WORDS = 2;
const WORD_PREFIX_COMPARE_LENGTH = 4;
const MIN_INFLATED_COMMENT_LINES = 4;
const MAX_SHORT_FUNCTION_LINES = 6;
const MIN_LONG_COMMENT_LINES = 8;
const MIN_ESSAY_LINES = 10;
const MIN_DEBATE_ESSAY_LINES = 5;
const INFLATION_RATIO_MULTIPLIER = 1.5;
type SourceComment = ESTreeComment;
function extractVariableNames(rawDeclarations: unknown): string[] {
  if (!Array.isArray(rawDeclarations)) {
    return [];
  }

  const names: string[] = [];
  for (const decl of rawDeclarations) {
    const id = typeof decl === "object" && decl !== null && "id" in decl ? Reflect.get(decl, "id") : null;
    if (typeof id === "object" && id !== null && Reflect.get(id, "type") === "Identifier") {
      names.push(String(Reflect.get(id, "name")));
    }
  }

  return names;
}

function extractExportDeclarations(
  rawDecl: unknown,
  node: Rule.Node
): Array<{ targetNode: Rule.Node; name: string | undefined }> {
  if (typeof rawDecl !== "object" || rawDecl === null || !("type" in rawDecl)) {
    return [];
  }

  const declType = Reflect.get(rawDecl, "type");
  if (declType === "FunctionDeclaration") {
    const id = Reflect.get(rawDecl, "id");
    const name = typeof id === "object" && id !== null && "name" in id ? String(Reflect.get(id, "name")) : undefined;

    return [{ targetNode: node, name }];
  }

  if (declType === "VariableDeclaration") {
    const names = extractVariableNames(Reflect.get(rawDecl, "declarations"));

    return names.map((name) => ({ targetNode: node, name }));
  }

  return [];
}

function extractNamedDeclarations(
  node: Rule.Node
): Array<{ targetNode: Rule.Node; name: string | undefined }> {
  if (node.type === "FunctionDeclaration") {
    const id = Reflect.get(node, "id");
    const name = typeof id === "object" && id !== null && "name" in id ? String(Reflect.get(id, "name")) : undefined;

    return [{ targetNode: node, name }];
  }

  if (node.type === "VariableDeclaration") {
    const names = extractVariableNames(Reflect.get(node, "declarations"));

    return names.map((name) => ({ targetNode: node, name }));
  }

  if (node.type === "ExportNamedDeclaration") {
    return extractExportDeclarations(Reflect.get(node, "declaration"), node);
  }

  return [];
}

function getLeadingBlockComments(
  node: Rule.Node,
  context: Rule.RuleContext,
  reportedStarts: Set<number>
): SourceComment[] {
  const comments = context.sourceCode.getCommentsBefore(node);
  const result: SourceComment[] = [];
  for (const comment of comments) {
    if (comment.type !== "Block") continue;
    const startPos = comment.range?.[0] ?? comment.loc?.start.line ?? 0;
    if (reportedStarts.has(startPos)) continue;
    reportedStarts.add(startPos);
    result.push(comment);
  }

  return result;
}

function isSyntaxRestatement(commentText: string, declName: string | undefined): boolean {
  const clean = commentText
    .replaceAll(/^\/\*\*|\*\/$/g, "")
    .split("\n")
    .map((line) => line.replaceAll(/^\s*\*\s?/g, "").trim())
    .filter(Boolean);
  const text = clean.join(" ");

  if (/@param\s+\w+\s+-\s+(Component properties|Properties|Props|.*payload|.*parameter)/i.test(text)) {
    return true;
  }
  if (/@returns\s+(The rendered|Rendered|Extracted)\s+/i.test(text)) {
    return true;
  }
  if (declName) {
    const words = declName
      .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/\s+/);
    const firstLine = (clean[0] ?? "").toLowerCase();
    const matchedWords = words.filter(
      (word) => firstLine.includes(word) || word.startsWith(firstLine.slice(0, WORD_PREFIX_COMPARE_LENGTH))
    );
    if (
      matchedWords.length >= MIN_RESTATEMENT_MATCHED_WORDS &&
      /^(renders|extracts|calculates|returns|gets|provides)\b/i.test(firstLine)
    ) {
      return true;
    }
  }

  return false;
}

function isCommentRatioInflated(
  commentText: string,
  nodeLines: number
): { commentLineCount: number; nodeLines: number } | null {
  if (/[A-Z]+-\d+|https?:\/\//.test(commentText)) {
    return null;
  }

  const cleanLines = commentText
    .split("\n")
    .map((line) => line.replaceAll(/^\s*\/?\*+\/?\s?/g, "").trim())
    .filter(Boolean);
  const commentLineCount = cleanLines.length;

  if (nodeLines <= MAX_SHORT_FUNCTION_LINES && commentLineCount >= MIN_INFLATED_COMMENT_LINES && commentLineCount > nodeLines) {
    return { commentLineCount, nodeLines };
  }
  if (commentLineCount >= MIN_LONG_COMMENT_LINES && commentLineCount > nodeLines * INFLATION_RATIO_MULTIPLIER) {
    return { commentLineCount, nodeLines };
  }

  return null;
}

function isEssayComment(commentText: string): boolean {
  if (/@license|copyright|\bSPDX\b/i.test(commentText)) {
    return false;
  }
  if (/[A-Z]+-\d+|https?:\/\//.test(commentText)) {
    return false;
  }

  const cleanLines = commentText
    .split("\n")
    .map((line) => line.replaceAll(/^\s*\/?\*+\/?\s?/g, "").trim())
    .filter(Boolean);
  const commentLineCount = cleanLines.length;

  const hasDebateKeywords =
    /(faster than|benchmarks?|GC pauses?|garbage allocations?|hash digest|string key|JSON\.stringify|allocates nothing)/i.test(
      commentText
    );

  if (hasDebateKeywords && commentLineCount >= MIN_DEBATE_ESSAY_LINES) {
    return true;
  }
  if (commentLineCount >= MIN_ESSAY_LINES) {
    return true;
  }

  return false;
}
function createDeclarationCommentRule(
  checkComment: (
    comment: SourceComment,
    name: string | undefined,
    targetNode: Rule.Node,
    context: Rule.RuleContext
  ) => void
): (context: Rule.RuleContext) => Rule.RuleListener {
  return (context: Rule.RuleContext): Rule.RuleListener => {
    const reportedStarts = new Set<number>();

    function checkNode(node: Rule.Node): void {
      const declarations = extractNamedDeclarations(node);
      for (const { targetNode, name } of declarations) {
        const comments = getLeadingBlockComments(targetNode, context, reportedStarts);
        for (const comment of comments) {
          if (!comment.loc) continue;
          checkComment(comment, name, targetNode, context);
        }
      }
    }

    return {
      FunctionDeclaration: checkNode,
      VariableDeclaration: checkNode,
      ExportNamedDeclaration: checkNode,
    };
  };
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function containsNullType(annotationNode: unknown): boolean {
  if (!isRecord(annotationNode)) return true;
  const target = isRecord(annotationNode.typeAnnotation)
    ? annotationNode.typeAnnotation
    : annotationNode;

  const nodeType = typeof target.type === "string" ? target.type : "";
  if (nodeType === "TSNullKeyword" || nodeType === "TSAnyKeyword") return true;
  if (nodeType === "TSUnionType" && Array.isArray(target.types)) {
    return target.types.some((element: unknown) => containsNullType(element));
  }

  return false;
}

function getVariableAnnotation(variable: unknown): unknown {
  if (!isRecord(variable) || !Array.isArray(variable.defs)) return null;
  for (const def of variable.defs) {
    if (!isRecord(def)) continue;
    const nameNode = def.name;
    if (isRecord(nameNode) && nameNode.typeAnnotation) {
      return nameNode.typeAnnotation;
    }
  }

  return null;
}

function findScopeVariable(context: Rule.RuleContext, node: Rule.Node, varName: string): unknown {
  let currentScope: unknown = isRecord(context.sourceCode)
    ? context.sourceCode.getScope(node)
    : undefined;

  while (isRecord(currentScope)) {
    const scopeSet = Reflect.get(currentScope, "set");
    if (scopeSet instanceof Map) {
      const found = scopeSet.get(varName);
      if (found) return found;
    }
    currentScope = Reflect.get(currentScope, "upper");
  }

  return null;
}

const codeSmellPlugin: ESLint.Plugin = {
  rules: {
    "no-leaky-conditional-spread": {
      meta: {
        type: "problem",
        docs: {
          description: "Flags conditional spreads like ...(x !== undefined ? { x } : {}) where nullish values still get spread.",
        },
        schema: [],
      },
      create(context: Rule.RuleContext) {
        return {
          SpreadElement(node: Rule.Node) {
            const arg = Reflect.get(node, "argument");
            if (!arg || typeof arg !== "object" || Reflect.get(arg, "type") !== "ConditionalExpression") return;

            const test = Reflect.get(arg, "test");
            if (!test || typeof test !== "object" || Reflect.get(test, "type") !== "BinaryExpression") return;

            const op = Reflect.get(test, "operator");
            const left = Reflect.get(test, "left");
            const right = Reflect.get(test, "right");

            const isLeftUndef = left && typeof left === "object" && Reflect.get(left, "type") === "Identifier" && Reflect.get(left, "name") === "undefined";
            const isRightUndef = right && typeof right === "object" && Reflect.get(right, "type") === "Identifier" && Reflect.get(right, "name") === "undefined";

            const isUndefinedCheck = (op === "!==" || op === "!=") && (isLeftUndef || isRightUndef);

            if (isUndefinedCheck) {
              const checkedVar = isRightUndef ? left : right;
              if (!checkedVar || typeof checkedVar !== "object") return;
              const varName = "name" in checkedVar ? String(Reflect.get(checkedVar, "name")) : "variable";

              if (Reflect.get(checkedVar, "type") === "Identifier") {
                const scopeVar = findScopeVariable(context, node, varName);
                const typeAnnotation = getVariableAnnotation(scopeVar);
                if (typeAnnotation && !containsNullType(typeAnnotation)) {
                  return;
                }
              }

              context.report({
                node,
                message: `Leaky conditional object spread on '${varName}'. If '${varName}' is null, it will still be spread into the object. Use '!= null' or an explicit truthiness check.`,
              });
            }
          },
        };
      },
    },
  },
};

function getRawNumberValue(node: Rule.Node | null | undefined): number | undefined {
  if (!node || typeof node !== "object") return undefined;
  const type = Reflect.get(node, "type");
  if (type === "Literal") {
    const val = Reflect.get(node, "value");

    return typeof val === "number" ? val : undefined;
  }
  if (type === "UnaryExpression") {
    const op = Reflect.get(node, "operator");
    if (op !== "-" && op !== "+") return undefined;
    const arg = Reflect.get(node, "argument");
    if (!arg || typeof arg !== "object" || Reflect.get(arg, "type") !== "Literal") return undefined;
    const val = Reflect.get(arg, "value");
    if (typeof val !== "number") return undefined;

    return op === "-" ? -val : val;
  }

  return undefined;
}

function getNodeKeyName(key: unknown): string {
  if (!key || typeof key !== "object") return "";
  if ("name" in key) return String(Reflect.get(key, "name"));
  if ("value" in key) return String(Reflect.get(key, "value"));

  return "";
}

interface CallDetails {
  fnName: string;
  objName: string;
  args: Rule.Node[];
}

function extractCallDetails(node: Rule.Node): CallDetails | undefined {
  const callee = Reflect.get(node, "callee");
  if (!callee || typeof callee !== "object") return undefined;
  const args = Reflect.get(node, "arguments");
  if (!Array.isArray(args) || args.length === 0) return undefined;

  const calleeType = Reflect.get(callee, "type");
  let fnName = "";
  let objName = "";
  if (calleeType === "Identifier") {
    fnName = String(Reflect.get(callee, "name") ?? "");
  } else if (calleeType === "MemberExpression") {
    const prop = Reflect.get(callee, "property");
    fnName = prop && typeof prop === "object" && "name" in prop ? String(Reflect.get(prop, "name")) : "";
    const obj = Reflect.get(callee, "object");
    objName = obj && typeof obj === "object" && "name" in obj ? String(Reflect.get(obj, "name")) : "";
  }

  return { fnName, objName, args };
}

function reportRawTimerNumber(context: Rule.RuleContext, targetNode: Rule.Node, val: number, calleeName: string): void {
  if (val <= 0) return;
  const loc = "loc" in targetNode ? targetNode.loc : undefined;
  if (loc) {
    context.report({
      loc,
      message: `Raw numeric literal '${val}' passed to timer control '${calleeName}'. Assign to a descriptive constant (e.g. '..._MS' or '..._TIMEOUT') to clarify wait duration.`,
    });

    return;
  }
  context.report({
    node: targetNode,
    message: `Raw numeric literal '${val}' passed to timer control '${calleeName}'. Assign to a descriptive constant (e.g. '..._MS' or '..._TIMEOUT') to clarify wait duration.`,
  });
}

function forEachObjectProperty(
  objNode: Rule.Node,
  callback: (keyName: string, valNode: Rule.Node) => void
): void {
  const properties = Reflect.get(objNode, "properties");
  if (!Array.isArray(properties)) return;
  for (const prop of properties) {
    if (!prop || typeof prop !== "object" || Reflect.get(prop, "type") !== "Property") continue;
    const keyName = getNodeKeyName(Reflect.get(prop, "key"));
    const valNode = Reflect.get(prop, "value");
    if (valNode && typeof valNode === "object") {
      callback(keyName, valNode);
    }
  }
}

function checkObjectTimerOptions(
  context: Rule.RuleContext,
  optionsNode: Rule.Node,
  calleeName: string
): void {
  forEachObjectProperty(optionsNode, (keyName, valNode) => {
    if (["timeout", "interval", "delay"].includes(keyName)) {
      const num = getRawNumberValue(valNode);
      if (num !== undefined) {
        reportRawTimerNumber(context, valNode, num, `${calleeName} (${keyName})`);
      }
    }
  });
}

const TIMER_ADVANCE_FNS: Record<string, true> = {
  advanceTimersByTime: true,
  advanceTimersByTimeAsync: true,
  advanceTimersToNextTimer: true,
  tick: true,
  waitForTimeout: true,
};

function checkTimerAdvanceCall(call: CallDetails, context: Rule.RuleContext): boolean {
  const isTimerAdvance = TIMER_ADVANCE_FNS[call.fnName];
  const isCypressWait = call.objName === "cy" && call.fnName === "wait";
  if (!isTimerAdvance && !isCypressWait) return false;

  const timerArg = call.args[0];
  if (timerArg) {
    const num = getRawNumberValue(timerArg);
    if (num !== undefined) {
      reportRawTimerNumber(context, timerArg, num, call.fnName);
    }
  }

  return true;
}

function checkTimerCall(node: Rule.Node, context: Rule.RuleContext): void {
  const call = extractCallDetails(node);
  if (!call) return;

  if (call.fnName === "setTimeout" || call.fnName === "setInterval") {
    const timerArg = call.args[1];
    if (timerArg) {
      const num = getRawNumberValue(timerArg);
      if (num !== undefined) {
        reportRawTimerNumber(context, timerArg, num, call.fnName);
      }
    }

    return;
  }

  if (checkTimerAdvanceCall(call, context)) return;

  if (call.fnName === "waitFor" || call.fnName === "waitForElementToBeRemoved") {
    for (const arg of call.args) {
      if (arg && typeof arg === "object" && Reflect.get(arg, "type") === "ObjectExpression") {
        checkObjectTimerOptions(context, arg, call.fnName);
      }
    }
  }
}

const LARGE_COORDINATE_INTEGER_THRESHOLD = 1000;

const COORDINATE_PROP_NAMES: Record<string, true> = {
  scrollLeft: true,
  scrollTop: true,
  scrollWidth: true,
  scrollHeight: true,
  scrollX: true,
  scrollY: true,
  clientWidth: true,
  clientHeight: true,
  offsetWidth: true,
  offsetHeight: true,
  innerWidth: true,
  innerHeight: true,
  outerWidth: true,
  outerHeight: true,
  clientX: true,
  clientY: true,
  pageX: true,
  pageY: true,
  screenX: true,
  screenY: true,
  initialScrollLeft: true,
  initialScrollTop: true,
  initialOffset: true,
  viewportWidth: true,
  viewportHeight: true,
  width: true,
  height: true,
  x: true,
  y: true,
  left: true,
  top: true,
};

function reportRawCoordinate(context: Rule.RuleContext, targetNode: Rule.Node, val: number, targetName: string): void {
  const loc = "loc" in targetNode ? targetNode.loc : undefined;
  if (loc) {
    context.report({
      loc,
      message: `Raw coordinate/dimension integer '${val}' used for '${targetName}'. Assign to a descriptive constant (e.g. '..._OFFSET_PX' or '..._WIDTH') to clarify domain geometry.`,
    });

    return;
  }
  context.report({
    node: targetNode,
    message: `Raw coordinate/dimension integer '${val}' used for '${targetName}'. Assign to a descriptive constant (e.g. '..._OFFSET_PX' or '..._WIDTH') to clarify domain geometry.`,
  });
}

function checkCoordinateAssignment(node: Rule.Node, context: Rule.RuleContext): void {
  const left = Reflect.get(node, "left");
  if (!left || typeof left !== "object" || Reflect.get(left, "type") !== "MemberExpression") return;
  const property = Reflect.get(left, "property");
  const propName = property && typeof property === "object" && "name" in property ? String(Reflect.get(property, "name")) : "";
  if (!COORDINATE_PROP_NAMES[propName]) return;

  const right = Reflect.get(node, "right");
  const num = getRawNumberValue(right);
  if (num !== undefined && Number.isInteger(num) && Math.abs(num) > LARGE_COORDINATE_INTEGER_THRESHOLD) {
    reportRawCoordinate(context, right, num, propName);
  }
}

const SCROLLER_OR_COORDINATE_FN_RE = /^(set|make|create|mock|update)?.*(scroll|scroller|coordinate)/i;

function checkCoordinateObjectProperties(
  context: Rule.RuleContext,
  objNode: Rule.Node,
  calleeName: string
): void {
  forEachObjectProperty(objNode, (keyName, valNode) => {
    if (COORDINATE_PROP_NAMES[keyName]) {
      const num = getRawNumberValue(valNode);
      if (num !== undefined && Number.isInteger(num) && Math.abs(num) > LARGE_COORDINATE_INTEGER_THRESHOLD) {
        reportRawCoordinate(context, valNode, num, `${calleeName} (${keyName})`);
      }
    } else if (Reflect.get(valNode, "type") === "ObjectExpression") {
      checkCoordinateObjectProperties(context, valNode, `${calleeName} (${keyName})`);
    }
  });
}

function checkCoordinateCall(node: Rule.Node, context: Rule.RuleContext): void {
  const call = extractCallDetails(node);
  if (!call || call.objName === "cy") return;

  const { fnName, args } = call;
  const isCoordinateFn = ["scrollTo", "scrollBy", "scroll"].includes(fnName) || SCROLLER_OR_COORDINATE_FN_RE.test(fnName);

  if (isCoordinateFn) {
    for (const arg of args) {
      const num = getRawNumberValue(arg);
      if (num !== undefined && Number.isInteger(num) && Math.abs(num) > LARGE_COORDINATE_INTEGER_THRESHOLD) {
        reportRawCoordinate(context, arg, num, `${fnName}()`);
      }
    }
  }

  for (const arg of args) {
    if (arg && typeof arg === "object" && Reflect.get(arg, "type") === "ObjectExpression") {
      checkCoordinateObjectProperties(context, arg, fnName || "call");
    }
  }
}

function checkCoordinateJsx(node: Rule.Node, context: Rule.RuleContext): void {
  const nameNode = Reflect.get(node, "name");
  const attrName = getNodeKeyName(nameNode);
  if (!COORDINATE_PROP_NAMES[attrName]) return;

  const valueNode = Reflect.get(node, "value");
  if (!valueNode || typeof valueNode !== "object") return;
  if (Reflect.get(valueNode, "type") !== "JSXExpressionContainer") return;

  const expr = Reflect.get(valueNode, "expression");
  const num = getRawNumberValue(expr);
  if (num !== undefined && Number.isInteger(num) && Math.abs(num) > LARGE_COORDINATE_INTEGER_THRESHOLD) {
    reportRawCoordinate(context, expr, num, `<... ${attrName}={...}>`);
  }
}

const testHygienePlugin: ESLint.Plugin = {
  rules: {
    "no-magic-float-assertions": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Flags raw magic float literals in test assertions.",
        },
        schema: [],
      },
      create(context: Rule.RuleContext) {
        return {
          CallExpression(node: Rule.Node) {
            const callee = Reflect.get(node, "callee");
            if (!callee || typeof callee !== "object" || Reflect.get(callee, "type") !== "MemberExpression") return;

            const property = Reflect.get(callee, "property");
            const propName = property && typeof property === "object" && "name" in property ? String(Reflect.get(property, "name")) : "";
            if (!["toBe", "toBeCloseTo", "toEqual"].includes(propName)) return;

            const args = Reflect.get(node, "arguments");
            const arg = Array.isArray(args) ? args[0] : undefined;
            if (
              arg &&
              typeof arg === "object" &&
              Reflect.get(arg, "type") === "Literal" &&
              typeof Reflect.get(arg, "value") === "number" &&
              !Number.isInteger(Reflect.get(arg, "value"))
            ) {
              const val = Reflect.get(arg, "value");
              const loc = arg && typeof arg === "object" && "loc" in arg ? arg.loc : undefined;
              if (loc) {
                context.report({
                  loc,
                  message: `Magic float literal '${val}' in test assertion '${propName}()'. Assign to a named constant (e.g. EXPECTED_...) or compute from test parameters.`,
                });
              } else {
                context.report({
                  node,
                  message: `Magic float literal '${val}' in test assertion '${propName}()'. Assign to a named constant (e.g. EXPECTED_...) or compute from test parameters.`,
                });
              }
            }
          },
        };
      },
    },
    "no-raw-timer-literals": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Flags raw numeric literals passed to timer functions and controls in test code.",
        },
        schema: [],
      },
      create(context: Rule.RuleContext) {
        return {
          CallExpression(node: Rule.Node) {
            checkTimerCall(node, context);
          },
        };
      },
    },
    "no-raw-coordinate-literals": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Flags large unassigned coordinate and dimension integers (> 1000) in test code.",
        },
        schema: [],
      },
      create(context: Rule.RuleContext) {
        return {
          AssignmentExpression(node: Rule.Node) {
            checkCoordinateAssignment(node, context);
          },
          CallExpression(node: Rule.Node) {
            checkCoordinateCall(node, context);
          },
          JSXAttribute(node: Rule.Node) {
            checkCoordinateJsx(node, context);
          },
        };
      },
    },
  },
};

const commentDisciplinePlugin: ESLint.Plugin = {
  rules: {
    "no-syntax-restatement": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Flags redundant JSDoc comments that merely restate function names or TypeScript parameter types.",
        },
        schema: [],
      },
      create: createDeclarationCommentRule((comment, name, _targetNode, context) => {
        if (comment.loc && isSyntaxRestatement(comment.value, name)) {
          context.report({
            loc: comment.loc,
            message: `Trivial syntax restatement in JSDoc comment. The comment merely restates the name/types of '${name ?? "declaration"}'.`,
          });
        }
      }),
    },
    "no-comment-ratio-inflation": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Flags comments that are disproportionately longer than the attached short implementation.",
        },
        schema: [],
      },
      create: createDeclarationCommentRule((comment, _name, targetNode, context) => {
        if (!comment.loc) return;
        const nodeLines = (targetNode.loc?.end.line ?? 0) - (targetNode.loc?.start.line ?? 0) + 1;
        const res = isCommentRatioInflated(comment.value, nodeLines);
        if (res) {
          context.report({
            loc: comment.loc,
            message: `Comment-to-code ratio inflation: ${res.commentLineCount}-line comment attached to a ${res.nodeLines}-line function.`,
          });
        }
      }),
    },
    "no-essay-comments": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Flags multi-paragraph design essays, benchmark debates, and architectural justifications in source code.",
        },
        schema: [],
      },
      create(context: Rule.RuleContext) {
        return {
          Program() {
            const comments = context.sourceCode.getAllComments();
            for (const comment of comments) {
              if (comment.type !== "Block" || !comment.loc) continue;
              if (isEssayComment(comment.value)) {
                context.report({
                  loc: comment.loc,
                  message: "Multi-paragraph architectural essay in source code comment. Move design debates and benchmarks to PR description or ADR.",
                });
              }
            }
          },
        };
      },
    },
  },
};

const NAMED_CONSTANT_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const JSON_STRINGIFY_INDENT_ARG = 2;
const FUNCTION_NODE_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

// Numbers that build a module-level SCREAMING_CASE constant
// (`const TIMEOUT_MS = 10 * 60 * 1000`) or set JSON.stringify indentation are named, not magic.
function isNamedMagicNumber(node: ESTreeNode, ancestors: ESTreeNode[]): boolean {
  const parent = ancestors.at(-1);
  if (
    parent?.type === "CallExpression" &&
    parent.arguments[JSON_STRINGIFY_INDENT_ARG] === node &&
    parent.callee.type === "MemberExpression" &&
    parent.callee.object.type === "Identifier" &&
    parent.callee.object.name === "JSON" &&
    parent.callee.property.type === "Identifier" &&
    parent.callee.property.name === "stringify"
  ) {
    return true;
  }

  const boundaryIndex = ancestors.findLastIndex(
    (ancestor) => ancestor.type === "VariableDeclarator" || FUNCTION_NODE_TYPES.has(ancestor.type),
  );
  const declarator = ancestors.at(boundaryIndex);
  if (boundaryIndex < 0 || declarator?.type !== "VariableDeclarator") return false;

  const [declaration, owner] = ancestors.slice(0, boundaryIndex).reverse();

  return (
    declaration?.type === "VariableDeclaration" &&
    declaration.kind === "const" &&
    declarator.id.type === "Identifier" &&
    NAMED_CONSTANT_PATTERN.test(declarator.id.name) &&
    (owner?.type === "Program" || owner?.type === "ExportNamedDeclaration")
  );
}

const eslintTsPlugin: ESLint.Plugin = tsPlugin;
const baseMagicNumbersRule = eslintTsPlugin.rules?.["no-magic-numbers"];
if (!baseMagicNumbersRule || typeof baseMagicNumbersRule === "function") {
  throw new Error("@typescript-eslint/eslint-plugin no longer exports a no-magic-numbers rule module");
}

const tsPluginWithNamedConstants: ESLint.Plugin = {
  ...eslintTsPlugin,
  rules: {
    ...eslintTsPlugin.rules,
    "no-magic-numbers": {
      ...baseMagicNumbersRule,
      create(context: Rule.RuleContext) {
        const listeners = baseMagicNumbersRule.create(context);
        const reportLiteral = listeners.Literal;

        return {
          ...listeners,
          Literal(node: Rule.Node) {
            if (isNamedMagicNumber(node, context.sourceCode.getAncestors(node))) return;
            reportLiteral?.(node);
          },
        };
      },
    },
  },
};

function getEslint(): ESLint {
  if (eslintInstance) return eslintInstance;
  function wrapPluginWithContextCompat(plugin: ESLint.Plugin): ESLint.Plugin {
    if (!plugin.rules) return plugin;

    return {
      ...plugin,
      rules: Object.fromEntries(
        Object.entries(plugin.rules).map(([name, rule]) => [
          name,
          typeof rule === "object" && rule !== null && "create" in rule
            ? {
                ...rule,
                create(context: Rule.RuleContext) {
                  const proxy = new Proxy(context, {
                    get(target, prop, receiver) {
                      if (prop === "getSourceCode") {
                        return () => target.sourceCode;
                      }
                      if (prop === "getFilename") {
                        return () => target.filename;
                      }
                      if (prop === "getPhysicalFilename") {
                        return () => target.physicalFilename;
                      }
                      if (prop === "getCwd") {
                        return () => target.cwd;
                      }
                      if (prop === "getScope") {
                        return () => target.sourceCode.getScope(target.sourceCode.ast);
                      }

                      return Reflect.get(target, prop, receiver);
                    },
                  });

                  return rule.create(proxy);
                },
              }
            : rule,
        ]),
      ),
    };
  }

  const compatibleTestSmells = wrapPluginWithContextCompat(testSmells);
  const compatibleReact = wrapPluginWithContextCompat(reactPlugin);
  const plugins: Record<string, ESLint.Plugin> = {
    "@typescript-eslint": tsPluginWithNamedConstants,
    sonarjs,
    "react-you-might-not-need-an-effect": reactNoEffect,
    vitest: vitestPlugin,
    playwright: playwrightPlugin,
    "jsx-a11y": jsxA11y,
    slop: {
      ...slop,
      rules: {
        ...slop.rules,
        "no-env-shell-command": noEnvShellCommandRule,
      },
    },
    unicorn,
    "use-client": useClientPlugin,
    "barrel-files": barrelFilesPlugin,
    "@stylistic": stylistic,
    "testing-library": testingLibrary,
    "test-smells": compatibleTestSmells,
    react: compatibleReact,
    "react-hooks": reactHooksPlugin,
    "react-perf": reactPerfPlugin,
    "react-refresh": reactRefreshPlugin,
    "@eslint-react": eslintReactPlugin,
    jsdoc,
    "de-morgan": deMorganPlugin,
    "comment-discipline": commentDisciplinePlugin,
    "code-smell": codeSmellPlugin,
    "test-hygiene": testHygienePlugin,
  };

  eslintInstance = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
        settings: {
          react: {
            version: "19.0",
          },
        },
        languageOptions: {
          parser: tsParser,
          parserOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            ecmaFeatures: { jsx: true },
          },
        },
        plugins,
        rules: {
          // Move #3 SonarJS behavior filter
          "sonarjs/cognitive-complexity": ["warn", MAX_COGNITIVE_COMPLEXITY],
          "sonarjs/no-identical-conditions": "error",
          "sonarjs/no-duplicated-branches": "error",
          "sonarjs/no-identical-expressions": "error",
          // Move #3 Unnecessary effects (react-you-might-not-need-an-effect)
          "react-you-might-not-need-an-effect/no-derived-state": "warn",
          "react-you-might-not-need-an-effect/no-chain-state-updates": "warn",
          "react-you-might-not-need-an-effect/no-adjust-state-on-prop-change": "warn",
          "sonarjs/no-duplicate-string": ["warn", { threshold: DUPLICATE_STRING_THRESHOLD }],

          // Move #3 Vitest assertions & test slop gate
          "vitest/no-conditional-in-test": "warn",
          "vitest/no-conditional-expect": "warn",
          "vitest/no-identical-title": "error",
          "vitest/no-standalone-expect": "error",
          "vitest/valid-expect": "error",
          "vitest/valid-title": "error",
          "vitest/prefer-called-with": "warn",
          "vitest/prefer-to-have-length": "warn",

          // Move #3 JSX accessibility
          "jsx-a11y/alt-text": "error",
          "jsx-a11y/aria-role": "error",

          // Move #3 Strict TS rules
          "@typescript-eslint/consistent-type-assertions": [
            "warn",
            { assertionStyle: "never" },
          ],
          "@typescript-eslint/explicit-function-return-type": [
            "warn",
            {
              allowExpressions: true,
              allowTypedFunctionExpressions: true,
              allowHigherOrderFunctions: true,
              allowDirectConstAssertionInArrowFunctions: true,
              allowConciseArrowFunctionExpressionsStartingWithVoid: true,
            },
          ],
          "@typescript-eslint/no-unused-vars": [
            "warn",
            {
              argsIgnorePattern: "^_",
              varsIgnorePattern: "^_",
              caughtErrorsIgnorePattern: "^_",
              ignoreRestSiblings: true,
            },
          ],

          // AI structural patterns & low-value shortcuts (eslint-plugin-slop)
          "slop/no-chained-type-assertions": "error",
          "slop/no-static-only-class": "error",
          "slop/no-trivial-functions": ["warn", { minimumReferences: 3 }],
          "slop/no-trivial-type-aliases": "warn",
          "slop/no-jargon": "warn",
          "slop/no-env-shell-command": "error",
          "no-warning-comments": [
            "error",
            {
              terms: ["test plan", "test-plan", "ai plan", "scratchpad", "prompt:"],
              location: "anywhere",
            },
          ],
          // Array method callback return discipline
          "array-callback-return": [
            "error",
            { allowImplicit: false, checkForEach: false },
          ],
          // Control flow simplicity (no nested ternaries)
          "no-nested-ternary": "warn",
          // Identifier length and descriptive naming
          "id-length": [
            "warn",
            {
              min: 2,
              properties: "never",
              exceptions: ["_", "i", "j", "x", "y", "z", "e"],
              exceptionPatterns: ["^_[a-zA-Z0-9]+$", "^[A-Z]$"],
            },
          ],
          // Async defects, defensive hallucinations & logic bugs (eslint-plugin-unicorn)
          "unicorn/no-await-in-promise-methods": "error",
          "unicorn/no-useless-promise-resolve-reject": "error",
          "unicorn/no-single-promise-in-promise-methods": "warn",
          "unicorn/no-useless-fallback-in-spread": "error",
          "unicorn/no-useless-length-check": "warn",
          "unicorn/no-negation-in-equality-check": "error",
          "unicorn/no-invalid-fetch-options": "error",
          "unicorn/prefer-logical-operator-over-ternary": "warn",
          "unicorn/prefer-node-protocol": "warn",
          "unicorn/prefer-structured-clone": "warn",
          "unicorn/prefer-at": "warn",
          "unicorn/prefer-string-replace-all": "warn",
          "unicorn/prefer-date-now": "warn",
          // Boolean simplification via De Morgan's laws (eslint-plugin-de-morgan)
          "de-morgan/no-negated-conjunction": "warn",
          "de-morgan/no-negated-disjunction": "warn",
          // Module architecture & performance (eslint-plugin-barrel-files)
          "barrel-files/avoid-re-export-all": "error",
          "barrel-files/avoid-barrel-files": [
            "warn",
            { amountOfExportsToConsiderModuleAsBarrel: 1 },
          ],
          // Code spacing & formatting (@stylistic)
          "@stylistic/padding-line-between-statements": [
            "warn",
            { blankLine: "always", prev: "*", next: "return" },
          ],
          // React core best practices (eslint-plugin-react)
          "react/jsx-key": "error",
          "react/no-array-index-key": "warn",
          "react/no-unstable-nested-components": "error",
          "react/jsx-no-constructed-context-values": "warn",
          "react/no-danger-with-children": "error",
          "react/void-dom-elements-no-children": "error",
          "react/no-direct-mutation-state": "error",
          "react/jsx-no-useless-fragment": "warn",
          // React hooks & React compiler rules (eslint-plugin-react-hooks)
          "react-hooks/rules-of-hooks": "error",
          "react-hooks/exhaustive-deps": "warn",
          "react-hooks/immutability": "error",
          "react-hooks/purity": "error",
          "react-hooks/set-state-in-render": "error",
          // React performance anti-patterns (eslint-plugin-react-perf)
          "react-perf/jsx-no-new-object-as-prop": [
            "warn",
            { nativeAllowList: ["style"] },
          ],
          "react-perf/jsx-no-new-array-as-prop": "warn",
          "react-perf/jsx-no-new-function-as-prop": "warn",
          // Modern React resource leak checks (@eslint-react)
          "@eslint-react/web-api-no-leaked-timeout": "warn",
          "@eslint-react/web-api-no-leaked-interval": "warn",
          "@eslint-react/web-api-no-leaked-event-listener": "warn",
          "@eslint-react/dom-no-dangerously-set-innerhtml-with-children": "error",
          "@eslint-react/dom-no-void-elements-with-children": "error",
          "@typescript-eslint/no-magic-numbers": [
            "warn",
            {
              ignore: [-1, 0, 1],
              ignoreArrayIndexes: true,
              ignoreDefaultValues: true,
              ignoreClassFieldInitialValues: true,
              enforceConst: true,
              ignoreEnums: true,
              ignoreNumericLiteralTypes: true,
              ignoreReadonlyClassProperties: true,
              ignoreTypeIndexes: true,
            },
          ],
          // JSDoc syntax hygiene (eslint-plugin-jsdoc)
          "jsdoc/check-alignment": "warn",
          "jsdoc/check-param-names": ["warn", { checkDestructured: false }],
          "jsdoc/check-property-names": "warn",
          "jsdoc/check-tag-names": "warn",
          "jsdoc/no-bad-blocks": "warn",
          "jsdoc/require-asterisk-prefix": "warn",
          // Comment discipline and anti-slop rules
          "comment-discipline/no-syntax-restatement": "warn",
          "comment-discipline/no-comment-ratio-inflation": "warn",
          "comment-discipline/no-essay-comments": "warn",
          "code-smell/no-leaky-conditional-spread": "warn",
        },
      },
      {
        files: [
          "**/e2e/**/*.{ts,tsx,js,jsx}",
          "**/playwright/**/*.{ts,tsx,js,jsx}",
          "**/*.playwright.{ts,tsx,js,jsx}",
        ],
        rules: {
          "playwright/missing-playwright-await": "error",
          "playwright/no-conditional-in-test": "warn",
          "playwright/no-element-handle": "error",
          "playwright/no-eval": "error",
          "playwright/prefer-web-first-assertions": "warn",
        },
      },
      {
        files: ["**/*.ts"],
        rules: {
          "use-client/require-use-client": ["warn", { browserApis: false }],
        },
      },
      {
        files: ["**/*.{tsx,jsx}"],
        rules: {
          "use-client/require-use-client": "error",
          "react-refresh/only-export-components": [
            "warn",
            { allowConstantExport: true },
          ],
        },
      },
      {
        files: TEST_FILE_GLOBS,
        rules: {
          "@typescript-eslint/explicit-function-return-type": "off",
          "sonarjs/no-duplicate-string": "off",
          "@typescript-eslint/consistent-type-assertions": "off",
          "@typescript-eslint/no-magic-numbers": "off",
          "slop/no-chained-type-assertions": "off",
          "use-client/require-use-client": "off",
          "barrel-files/avoid-barrel-files": "off",
          "barrel-files/avoid-re-export-all": "off",
          // Disable production React performance & refresh rules in test files
          "react-perf/jsx-no-new-object-as-prop": "off",
          "react-perf/jsx-no-new-array-as-prop": "off",
          "react-perf/jsx-no-new-function-as-prop": "off",
          "react/no-array-index-key": "off",
          "react-refresh/only-export-components": "off",
          "comment-discipline/no-syntax-restatement": "off",
          "comment-discipline/no-comment-ratio-inflation": "off",
          "comment-discipline/no-essay-comments": "off",
          "id-length": "off",
          // Test formatting & padding (vitest)
          "vitest/padding-around-all": "warn",
          // Testing Library best practices (eslint-plugin-testing-library)
          "testing-library/no-node-access": "warn",
          "testing-library/no-container": "warn",
          "testing-library/prefer-screen-queries": "warn",
          "testing-library/prefer-presence-queries": "warn",
          "testing-library/await-async-queries": "error",
          "testing-library/await-async-utils": "error",
          "testing-library/no-await-sync-queries": "error",
          "testing-library/no-unnecessary-act": "warn",
          // Test smells detection (eslint-plugin-test-smells)
          "test-smells/redundant-print": "warn",
          "test-smells/sleepy-test": "warn",
          "test-hygiene/no-magic-float-assertions": "warn",
          "test-hygiene/no-raw-timer-literals": "warn",
          "test-hygiene/no-raw-coordinate-literals": "warn",
        },
      },
      {
        files: [
          "**/cypress/**/*.{ts,tsx,js,jsx}",
          "**/*.cy.{ts,tsx,js,jsx}",
        ],
        rules: {
          "playwright/missing-playwright-await": "off",
          "playwright/no-conditional-in-test": "off",
          "playwright/no-element-handle": "off",
          "playwright/no-eval": "off",
          "playwright/prefer-web-first-assertions": "off",
          "testing-library/no-node-access": "off",
          "testing-library/no-container": "off",
          "testing-library/prefer-screen-queries": "off",
          "testing-library/prefer-presence-queries": "off",
          "testing-library/await-async-queries": "off",
          "testing-library/await-async-utils": "off",
          "testing-library/no-await-sync-queries": "off",
          "testing-library/no-unnecessary-act": "off",
          "test-hygiene/no-raw-coordinate-literals": "off",
        },
      },
    ],
  });

  return eslintInstance;
}

function getMemoRanges(sourceFile: ts.SourceFile): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let calleeName = "";
      if (ts.isIdentifier(callee)) {
        calleeName = callee.text;
      } else if (ts.isPropertyAccessExpression(callee)) {
        calleeName = callee.name.text;
      }
      if (calleeName === "useMemo" || calleeName === "useCallback") {
        ranges.push({ start: node.getStart(sourceFile), end: node.getEnd() });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return ranges;
}

function findOutermostObjectInJSX(sourceFile: ts.SourceFile, targetPos: number): ts.ObjectLiteralExpression | null {
  let matched: ts.ObjectLiteralExpression | null = null;
  function visit(node: ts.Node): void {
    if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)) {
      const expr = node.initializer.expression;
      if (expr && ts.isObjectLiteralExpression(expr)) {
        if (targetPos >= expr.getStart(sourceFile) && targetPos <= expr.getEnd()) {
          matched = expr;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return matched;
}

const MAX_SIMPLE_INLINE_PROPERTIES = 4;

function isComplexObjectLiteral(node: ts.ObjectLiteralExpression): boolean {
  // 1. Large property count (> 4 keys)
  if (node.properties.length > MAX_SIMPLE_INLINE_PROPERTIES) return true;

  for (const prop of node.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const init = prop.initializer;
      // 2. Nested objects or arrays (depth > 1)
      if (ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init)) {
        return true;
      }
      // 3. Calculations, template literals, conditionals, or inline functions
      if (
        ts.isTemplateExpression(init) ||
        ts.isBinaryExpression(init) ||
        ts.isConditionalExpression(init) ||
        ts.isArrowFunction(init) ||
        ts.isFunctionExpression(init)
      ) {
        return true;
      }
    }
  }

  return false;
}

function filterMemoizedReactPerfFindings(findings: Finding[], filePath: string, code: string): Finding[] {
  const hasReactPerf = findings.some((finding) => finding.rule.startsWith("react-perf/"));
  if (!hasReactPerf) return findings;

  const isJsx = filePath.endsWith(".tsx") || filePath.endsWith(".jsx");
  if (!isJsx) return findings;

  const sourceFile = createSourceFile(filePath, code);
  const memoRanges = getMemoRanges(sourceFile);
  if (memoRanges.length === 0) return findings;

  return findings.filter((finding) => {
    if (!finding.rule.startsWith("react-perf/")) return true;
    if (finding.line === undefined || finding.column === undefined) return true;

    const pos = sourceFile.getPositionOfLineAndCharacter(finding.line - 1, finding.column - 1);
    const isInsideMemo = memoRanges.some((range) => pos >= range.start && pos <= range.end);

    // Outside memoization: always keep finding
    if (!isInsideMemo) return true;

    // Inside memoization: if it is a complex object (nested, template string, calculation, > 4 props),
    // it MUST be flagged and extracted into a helper or dedicated memo!
    const jsxObject = findOutermostObjectInJSX(sourceFile, pos);
    if (jsxObject && isComplexObjectLiteral(jsxObject)) {
      return true;
    }

    // Simple flat prop forwarders like { cardLink, listing, typename } inside useMemo are fine
    return false;
  });
}

/**
 * Execute configured ESLint rules and plugins on source file code.
 *
 * @param filePath Relative or absolute source file path.
 * @param code Source code contents.
 * @param repoOverrides Optional repository-level rule overrides.
 * @returns Array of ESLint findings.
 */
export async function checkWithEslint(
  filePath: string,
  code: string,
  repoOverrides?: Record<string, unknown>,
): Promise<Finding[]> {
  const isInducedFailure =
    process.env.ANTI_SLOP_INJECT_ESLINT_FAILURE === "true" ||
    (!filePath.endsWith("eslint-runner.ts") &&
      code.includes(["__ANTI", "SLOP_INDUCED_ESLINT_FAILURE__"].join("_")));
  if (isInducedFailure) {
    throw new Error("Induced ESLint checker execution failure");
  }
  const eslint = getEslint();
  const results = await eslint.lintText(code, { filePath });
  const findings: Finding[] = [];

  for (const res of results) {
    for (const msg of res.messages) {
      findings.push({
        check: msg.ruleId?.split("/")[0] || "linter",
        rule: msg.ruleId || "unknown-rule",
        severity: msg.severity === ESLINT_ERROR_SEVERITY ? "error" : "warning",
        message: msg.message,
        file: filePath,
        line: msg.line,
        column: msg.column,
        ...getRuleWhyAndSuggestion(msg.ruleId || ""),
      });
    }
  }

  const filteredFindings = filterMemoizedReactPerfFindings(findings, filePath, code);

  if (repoOverrides && Object.keys(repoOverrides).length > 0) {
    return applyRepoRuleGuard(filteredFindings, repoOverrides);
  }

  return filteredFindings;
}
const RULE_WHY_AND_SUGGESTIONS: Record<string, { why: string; suggestion?: string }> = {
  "slop/no-env-shell-command": {
    why: "Command injection risk: Executing shell commands built from environment variables (e.g. process.env.SHELL or process.env.ComSpec) allows arbitrary command execution if environment variables are modified or untrusted (CWE-78).",
    suggestion: "Hardcode the command or interpreter executable path directly, or validate the environment variable against a strict allowlist before invocation.",
  },
  "use-client/require-use-client": {
    why: "Next.js / RSC architecture: Components without hooks, event handlers, or browser APIs should remain React Server Components to avoid inflating client bundles.",
    suggestion: "Remove 'use client' so the module renders on the server, or add client interactivity if intended.",
  },
  "no-warning-comments": {
    why: "AI planning residue: Test plan annotations, prompt echoes, and scratchpad tickets belong in PRs or issue trackers, not source code.",
    suggestion: "Remove test plan / scratchpad comment headers from source files.",
  },
  "barrel-files/avoid-re-export-all": {
    why: "Wildcard re-exports ('export *') destroy bundler tree-shaking and bloat test runner memory graphs.",
    suggestion: "Use explicit named exports or import directly from the source module.",
  },
  "barrel-files/avoid-barrel-files": {
    why: "Barrel files force bundlers and test runners to load, parse, and compile unused modules, degrading build times and causing circular dependencies.",
    suggestion: "Import directly from specific module paths instead of centralized barrel files.",
  },
  "array-callback-return": {
    why: "Array iteration correctness: Array methods like find, filter, map, every, some, and reduce expect a return value. A missing return statement causes unexpected undefined evaluations and logic defects.",
    suggestion: "Add an explicit return statement returning the condition or value, or use an expression body arrow function.",
  },
  "no-nested-ternary": {
    why: "Readability and control-flow clarity: Nested ternary operators obscure branch conditions and produce high cognitive load.",
    suggestion: "Refactor nested ternary operators into clear if/else statements or a switch block.",
  },
  "@typescript-eslint/explicit-function-return-type": {
    why: "Interface contract clarity: Explicit return type annotations on top-level functions prevent accidental API contract drift.",
    suggestion: "Add an explicit return type annotation to the function signature.",
  },
  "@typescript-eslint/no-unused-vars": {
    why: "Dead code hygiene: Variables declared but never used indicate leftover scaffolding, abandoned logic, or typos.",
    suggestion: "Remove the unused declaration or prefix with '_' if intentionally ignored.",
  },
  "testing-library/no-container": {
    why: "Query resilience: Direct DOM container queries bypass user-facing accessibility semantics and create brittle tests.",
    suggestion: "Query elements by accessible role or label (getByRole, getByLabelText) instead of container traversal.",
  },
  "testing-library/no-node-access": {
    why: "DOM encapsulation: Direct node traversal (children, parentNode) tightly couples tests to transient DOM hierarchies.",
    suggestion: "Use accessible queries or test IDs rather than manual DOM tree traversing.",
  },
  "comment-discipline/no-syntax-restatement": {
    why: "Syntax restatement: Comments that repeat TypeScript types, component names, or parameter names ('Renders X', 'Component properties for X') add cognitive clutter without providing domain context.",
    suggestion: "Remove redundant JSDoc comments that restate what the TypeScript type signatures already communicate.",
  },
  "comment-discipline/no-comment-ratio-inflation": {
    why: "Comment density: Comments significantly longer than the implementation function indicate over-rationalization or tutorial text in source code.",
    suggestion: "Condense the comment to 1-2 lines focusing strictly on non-obvious invariants, or move architectural explanations to the MR description/ADR.",
  },
  "code-smell/no-leaky-conditional-spread": {
    why: "Object spread hygiene: Checking '!== undefined' allows 'null' values to be spread into the target object ({ itemImage: null }), polluting object shape and defeating omission intent.",
    suggestion: "Use '!= null' to safely omit both undefined and null values when constructing objects.",
  },
  "test-hygiene/no-magic-float-assertions": {
    why: "Test clarity: Magic floating-point literals in assertions obscure domain meaning and calculation intent for code readers.",
    suggestion: "Assign the expected value to a meaningful descriptive constant (e.g. 'expectedWidthWhenTabletOrDesktop') or compute it from test parameters.",
  },
  "test-hygiene/no-raw-timer-literals": {
    why: "Test clarity: Raw numeric timer durations in test code obscure whether the delay is a domain-specific threshold or an arbitrary wait time.",
    suggestion: "Assign the timer duration to a descriptive named constant (e.g. 'SCROLL_DEBOUNCE_WAIT_MS' or 'API_TIMEOUT_MS').",
  },
  "test-hygiene/no-raw-coordinate-literals": {
    why: "Test clarity: Large unassigned coordinate integers (> 1000) in tests obscure domain geometry and scroll thresholds for code readers.",
    suggestion: "Assign the coordinate or dimension integer to a meaningful named constant (e.g. 'NEXT_DAY_SCROLL_OFFSET_PX' or 'CONTAINER_WIDTH_PX').",
  },
  "comment-discipline/no-essay-comments": {
    why: "Architectural essay in code: In-depth design debates, benchmark comparisons, and alternative architecture rationales belong in MR descriptions, Jira tickets, or ADRs rather than inline code.",
    suggestion: "Move design justifications and benchmark comparisons to the PR description or an ADR; retain only a concise summary of the active invariant in code.",
  },
};

function getRuleWhyAndSuggestion(ruleId: string): { why?: string; suggestion?: string } {
  const direct = RULE_WHY_AND_SUGGESTIONS[ruleId];
  if (direct) {
    return direct;
  }
  if (ruleId.startsWith("jsdoc/")) {
    return {
      why: "JSDoc syntax hygiene: When JSDoc comments are written, tags, alignments, and parameters must remain accurate.",
      suggestion: "Fix JSDoc alignment and tag names, or remove the obsolete JSDoc comment.",
    };
  }
  if (ruleId.startsWith("de-morgan/")) {
    return {
      why: "Boolean simplification: Negated logical conjunctions/disjunctions increase cognitive load and obscure boolean intent.",
      suggestion: "Apply De Morgan's laws to simplify the negated boolean expression into an equivalent direct expression.",
    };
  }

  return {
    why: `Automated behavioral quality rule (${ruleId})`,
  };
}
