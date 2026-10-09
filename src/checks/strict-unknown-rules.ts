import type { Rule } from "eslint";
import type * as ESTree from "estree";

export interface TsAstNode extends ESTree.BaseNode {
  type: string;
  name?: string | undefined;
  id?: TsAstNode | undefined;
  declaration?: TsAstNode | undefined;
  typeAnnotation?: TsAstNode | undefined;
  typeName?: TsAstNode | undefined;
  types?: TsAstNode[] | undefined;
  typeArguments?: TsAstNode | TsAstNode[] | undefined;
  typeParameters?: TsAstNode | undefined;
  params?: TsAstNode[] | undefined;
  left?: TsAstNode | undefined;
  argument?: TsAstNode | undefined;
  parameter?: TsAstNode | undefined;
  parameterName?: TsAstNode | undefined;
  returnType?: TsAstNode | undefined;
  body?: TsAstNode[] | undefined;
}

const MAX_TYPE_RECURSION_DEPTH = 10;
const FUNCTION_NODE_TYPES = [
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "TSFunctionType",
  "TSMethodSignature",
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSConstructorType",
  "TSDeclareFunction",
] as const;

function isAstNode(value: unknown): value is TsAstNode {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

function unwrapParenthesizedType(node: TsAstNode | null | undefined): TsAstNode | null {
  let curr = node;
  while (curr && curr.type === "TSParenthesizedType" && isAstNode(curr.typeAnnotation)) {
    curr = curr.typeAnnotation;
  }

  return curr ?? null;
}

function collectTypeAliases(program: TsAstNode): Map<string, TsAstNode> {
  const aliases = new Map<string, TsAstNode>();
  if (!Array.isArray(program.body)) return aliases;

  for (const stmt of program.body) {
    const decl = stmt.type === "ExportNamedDeclaration" && isAstNode(stmt.declaration) ? stmt.declaration : stmt;
    if (decl.type === "TSTypeAliasDeclaration" && isAstNode(decl.id) && decl.id.name && isAstNode(decl.typeAnnotation)) {
      aliases.set(decl.id.name, decl.typeAnnotation);
    }
  }

  return aliases;
}

function getTypeArguments(node: TsAstNode): TsAstNode[] {
  if (isAstNode(node.typeArguments)) {
    if (Array.isArray(node.typeArguments.params)) return node.typeArguments.params.filter(isAstNode);
    if (Array.isArray(node.typeArguments)) return node.typeArguments.filter(isAstNode);
  }
  if (isAstNode(node.typeParameters) && Array.isArray(node.typeParameters.params)) {
    return node.typeParameters.params.filter(isAstNode);
  }

  return [];
}

function typeContainsUnknown(
  rawNode: TsAstNode | null | undefined,
  typeAliases: Map<string, TsAstNode>,
  depth = 0,
): boolean {
  if (depth > MAX_TYPE_RECURSION_DEPTH) return false;
  const node = unwrapParenthesizedType(rawNode);
  if (!node) return false;
  if (node.type === "TSUnknownKeyword") return true;

  if (node.type === "TSUnionType" && Array.isArray(node.types)) {
    return node.types.some((elem) => isAstNode(elem) && typeContainsUnknown(elem, typeAliases, depth + 1));
  }

  if (node.type === "TSTypeReference" && isAstNode(node.typeName) && node.typeName.name) {
    const alias = typeAliases.get(node.typeName.name);

    return alias !== undefined && typeContainsUnknown(alias, typeAliases, depth + 1);
  }

  return false;
}

function getParameterName(param: TsAstNode): string {
  if (param.type === "Identifier" && param.name) return param.name;
  if (param.type === "AssignmentPattern" && isAstNode(param.left) && param.left.name) return param.left.name;
  if (param.type === "RestElement" && isAstNode(param.argument) && param.argument.name) return param.argument.name;
  if (param.type === "TSParameterProperty" && isAstNode(param.parameter)) return getParameterName(param.parameter);

  return "";
}

function getParameterTypeAnnotation(param: TsAstNode): TsAstNode | null {
  const target = param.type === "TSParameterProperty" && isAstNode(param.parameter) ? param.parameter : param;
  if (isAstNode(target.typeAnnotation?.typeAnnotation)) return target.typeAnnotation.typeAnnotation;
  if (isAstNode(target.left?.typeAnnotation?.typeAnnotation)) return target.left.typeAnnotation.typeAnnotation;

  return null;
}

function getTypePredicateSubjectName(funcNode: TsAstNode): string | null {
  const ret = isAstNode(funcNode.returnType) ? unwrapParenthesizedType(funcNode.returnType.typeAnnotation) : null;
  if (!ret || ret.type !== "TSTypePredicate" || !isAstNode(ret.parameterName)) return null;

  if (ret.parameterName.type === "Identifier" && ret.parameterName.name) return ret.parameterName.name;
  if (ret.parameterName.type === "TSThisType") return "this";

  return null;
}

function checkFunctionParameters(
  funcNode: TsAstNode,
  context: Rule.RuleContext,
  typeAliases: Map<string, TsAstNode>,
): void {
  if (!Array.isArray(funcNode.params)) return;
  const subject = getTypePredicateSubjectName(funcNode);

  for (const param of funcNode.params) {
    if (!isAstNode(param)) continue;
    const name = getParameterName(param);
    if (name === "cause" || (subject !== null && name === subject)) continue;

    const annotation = getParameterTypeAnnotation(param);
    if (typeContainsUnknown(annotation, typeAliases)) {
      context.report({
        node: param,
        messageId: "noUnknownParam",
        data: { name: name.length > 0 ? name : "input" },
      });
    }
  }
}

function checkPromiseReference(
  node: TsAstNode,
  typeAliases: Map<string, TsAstNode>,
  depth: number,
): string | null {
  const name = node.typeName?.name;
  if (!name || (name !== "Promise" && name !== "PromiseLike")) return null;
  const args = getTypeArguments(node);

  return args[0] && typeContainsUnknown(args[0], typeAliases, depth + 1) ? `${name}<unknown>` : null;
}

function checkUnionReturnType(
  node: TsAstNode,
  typeAliases: Map<string, TsAstNode>,
  depth: number,
): string | null {
  if (node.type !== "TSUnionType" || !Array.isArray(node.types)) return null;
  for (const member of node.types) {
    if (!isAstNode(member)) continue;
    const found = checkUnknownReturnType(member, typeAliases, depth + 1);
    if (found) return found;
  }

  return null;
}

function checkReferenceReturnType(
  node: TsAstNode,
  typeAliases: Map<string, TsAstNode>,
  depth: number,
): string | null {
  if (node.type !== "TSTypeReference" || !node.typeName?.name) return null;
  const promiseMatch = checkPromiseReference(node, typeAliases, depth);
  if (promiseMatch) return promiseMatch;
  const alias = typeAliases.get(node.typeName.name);

  return alias ? checkUnknownReturnType(alias, typeAliases, depth + 1) : null;
}

function checkUnknownReturnType(
  rawNode: TsAstNode | null | undefined,
  typeAliases: Map<string, TsAstNode>,
  depth = 0,
): string | null {
  if (depth > MAX_TYPE_RECURSION_DEPTH) return null;
  const node = unwrapParenthesizedType(rawNode);
  if (!node) return null;
  if (node.type === "TSUnknownKeyword") return "unknown";

  const refMatch = checkReferenceReturnType(node, typeAliases, depth);
  if (refMatch) return refMatch;

  return checkUnionReturnType(node, typeAliases, depth);
}

function checkFunctionReturnType(
  funcNode: TsAstNode,
  context: Rule.RuleContext,
  typeAliases: Map<string, TsAstNode>,
): void {
  if (!isAstNode(funcNode.returnType?.typeAnnotation)) return;
  const match = checkUnknownReturnType(funcNode.returnType.typeAnnotation, typeAliases);
  if (match) {
    context.report({
      node: funcNode.returnType,
      messageId: "noUnknownReturn",
      data: { type: match },
    });
  }
}

function buildFunctionListeners(handler: (node: unknown) => void): Rule.RuleListener {
  const listener: Rule.RuleListener = {};
  for (const nodeType of FUNCTION_NODE_TYPES) {
    listener[nodeType] = handler;
  }

  return listener;
}

function createStrictUnknownRule(
  description: string,
  messageId: string,
  message: string,
  checker: (funcNode: TsAstNode, context: Rule.RuleContext, typeAliases: Map<string, TsAstNode>) => void,
): Rule.RuleModule {
  return {
    meta: {
      type: "problem",
      docs: { description },
      schema: [],
      messages: { [messageId]: message },
    },
    create(context: Rule.RuleContext): Rule.RuleListener {
      let typeAliases = new Map<string, TsAstNode>();

      return {
        Program(rawNode: unknown) {
          if (isAstNode(rawNode)) typeAliases = collectTypeAliases(rawNode);
        },
        ...buildFunctionListeners((rawNode) => {
          if (isAstNode(rawNode)) checker(rawNode, context, typeAliases);
        }),
      };
    },
  };
}

export const noUnknownParametersRule: Rule.RuleModule = createStrictUnknownRule(
  "Rejects 'unknown' and unions containing it on function parameters (same-file AST only).",
  "noUnknownParam",
  "Avoid 'unknown' or unions containing 'unknown' on function parameter '{{name}}'. Narrow the contract or validate at the boundary. (Same-file AST only)",
  checkFunctionParameters,
);

export const noUnknownReturnsRule: Rule.RuleModule = createStrictUnknownRule(
  "Rejects 'unknown', 'Promise<unknown>', and 'PromiseLike<unknown>' return type annotations (same-file AST only).",
  "noUnknownReturn",
  "Avoid '{{type}}' as return type annotation. Return a concrete domain type or generic instead. (Same-file AST only)",
  checkFunctionReturnType,
);
