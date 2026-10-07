import type { Rule, Scope } from "eslint";
import type * as ESTree from "estree";
import type { Node as ESTreeNode } from "estree";

const FIRST_ARG_INDEX = 1;
const SECOND_ARG_INDEX = 2;

const CHILD_PROCESS_METHODS: Record<string, true> = {
  exec: true,
  execSync: true,
  spawn: true,
  spawnSync: true,
  execFile: true,
  execFileSync: true,
};

const CHILD_PROCESS_MODULES: Record<string, true> = {
  child_process: true,
  "node:child_process": true,
};

function isProcessEnv(node: ESTreeNode): boolean {
  if (node.type !== "MemberExpression") {
    return false;
  }

  if (isProcessEnv(node.object)) {
    return true;
  }

  if (node.object.type !== "Identifier" || node.object.name !== "process") {
    return false;
  }

  const isNamedEnv = !node.computed && node.property.type === "Identifier" && node.property.name === "env";
  const isLiteralEnv = node.property.type === "Literal" && node.property.value === "env";

  return isNamedEnv || isLiteralEnv;
}

function getPropertyKeyName(prop: ESTree.Property): string | null {
  if (prop.computed) {
    return null;
  }

  if (prop.key.type === "Identifier") {
    return prop.key.name;
  }

  if (prop.key.type === "Literal") {
    return String(prop.key.value);
  }

  return null;
}

function getObjectProperty(init: ESTreeNode, propName: string): ESTreeNode | null {
  if (init.type !== "ObjectExpression") {
    return null;
  }

  for (const prop of init.properties) {
    if (prop.type !== "Property") {
      continue;
    }

    if (getPropertyKeyName(prop) === propName) {
      return prop.value;
    }
  }

  return null;
}

function findConstVariable(
  context: Rule.RuleContext,
  scopeNode: Rule.Node,
  varName: string
): ESTree.VariableDeclarator | null {
  let scope: Scope.Scope | null = context.sourceCode.getScope(scopeNode);
  for (; scope; scope = scope.upper ?? null) {
    const matched = scope.variables.find((candidate) => candidate.name === varName);
    if (!matched) {
      continue;
    }

    for (const def of matched.defs) {
      if (def.type === "Variable" && def.parent.kind === "const") {
        return def.node;
      }
    }
  }

  return null;
}

function getMemberPropertyName(node: ESTree.MemberExpression): string | null {
  if (node.computed) {
    return null;
  }

  if (node.property.type === "Identifier") {
    return node.property.name;
  }

  if (node.property.type === "Literal") {
    return String(node.property.value);
  }

  return null;
}

function checkIdentifierEnv(
  node: ESTree.Identifier,
  context: Rule.RuleContext,
  scopeNode: Rule.Node,
  visited: Set<ESTreeNode>
): boolean {
  const declarator = findConstVariable(context, scopeNode, node.name);
  if (!declarator?.init) {
    return false;
  }

  return isEnvDerived(declarator.init, context, scopeNode, visited);
}

function checkMemberExpressionEnv(
  node: ESTree.MemberExpression,
  context: Rule.RuleContext,
  scopeNode: Rule.Node,
  visited: Set<ESTreeNode>
): boolean {
  if (node.object.type !== "Identifier") {
    return false;
  }

  const declarator = findConstVariable(context, scopeNode, node.object.name);
  if (!declarator?.init) {
    return false;
  }

  const propName = getMemberPropertyName(node);
  if (!propName) {
    return false;
  }

  const propValue = getObjectProperty(declarator.init, propName);

  return isEnvDerived(propValue, context, scopeNode, visited);
}

function isEnvDerived(
  node: ESTreeNode | null | undefined,
  context: Rule.RuleContext,
  scopeNode: Rule.Node,
  visited: Set<ESTreeNode> = new Set()
): boolean {
  if (!node || visited.has(node)) {
    return false;
  }

  visited.add(node);

  if (isProcessEnv(node)) {
    return true;
  }

  if (node.type === "TemplateLiteral") {
    return node.expressions.some((expr) => isEnvDerived(expr, context, scopeNode, visited));
  }

  if (node.type === "BinaryExpression" && node.operator === "+") {
    return isEnvDerived(node.left, context, scopeNode, visited) || isEnvDerived(node.right, context, scopeNode, visited);
  }

  if (node.type === "LogicalExpression") {
    return isEnvDerived(node.left, context, scopeNode, visited) || isEnvDerived(node.right, context, scopeNode, visited);
  }

  if (node.type === "ConditionalExpression") {
    return isEnvDerived(node.consequent, context, scopeNode, visited) || isEnvDerived(node.alternate, context, scopeNode, visited);
  }

  if (node.type === "Identifier") {
    return checkIdentifierEnv(node, context, scopeNode, visited);
  }

  if (node.type === "MemberExpression") {
    return checkMemberExpressionEnv(node, context, scopeNode, visited);
  }

  if (node.type === "ChainExpression") {
    return isEnvDerived(node.expression, context, scopeNode, visited);
  }

  return false;
}

function resolveCallParts(node: ESTreeNode): {
  cmdArg: ESTreeNode | undefined;
  optionsNode: ESTreeNode | undefined;
  argsNode: ESTreeNode | undefined;
} {
  if (node.type !== "CallExpression") {
    return { cmdArg: undefined, optionsNode: undefined, argsNode: undefined };
  }

  const cmdArg = node.arguments.at(0);
  const argFirst = node.arguments.at(FIRST_ARG_INDEX);
  const argSecond = node.arguments.at(SECOND_ARG_INDEX);

  const argsNode = argFirst?.type === "ArrayExpression" ? argFirst : undefined;
  let optionsNode: ESTree.Node | undefined;
  if (argsNode) {
    optionsNode = argSecond?.type === "ObjectExpression" ? argSecond : undefined;
  } else if (argFirst?.type === "ObjectExpression") {
    optionsNode = argFirst;
  }

  return { cmdArg, optionsNode, argsNode };
}

function checkShellOptions(
  optionsNode: ESTreeNode | undefined,
  argsNode: ESTreeNode | undefined,
  context: Rule.RuleContext,
  reportNode: Rule.Node
): boolean {
  if (!optionsNode) {
    return false;
  }

  const shellValue = getObjectProperty(optionsNode, "shell");
  if (!shellValue) {
    return false;
  }

  if (isEnvDerived(shellValue, context, reportNode)) {
    context.report({
      node: reportNode,
      message: "Shell interpreter built from environment variable. Hardcode the command or sanitize/allowlist the env value (CWE-78).",
    });

    return true;
  }

  const isShellTrue = shellValue.type === "Literal" && shellValue.value === true;
  const isArgsArray = argsNode?.type === "ArrayExpression";
  if (isShellTrue && isArgsArray && argsNode.elements.some((elem) => isEnvDerived(elem, context, reportNode))) {
    context.report({
      node: reportNode,
      message: "Shell command argument contains environment variable when shell is enabled. Hardcode the command or sanitize/allowlist the env value (CWE-78).",
    });

    return true;
  }

  return false;
}

function isChildProcessMethodCall(
  node: ESTreeNode,
  childFns: Set<string>,
  childModules: Set<string>
): boolean {
  if (node.type !== "CallExpression") {
    return false;
  }

  if (node.callee.type === "Identifier") {
    return childFns.has(node.callee.name);
  }

  if (node.callee.type === "MemberExpression" && !node.callee.computed) {
    const isModuleObject = node.callee.object.type === "Identifier" && childModules.has(node.callee.object.name);
    const isMethod = node.callee.property.type === "Identifier" && Boolean(CHILD_PROCESS_METHODS[node.callee.property.name]);

    return isModuleObject && isMethod;
  }

  return false;
}

export const noEnvShellCommandRule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Flags child_process execution calls where the command is built from environment variables.",
    },
    schema: [],
  },
  create(context: Rule.RuleContext) {
    const childFunctions = new Set<string>();
    const childModules = new Set<string>();

    return {
      ImportDeclaration(node: Rule.Node) {
        if (node.type !== "ImportDeclaration") {
          return;
        }

        const sourceVal = String(node.source.value);
        if (!CHILD_PROCESS_MODULES[sourceVal]) {
          return;
        }

        for (const spec of node.specifiers) {
          if (spec.type === "ImportSpecifier") {
            const importedName = spec.imported.type === "Identifier" ? spec.imported.name : String(spec.imported.value);
            if (CHILD_PROCESS_METHODS[importedName]) {
              childFunctions.add(spec.local.name);
            }
          } else if (spec.type === "ImportDefaultSpecifier" || spec.type === "ImportNamespaceSpecifier") {
            childModules.add(spec.local.name);
          }
        }
      },

      VariableDeclarator(node: Rule.Node) {
        if (node.type !== "VariableDeclarator") {
          return;
        }

        const init = node.init;
        if (!init || init.type !== "CallExpression" || init.callee.type !== "Identifier" || init.callee.name !== "require") {
          return;
        }

        const firstArg = init.arguments.at(0);
        if (!firstArg || firstArg.type !== "Literal" || !CHILD_PROCESS_MODULES[String(firstArg.value)]) {
          return;
        }

        if (node.id.type === "Identifier") {
          childModules.add(node.id.name);
        } else if (node.id.type === "ObjectPattern") {
          for (const prop of node.id.properties) {
            if (prop.type === "Property" && prop.key.type === "Identifier" && prop.value.type === "Identifier") {
              if (CHILD_PROCESS_METHODS[prop.key.name]) {
                childFunctions.add(prop.value.name);
              }
            }
          }
        }
      },

      CallExpression(node: Rule.Node) {
        if (node.type !== "CallExpression") {
          return;
        }

        if (!isChildProcessMethodCall(node, childFunctions, childModules)) {
          return;
        }

        const { cmdArg, optionsNode, argsNode } = resolveCallParts(node);

        if (checkShellOptions(optionsNode, argsNode, context, node)) {
          return;
        }

        if (isEnvDerived(cmdArg, context, node)) {
          context.report({
            node,
            message: "Shell command built from environment variable. Hardcode the command or sanitize/allowlist the env value (CWE-78).",
          });
        }
      },
    };
  },
};
