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

const PARAMETER_OWNERS =
  ":matches(:function, TSDeclareFunction, TSEmptyBodyFunctionExpression, TSMethodSignature, TSFunctionType, TSConstructorType, TSCallSignatureDeclaration, TSConstructSignatureDeclaration)";

const UNKNOWN_PARAMETER = `${PARAMETER_OWNERS} > Identifier.params[name!='cause'] > TSTypeAnnotation >`;

// Selector for an `unknown` keyword in a parameter annotation, mapped to the parameter's depth above that keyword.
const UNKNOWN_PARAMETER_SELECTORS: Record<string, number> = {
  [`${UNKNOWN_PARAMETER} TSUnknownKeyword`]: 2,
  [`${UNKNOWN_PARAMETER} TSUnionType > TSUnknownKeyword`]: 3,
};

// Parameters typed `unknown` or a union containing it. `cause` and the exact type-predicate subject are allowed.
// Same-file AST only: type aliases are not resolved.
export const noUnknownParametersRule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Rejects 'unknown' parameter type annotations, except 'cause' and type-predicate subjects (same-file AST only)." },
    schema: [],
    messages: {
      noUnknownParameter: "Avoid 'unknown' on parameter '{{name}}'. Accept a concrete domain type or generic, and parse at the boundary. (Same-file AST only)",
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const { sourceCode } = context;
    const candidates = new Map<ESTreeNode, { name: string; owner: ESTreeNode | undefined }>();
    const predicateSubjects = new Map<ESTreeNode | undefined, string>();
    return {
      ...Object.fromEntries(
        Object.entries(UNKNOWN_PARAMETER_SELECTORS).map(([selector, depth]) => [
          selector,
          (node: ESTreeNode) => {
            const ancestors = sourceCode.getAncestors(node);
            // An annotated parameter's text is its name, an optional '?', then the annotation.
            const parameterText = sourceCode.getText(ancestors.at(-depth));
            const nameText = parameterText.slice(0, parameterText.length - sourceCode.getText(ancestors.at(1 - depth)).length);
            candidates.set(node, { name: nameText.replace("?", ""), owner: ancestors.at(-depth - 1) });
          },
        ])
      ),
      "TSTypePredicate > Identifier.parameterName"(node: ESTreeNode) {
        predicateSubjects.set(sourceCode.getAncestors(node).at(-3), sourceCode.getText(node));
      },
      "Program:exit"() {
        for (const [node, { name, owner }] of candidates) {
          if (predicateSubjects.get(owner) !== name) {
            context.report({ node, messageId: "noUnknownParameter", data: { name } });
          }
        }
      },
    };
  },
};

const OPEN_VALUE_TYPES = ":matches(TSUnknownKeyword, TSAnyKeyword, TSObjectKeyword, TSTypeLiteral[members.length=0])";

// Dictionary value contracts of unknown, any, object or {}. Generic constraints such as `T extends Record<string, unknown>` are allowed.
const OPEN_DICTIONARY_SELECTORS: Record<string, string> = {
  [`TSTypeReference[typeName.name='Record']:not(TSTypeParameter > TSTypeReference) > TSTypeParameterInstantiation > ${OPEN_VALUE_TYPES}:nth-child(2)`]:
    "Record value",
  [`TSIndexSignature > TSTypeAnnotation > ${OPEN_VALUE_TYPES}`]: "index signature value",
};

export const noUnknownDictionaryValuesRule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Rejects dictionary value types of 'unknown', 'any', 'object' or '{}' (same-file AST only)." },
    schema: [],
    messages: {
      noOpenDictionaryValue: "Avoid '{{type}}' as {{kind}} type. Use a concrete value type, a generic, or a parsed schema type. (Same-file AST only)",
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    return Object.fromEntries(
      Object.entries(OPEN_DICTIONARY_SELECTORS).map(([selector, kind]) => [
        selector,
        (node: ESTreeNode) => {
          context.report({ node, messageId: "noOpenDictionaryValue", data: { kind, type: context.sourceCode.getText(node) } });
        },
      ])
    );
  },
};
