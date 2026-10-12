import type { Rule } from "eslint";
import type { Node as ESTreeNode } from "estree";

// Return annotations that are `unknown`, include it in a union, or pass it as the first Promise/PromiseLike argument.
// Same-file AST only: type aliases are not resolved.
const UNKNOWN_RETURN_SELECTORS: Record<string, string> = {
  "TSTypeAnnotation.returnType > TSUnknownKeyword": "unknown",
  "TSTypeAnnotation.returnType > TSUnionType > TSUnknownKeyword": "unknown",
  "TSTypeAnnotation.returnType > TSTypeReference[typeName.name='Promise'] > TSTypeParameterInstantiation > TSUnknownKeyword:first-child":
    "Promise<unknown>",
  "TSTypeAnnotation.returnType > TSTypeReference[typeName.name='PromiseLike'] > TSTypeParameterInstantiation > TSUnknownKeyword:first-child":
    "PromiseLike<unknown>",
};

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
    return Object.fromEntries(
      Object.entries(UNKNOWN_RETURN_SELECTORS).map(([selector, type]) => [
        selector,
        (node: ESTreeNode) => {
          context.report({ node, messageId: "noUnknownReturn", data: { type } });
        },
      ])
    );
  },
};
