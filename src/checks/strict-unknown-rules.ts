import type { Rule } from "eslint";
import type * as ESTree from "estree";

interface TsAstNode extends ESTree.BaseNode {
  type: string;
  name?: string | undefined;
  id?: TsAstNode | undefined;
  declaration?: TsAstNode | undefined;
  typeAnnotation?: TsAstNode | undefined;
  typeName?: TsAstNode | undefined;
  types?: TsAstNode[] | undefined;
  typeArguments?: { params: TsAstNode[] } | undefined;
  typeParameters?: { params: TsAstNode[] } | undefined;
  body?: TsAstNode[] | undefined;
}

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

function unwrapParenthesizedType(node: TsAstNode | null | undefined): TsAstNode | null {
  let current = node ?? null;
  while (current?.type === "TSParenthesizedType") current = current.typeAnnotation ?? null;

  return current;
}

function collectTypeAliases(program: TsAstNode): Map<string, TsAstNode> {
  const aliases = new Map<string, TsAstNode>();
  for (const statement of program.body ?? []) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "TSTypeAliasDeclaration") continue;
    const name = declaration.id?.name;
    const annotation = declaration.typeAnnotation;
    if (name && annotation) aliases.set(name, annotation);
  }

  return aliases;
}

function firstTypeArgument(node: TsAstNode): TsAstNode | undefined {
  return node.typeArguments?.params[0] ?? node.typeParameters?.params[0];
}

function typeContainsUnknown(node: TsAstNode | null | undefined, aliases: Map<string, TsAstNode>): boolean {
  const typeNode = unwrapParenthesizedType(node);
  if (!typeNode) return false;
  if (typeNode.type === "TSUnknownKeyword") return true;
  if (typeNode.type === "TSUnionType") return (typeNode.types ?? []).some((member) => typeContainsUnknown(member, aliases));
  if (typeNode.type !== "TSTypeReference") return false;

  const name = typeNode.typeName?.name;
  const alias = name ? aliases.get(name) : undefined;

  return alias !== undefined && typeContainsUnknown(alias, aliases);
}

function findUnknownReturnType(node: TsAstNode | null | undefined, aliases: Map<string, TsAstNode>): string | null {
  const typeNode = unwrapParenthesizedType(node);
  if (!typeNode) return null;
  if (typeNode.type === "TSUnknownKeyword") return "unknown";
  if (typeNode.type === "TSUnionType") {
    for (const member of typeNode.types ?? []) {
      const match = findUnknownReturnType(member, aliases);
      if (match) return match;
    }

    return null;
  }
  if (typeNode.type !== "TSTypeReference") return null;

  const name = typeNode.typeName?.name;
  if (name === "Promise" || name === "PromiseLike") {
    const argument = firstTypeArgument(typeNode);
    if (argument && typeContainsUnknown(argument, aliases)) return `${name}<unknown>`;
  }

  const alias = name ? aliases.get(name) : undefined;

  return alias ? findUnknownReturnType(alias, aliases) : null;
}

function checkFunctionReturnType(
  funcNode: TsAstNode,
  context: Rule.RuleContext,
  aliases: Map<string, TsAstNode>,
): void {
  const annotation = funcNode.returnType?.typeAnnotation;
  const match = findUnknownReturnType(annotation, aliases);
  if (!match || !funcNode.returnType) return;

  context.report({
    node: funcNode.returnType,
    messageId: "noUnknownReturn",
    data: { type: match },
  });
}

function buildFunctionListeners(handler: (node: TsAstNode) => void): Rule.RuleListener {
  const listeners: Rule.RuleListener = {};
  for (const nodeType of FUNCTION_NODE_TYPES) listeners[nodeType] = handler;

  return listeners;
}

export const noUnknownReturnsRule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Rejects 'unknown', 'Promise<unknown>', and 'PromiseLike<unknown>' return type annotations (same-file AST only)." },
    schema: [],
    messages: {
      noUnknownReturn: "Avoid '{{type}}' as return type annotation. Return a concrete domain type or generic instead. (Same-file AST only)",
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    let aliases = new Map<string, TsAstNode>();

    return {
      Program(node: TsAstNode) {
        aliases = collectTypeAliases(node);
      },
      ...buildFunctionListeners((node: TsAstNode) => {
        checkFunctionReturnType(node, context, aliases);
      }),
    };
  },
};
