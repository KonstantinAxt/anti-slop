import type { Rule, Scope } from "eslint";
import type * as ESTree from "estree";

const ESCAPE_PROPERTIES: Record<string, true> = {
  get: true,
  apply: true,
};

function isGlobalReflect(node: ESTree.Node, context: Rule.RuleContext): boolean {
  if (node.type !== "Identifier" || node.name !== "Reflect") {
    return false;
  }

  let scope: Scope.Scope | null = context.sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get("Reflect");
    if (variable) {
      return variable.defs.length === 0;
    }
    scope = scope.upper;
  }

  return true;
}

export const noReflectEscapeRule: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Flags calls and references to global Reflect.get and Reflect.apply.",
    },
    schema: [],
    messages: {
      noReflectEscape:
        "Avoid 'Reflect.{{method}}' escape hatch. Prefer typed property access, typed function calls, or boundary schema parsing.",
    },
  },
  create(context: Rule.RuleContext) {
    return {
      MemberExpression(node: ESTree.MemberExpression) {
        if (!isGlobalReflect(node.object, context)) {
          return;
        }

        const propName = !node.computed
          ? node.property.type === "Identifier"
            ? node.property.name
            : null
          : node.property.type === "Literal" && typeof node.property.value === "string"
            ? node.property.value
            : null;

        if (propName && ESCAPE_PROPERTIES[propName]) {
          context.report({
            node,
            messageId: "noReflectEscape",
            data: { method: propName },
          });
        }
      },
    };
  },
};
