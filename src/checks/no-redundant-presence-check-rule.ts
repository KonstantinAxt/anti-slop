import type { Rule, Scope } from "eslint";
import type * as ESTree from "estree";
import type { Node as ESTreeNode } from "estree";

const MAP_CONSTRUCTOR_NAMES: Record<string, true> = {
  Map: true,
  WeakMap: true,
  ReadonlyMap: true,
};
const THROWING_CALLEE_PATTERN = /^(fail|panic|throw|assert|bail|unreachable|error|raise)/i;
const MIN_MAP_TYPE_ARGUMENTS = 2;
const MAP_VALUE_TYPE_INDEX = 1;

type ReportFn = (
  hasCall: ESTreeNode,
  messageId: "unreachableGuard" | "doubleLookup",
  receiver: ESTreeNode,
  key: ESTreeNode,
) => void;

function isAstNode(value: unknown): value is ESTreeNode {
  return typeof value === "object" && value !== null && "type" in value;
}

function getNodeParent(node: ESTreeNode): ESTreeNode | null {
  if (typeof node === "object" && node !== null && "parent" in node) {
    const parentVal = Reflect.get(node, "parent");
    if (isAstNode(parentVal)) {
      return parentVal;
    }
  }

  return null;
}

function areMemberReceiversEquivalent(
  r1: ESTree.MemberExpression,
  r2: ESTree.MemberExpression,
): boolean {
  if (r1.computed || r2.computed) {
    return false;
  }
  const prop1 = r1.property.type === "Identifier" ? r1.property.name : null;
  const prop2 = r2.property.type === "Identifier" ? r2.property.name : null;
  if (!prop1 || prop1 !== prop2) {
    return false;
  }
  if (r1.object.type === "Super" || r2.object.type === "Super") {
    return false;
  }

  return areReceiversEquivalent(r1.object, r2.object);
}

function areReceiversEquivalent(
  r1: ESTreeNode | null | undefined,
  r2: ESTreeNode | null | undefined,
): boolean {
  if (!r1 || !r2) {
    return false;
  }
  if (r1.type === "Identifier" && r2.type === "Identifier") {
    return r1.name === r2.name;
  }
  if (r1.type === "ThisExpression" && r2.type === "ThisExpression") {
    return true;
  }
  if (r1.type === "MemberExpression" && r2.type === "MemberExpression") {
    return areMemberReceiversEquivalent(r1, r2);
  }

  return false;
}

function areKeysEquivalent(
  k1: ESTreeNode | null | undefined,
  k2: ESTreeNode | null | undefined,
): boolean {
  if (!k1 || !k2) {
    return false;
  }
  if (k1.type === "Identifier" && k2.type === "Identifier") {
    return k1.name === k2.name;
  }
  if (k1.type === "Literal" && k2.type === "Literal") {
    return k1.value === k2.value;
  }

  return false;
}

function getReceiverName(node: ESTreeNode): string {
  if (node.type === "Identifier") {
    return node.name;
  }
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    if (node.object.type === "Super") {
      return `super.${node.property.name}`;
    }

    return `${getReceiverName(node.object)}.${node.property.name}`;
  }
  if (node.type === "ThisExpression") {
    return "this";
  }

  return "receiver";
}

function getKeyName(node: ESTreeNode): string {
  if (node.type === "Identifier") {
    return node.name;
  }
  if (node.type === "Literal") {
    return String(node.value);
  }

  return "key";
}

function isWrappedInAssertionOrCast(node: ESTreeNode): boolean {
  const parent = getNodeParent(node);
  if (!parent) {
    return false;
  }
  const parentType: string = parent.type;

  return (
    parentType === "TSNonNullExpression" ||
    parentType === "TSAsExpression" ||
    parentType === "TSTypeAssertion"
  );
}

function isThrowingCallOrStatement(node: ESTreeNode | null | undefined): boolean {
  if (!node) {
    return false;
  }
  if (node.type === "ThrowStatement") {
    return true;
  }
  if (node.type === "CallExpression") {
    const callee = node.callee;

    return callee.type === "Identifier" && THROWING_CALLEE_PATTERN.test(callee.name);
  }

  return false;
}

function isThrowOnlyConsequent(consequent: ESTreeNode | null | undefined): boolean {
  if (!consequent) {
    return false;
  }
  if (consequent.type === "ThrowStatement") {
    return true;
  }
  if (consequent.type === "ExpressionStatement") {
    return isThrowingCallOrStatement(consequent.expression);
  }
  if (consequent.type === "BlockStatement") {
    if (consequent.body.length === 0) {
      return false;
    }
    const last = consequent.body.at(-1);
    if (!last) {
      return false;
    }
    if (last.type === "ThrowStatement") {
      return true;
    }

    return last.type === "ExpressionStatement" && isThrowingCallOrStatement(last.expression);
  }

  return false;
}

function isBinaryUndefinedCheck(node: ESTree.BinaryExpression, varName: string): boolean {
  if (node.operator !== "===" && node.operator !== "==") {
    return false;
  }
  const isLeftMatch = node.left.type === "Identifier" && node.left.name === varName;
  const isRightMatch = node.right.type === "Identifier" && node.right.name === varName;
  if (!isLeftMatch && !isRightMatch) {
    return false;
  }
  const other = isLeftMatch ? node.right : node.left;
  const isIdent = other.type === "Identifier" && (other.name === "undefined" || other.name === "null");
  const isLit = other.type === "Literal" && other.value === null;

  return isIdent || isLit;
}

function isNullOrUndefinedCheck(test: ESTreeNode | null | undefined, varName: string): boolean {
  if (!test) {
    return false;
  }
  if (test.type === "BinaryExpression") {
    return isBinaryUndefinedCheck(test, varName);
  }
  if (test.type === "UnaryExpression" && test.operator === "!") {
    return test.argument.type === "Identifier" && test.argument.name === varName;
  }
  if (test.type === "LogicalExpression" && (test.operator === "||" || test.operator === "??")) {
    return isNullOrUndefinedCheck(test.left, varName) || isNullOrUndefinedCheck(test.right, varName);
  }

  return false;
}

function valueTypeContainsUndefined(typeNode: unknown): boolean {
  if (!typeNode || typeof typeNode !== "object" || !("type" in typeNode)) {
    return true;
  }
  const nodeType = String(Reflect.get(typeNode, "type"));
  if (nodeType === "TSUndefinedKeyword" || nodeType === "TSAnyKeyword" || nodeType === "TSUnknownKeyword" || nodeType === "TSVoidKeyword") {
    return true;
  }
  if (nodeType === "TSUnionType" && "types" in typeNode) {
    const typesList = Reflect.get(typeNode, "types");
    if (Array.isArray(typesList)) {
      return typesList.some((inner) => valueTypeContainsUndefined(inner));
    }
  }

  return false;
}

function extractFromTypeAnnotation(target: unknown): unknown[] | null {
  if (!target || typeof target !== "object" || !("typeAnnotation" in target)) {
    return null;
  }
  const wrapper = Reflect.get(target, "typeAnnotation");
  if (!wrapper || typeof wrapper !== "object" || !("typeAnnotation" in wrapper)) {
    return null;
  }
  const typeRef = Reflect.get(wrapper, "typeAnnotation");
  if (!typeRef || typeof typeRef !== "object" || !("typeName" in typeRef)) {
    return null;
  }
  const typeNameNode = Reflect.get(typeRef, "typeName");
  if (!typeNameNode || typeof typeNameNode !== "object" || !("name" in typeNameNode)) {
    return null;
  }
  const typeName = String(Reflect.get(typeNameNode, "name"));
  if (!MAP_CONSTRUCTOR_NAMES[typeName]) {
    return null;
  }
  const paramsWrapper = Reflect.get(typeRef, "typeArguments") ?? Reflect.get(typeRef, "typeParameters");
  if (paramsWrapper && typeof paramsWrapper === "object" && "params" in paramsWrapper && Array.isArray(paramsWrapper.params)) {
    return paramsWrapper.params;
  }

  return [];
}

function extractFromNewExpression(init: unknown): unknown[] | null {
  if (!init || typeof init !== "object" || Reflect.get(init, "type") !== "NewExpression") {
    return null;
  }
  const callee = Reflect.get(init, "callee");
  if (!callee || typeof callee !== "object" || !("name" in callee)) {
    return null;
  }
  const calleeName = String(Reflect.get(callee, "name"));
  if (!MAP_CONSTRUCTOR_NAMES[calleeName]) {
    return null;
  }
  const paramsWrapper = Reflect.get(init, "typeArguments") ?? Reflect.get(init, "typeParameters");
  if (paramsWrapper && typeof paramsWrapper === "object" && "params" in paramsWrapper && Array.isArray(paramsWrapper.params)) {
    return paramsWrapper.params;
  }

  return [];
}

function resolveMapInfoFromAnnotationOrInit(
  typeAnnotationTarget: unknown,
  init: unknown,
): { isMap: boolean; valueTypeIncludesUndefined: boolean } | null {
  const typeArgs = extractFromTypeAnnotation(typeAnnotationTarget) ?? extractFromNewExpression(init);
  if (!typeArgs) {
    return null;
  }

  if (typeArgs.length < MIN_MAP_TYPE_ARGUMENTS) {
    return { isMap: true, valueTypeIncludesUndefined: true };
  }

  const valType = typeArgs[MAP_VALUE_TYPE_INDEX];

  return {
    isMap: true,
    valueTypeIncludesUndefined: valueTypeContainsUndefined(valType),
  };
}

function resolveIdentifierReceiver(
  receiverNode: ESTree.Identifier,
  context: Rule.RuleContext,
): { isMap: boolean; valueTypeIncludesUndefined: boolean } | null {
  const varName = receiverNode.name;
  let currentScope: Scope.Scope | null = context.sourceCode.getScope(receiverNode);

  while (currentScope) {
    const matched = currentScope.variables.find((candidate) => candidate.name === varName);
    if (matched) {
      for (const def of matched.defs) {
        if (def.type === "Variable") {
          const decl = def.node;

          return resolveMapInfoFromAnnotationOrInit(decl.id, decl.init);
        }
        if (def.type === "Parameter") {
          return resolveMapInfoFromAnnotationOrInit(def.name, null);
        }
      }
    }
    currentScope = currentScope.upper;
  }

  return null;
}

function resolveThisMemberReceiver(
  receiverNode: ESTree.MemberExpression,
): { isMap: boolean; valueTypeIncludesUndefined: boolean } | null {
  const propName = receiverNode.property.type === "Identifier" ? receiverNode.property.name : null;
  if (!propName) {
    return null;
  }

  let current = getNodeParent(receiverNode);
  while (current && current.type !== "ClassDeclaration" && current.type !== "ClassExpression") {
    current = getNodeParent(current);
  }
  if (!current || (current.type !== "ClassDeclaration" && current.type !== "ClassExpression")) {
    return null;
  }

  for (const member of current.body.body) {
    if (member.type === "PropertyDefinition" && member.key.type === "Identifier" && member.key.name === propName) {
      return resolveMapInfoFromAnnotationOrInit(member, member.value);
    }
  }

  return null;
}

function resolveReceiverInfo(
  receiverNode: ESTreeNode,
  context: Rule.RuleContext,
): { isMap: boolean; valueTypeIncludesUndefined: boolean } | null {
  if (receiverNode.type === "Identifier") {
    return resolveIdentifierReceiver(receiverNode, context);
  }
  if (receiverNode.type === "MemberExpression" && receiverNode.object.type === "ThisExpression") {
    return resolveThisMemberReceiver(receiverNode);
  }

  return null;
}

function checkChildItem(item: unknown, visitor: (child: ESTreeNode) => boolean): boolean {
  if (isAstNode(item)) {
    return visitor(item);
  }

  return false;
}

function visitPropertyChild(child: unknown, visitor: (child: ESTreeNode) => boolean): boolean {
  if (Array.isArray(child)) {
    return child.some((item) => checkChildItem(item, visitor));
  }

  return checkChildItem(child, visitor);
}

function visitChildNodes(node: ESTreeNode, visitor: (child: ESTreeNode) => boolean): boolean {
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range") {
      continue;
    }
    const child = Reflect.get(node, key);
    if (visitPropertyChild(child, visitor)) {
      return true;
    }
  }

  return false;
}

function containsCallOrMutation(
  node: ESTreeNode | null | undefined,
  receiverNode: ESTreeNode,
  keyNode: ESTreeNode,
  targetGetNode: ESTreeNode | null = null,
): boolean {
  if (!node || (targetGetNode && node === targetGetNode)) {
    return false;
  }
  if (node.type === "CallExpression") {
    return true;
  }
  if (node.type === "AssignmentExpression") {
    if (node.left.type !== "MemberExpression" && node.left.type !== "Identifier") {
      return false;
    }

    return areReceiversEquivalent(node.left, receiverNode) || areKeysEquivalent(node.left, keyNode);
  }
  if (node.type === "UpdateExpression") {
    return areReceiversEquivalent(node.argument, receiverNode) || areKeysEquivalent(node.argument, keyNode);
  }

  return visitChildNodes(node, (child) => containsCallOrMutation(child, receiverNode, keyNode, targetGetNode));
}

function isFunctionOrClassBoundary(node: ESTreeNode): boolean {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ClassDeclaration" ||
    node.type === "ClassExpression"
  );
}

function findGetCallInNode(
  node: ESTreeNode | null | undefined,
  receiverNode: ESTreeNode,
  keyNode: ESTreeNode,
): ESTreeNode | null {
  if (!node || isFunctionOrClassBoundary(node)) {
    return null;
  }

  if (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "get" &&
    node.arguments.length === 1
  ) {
    const firstArg = node.arguments.at(0);
    const isReceiverMatch = node.callee.object.type !== "Super" && areReceiversEquivalent(node.callee.object, receiverNode);
    if (firstArg && firstArg.type !== "SpreadElement" && isReceiverMatch && areKeysEquivalent(firstArg, keyNode)) {
      return node;
    }
  }

  let found: ESTreeNode | null = null;
  visitChildNodes(node, (child) => {
    found = findGetCallInNode(child, receiverNode, keyNode);

    return found !== null;
  });

  return found;
}

function extractHasCallParts(node: ESTreeNode | null | undefined): { receiver: ESTreeNode; key: ESTreeNode } | null {
  if (
    !node ||
    node.type !== "CallExpression" ||
    node.callee.type !== "MemberExpression" ||
    node.callee.computed ||
    node.callee.property.type !== "Identifier" ||
    node.callee.property.name !== "has" ||
    node.arguments.length !== 1
  ) {
    return null;
  }
  if (node.callee.object.type === "Super") {
    return null;
  }
  const firstArg = node.arguments.at(0);
  if (!firstArg || firstArg.type === "SpreadElement") {
    return null;
  }

  return {
    receiver: node.callee.object,
    key: firstArg,
  };
}

function extractBinaryNegatedHas(node: ESTree.BinaryExpression): ESTreeNode | null {
  const { operator, left, right } = node;
  if (operator === "===" || operator === "==") {
    if (right.type === "Literal" && right.value === false && left.type !== "PrivateIdentifier" && extractHasCallParts(left)) {
      return left;
    }
    if (left.type === "Literal" && left.value === false && extractHasCallParts(right)) {
      return right;
    }
  }
  if (operator === "!==" || operator === "!=") {
    if (right.type === "Literal" && right.value === true && left.type !== "PrivateIdentifier" && extractHasCallParts(left)) {
      return left;
    }
    if (left.type === "Literal" && left.value === true && extractHasCallParts(right)) {
      return right;
    }
  }

  return null;
}

function extractNegatedHasCall(testNode: ESTreeNode | null | undefined): ESTreeNode | null {
  if (!testNode) {
    return null;
  }
  if (testNode.type === "UnaryExpression" && testNode.operator === "!") {
    const parts = extractHasCallParts(testNode.argument);

    return parts ? testNode.argument : null;
  }
  if (testNode.type === "BinaryExpression") {
    return extractBinaryNegatedHas(testNode);
  }

  return null;
}

function isTerminalEarlyExit(node: ESTreeNode | null | undefined): boolean {
  if (!node) {
    return false;
  }
  if (
    node.type === "ReturnStatement" ||
    node.type === "ThrowStatement" ||
    node.type === "BreakStatement" ||
    node.type === "ContinueStatement"
  ) {
    return true;
  }
  if (node.type === "BlockStatement" && node.body.length > 0) {
    const last = node.body.at(-1);

    return isTerminalEarlyExit(last);
  }

  return false;
}

function isNullishThrowGuard(getCall: ESTreeNode): boolean {
  const parent = getNodeParent(getCall);
  if (parent && parent.type === "LogicalExpression" && parent.operator === "??" && parent.left === getCall) {
    return isThrowingCallOrStatement(parent.right);
  }

  return false;
}

function checkNextStatementForUnreachableGuard(nextStmt: ESTreeNode | undefined, varName: string): boolean {
  if (!nextStmt || nextStmt.type !== "IfStatement") {
    return false;
  }

  return (
    isNullOrUndefinedCheck(nextStmt.test, varName) &&
    isThrowOnlyConsequent(nextStmt.consequent) &&
    !nextStmt.alternate
  );
}

function isStatementUnreachableGuard(stmt: ESTreeNode, getCall: ESTreeNode, nextStmt: ESTreeNode | undefined): boolean {
  if (isNullishThrowGuard(getCall)) {
    return true;
  }
  if (stmt.type === "VariableDeclaration" && stmt.declarations.length === 1) {
    const decl = stmt.declarations[0];
    if (decl && decl.id.type === "Identifier" && decl.init === getCall) {
      return checkNextStatementForUnreachableGuard(nextStmt, decl.id.name);
    }
  }

  return false;
}

function getValidMapReceiver(
  hasCall: ESTreeNode,
  context: Rule.RuleContext,
): { receiver: ESTreeNode; key: ESTreeNode } | null {
  const parts = extractHasCallParts(hasCall);
  if (!parts) {
    return null;
  }
  const mapInfo = resolveReceiverInfo(parts.receiver, context);
  if (!mapInfo || !mapInfo.isMap || mapInfo.valueTypeIncludesUndefined) {
    return null;
  }

  return parts;
}

export const noRedundantPresenceCheckRule: Rule.RuleModule = {
  meta: {
    type: "problem",
    hasSuggestions: true,
    docs: {
      description: "Flags redundant Map#has presence checks before Map#get calls.",
    },
    schema: [],
    messages: {
      unreachableGuard:
        "Redundant presence check: '{{receiver}}' was checked with 'has({{key}})' before 'get({{key}})' with an unreachable guard. Look up the key once and narrow the result.",
      doubleLookup:
        "Redundant presence check: '{{receiver}}' was checked with 'has({{key}})' before 'get({{key}})'. Look up the key once with 'get({{key}})'.",
      suggestNarrow: "Look up the key once with get() and narrow on the result.",
    },
  },
  create(context: Rule.RuleContext) {
    const report: ReportFn = (hasCall, messageId, receiver, key) => {
      const receiverName = getReceiverName(receiver);
      const keyName = getKeyName(key);
      const loc = hasCall.loc ?? {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 0 },
      };
      const rangeStart = hasCall.range?.[0] ?? 0;

      context.report({
        loc,
        messageId,
        data: {
          receiver: receiverName,
          key: keyName,
        },
        suggest: [
          {
            messageId: "suggestNarrow",
            fix(fixer) {
              return fixer.insertTextBeforeRange([rangeStart, rangeStart], "/* suggestion: look up key once with .get() */ ");
            },
          },
        ],
      });
    };

    function checkStatementsSequence(
      stmts: ESTreeNode[],
      startIndex: number,
      hasCall: ESTreeNode,
      receiver: ESTreeNode,
      key: ESTreeNode,
    ): boolean {
      for (let i = startIndex; i < stmts.length; i++) {
        const stmt = stmts[i];
        if (!stmt) {
          continue;
        }
        const getCall = findGetCallInNode(stmt, receiver, key);
        if (!getCall) {
          if (containsCallOrMutation(stmt, receiver, key)) {
            return false;
          }
          continue;
        }

        if (isWrappedInAssertionOrCast(getCall)) {
          return false;
        }

        const nextStmt = stmts[i + 1];
        const isUnreachable = isStatementUnreachableGuard(stmt, getCall, nextStmt);
        const messageId = isUnreachable ? "unreachableGuard" : "doubleLookup";
        report(hasCall, messageId, receiver, key);

        return true;
      }

      return false;
    }

    function checkTernary(node: ESTree.ConditionalExpression): void {
      const parts = getValidMapReceiver(node.test, context);
      if (!parts) {
        return;
      }
      const { receiver, key } = parts;
      const getCall = findGetCallInNode(node.consequent, receiver, key);
      if (!getCall || isWrappedInAssertionOrCast(getCall) || containsCallOrMutation(node.consequent, receiver, key, getCall)) {
        return;
      }

      report(node.test, "doubleLookup", receiver, key);
    }

    function checkIfStatement(node: ESTree.IfStatement): void {
      const parts = getValidMapReceiver(node.test, context);
      if (!parts) {
        return;
      }
      const { receiver, key } = parts;
      const consequent = node.consequent;
      if (consequent.type !== "BlockStatement") {
        const getCall = findGetCallInNode(consequent, receiver, key);
        if (getCall && !isWrappedInAssertionOrCast(getCall)) {
          report(node.test, "doubleLookup", receiver, key);
        }

        return;
      }

      checkStatementsSequence(consequent.body, 0, node.test, receiver, key);
    }

    function checkStatementsForEarlyReturn(
      stmts: (ESTree.Statement | ESTree.ModuleDeclaration | ESTree.Directive)[],
    ): void {
      for (let i = 0; i < stmts.length; i++) {
        const stmt = stmts[i];
        if (!stmt || stmt.type !== "IfStatement") {
          continue;
        }
        const hasCall = extractNegatedHasCall(stmt.test);
        if (!hasCall || !isTerminalEarlyExit(stmt.consequent)) {
          continue;
        }
        const parts = getValidMapReceiver(hasCall, context);
        if (!parts) {
          continue;
        }
        const reported = checkStatementsSequence(stmts, i + 1, hasCall, parts.receiver, parts.key);
        if (reported) {
          return;
        }
      }
    }

    return {
      ConditionalExpression: checkTernary,
      IfStatement: checkIfStatement,
      BlockStatement(node) {
        checkStatementsForEarlyReturn(node.body);
      },
      Program(node) {
        checkStatementsForEarlyReturn(node.body);
      },
    };
  },
};
