import type { Rule } from "eslint";
import type { Identifier } from "estree";

// The `Reflect` identifier of `Reflect.get` / `Reflect.apply`, by dot or string-literal access.
const REFLECT_ESCAPE_SELECTORS: Record<string, string> = {
  "MemberExpression[computed=false][property.name='get'] > Identifier.object[name='Reflect']": "get",
  "MemberExpression[computed=false][property.name='apply'] > Identifier.object[name='Reflect']": "apply",
  "MemberExpression[computed=true][property.value='get'] > Identifier.object[name='Reflect']": "get",
  "MemberExpression[computed=true][property.value='apply'] > Identifier.object[name='Reflect']": "apply",
};

export const noReflectEscapeRule: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: { description: "Flags references to global Reflect.get and Reflect.apply." },
    schema: [],
    messages: {
      noReflectEscape:
        "Avoid 'Reflect.{{method}}' escape hatch. Prefer typed property access, typed function calls, or boundary schema parsing.",
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    return Object.fromEntries(
      Object.entries(REFLECT_ESCAPE_SELECTORS).map(([selector, method]) => [
        selector,
        (node: Identifier) => {
          if (context.sourceCode.isGlobalReference(node)) {
            context.report({ node, messageId: "noReflectEscape", data: { method } });
          }
        },
      ])
    );
  },
};
