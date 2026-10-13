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
  scopeNode: ESTreeNode,
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

interface EnvTrace {
  context: Rule.RuleContext;
  isSource: (node: ESTreeNode) => boolean;
  returnValues: Map<ESTreeNode, ESTreeNode[]>;
}

function appendTo<K, V>(groups: Map<K, V[]>, key: K, value: V): void {
  const group = groups.get(key);
  if (group) {
    group.push(value);

    return;
  }

  groups.set(key, [value]);
}

// Function node of a same-file helper; any other returned node never matches a recorded helper.
function helperKey(call: ESTree.CallExpression, context: Rule.RuleContext): ESTreeNode {
  const reference = context.sourceCode.getScope(call).references.find((ref) => ref.identifier === call.callee);
  const definition = reference?.resolved?.defs.at(0);
  if (definition?.type === "Variable") {
    return definition.node.init ?? definition.node;
  }

  return definition?.type === "FunctionName" ? definition.node : call;
}

function isEnvHelperReturn(call: ESTree.CallExpression, trace: EnvTrace, visited: Set<ESTreeNode>): boolean {
  const values = trace.returnValues.get(helperKey(call, trace.context));

  return Boolean(values?.some((value) => isEnvDerived(value, trace, value, visited)));
}

function checkIdentifierEnv(
  node: ESTree.Identifier,
  trace: EnvTrace,
  scopeNode: ESTreeNode,
  visited: Set<ESTreeNode>
): boolean {
  const declarator = findConstVariable(trace.context, scopeNode, node.name);
  if (!declarator?.init) {
    return false;
  }

  return isEnvDerived(declarator.init, trace, scopeNode, visited);
}

function checkMemberExpressionEnv(
  node: ESTree.MemberExpression,
  trace: EnvTrace,
  scopeNode: ESTreeNode,
  visited: Set<ESTreeNode>
): boolean {
  if (node.object.type !== "Identifier") {
    return false;
  }

  const declarator = findConstVariable(trace.context, scopeNode, node.object.name);
  if (!declarator?.init) {
    return false;
  }

  const propName = getMemberPropertyName(node);
  if (!propName) {
    return false;
  }

  const propValue = getObjectProperty(declarator.init, propName);

  return isEnvDerived(propValue, trace, scopeNode, visited);
}

function isEnvDerived(
  node: ESTreeNode | null | undefined,
  trace: EnvTrace,
  scopeNode: ESTreeNode,
  visited: Set<ESTreeNode> = new Set()
): boolean {
  if (!node || visited.has(node)) {
    return false;
  }

  visited.add(node);

  if (trace.isSource(node)) {
    return true;
  }

  if (node.type === "TemplateLiteral") {
    return node.expressions.some((expr) => isEnvDerived(expr, trace, scopeNode, visited));
  }

  if (node.type === "BinaryExpression" && node.operator === "+") {
    return isEnvDerived(node.left, trace, scopeNode, visited) || isEnvDerived(node.right, trace, scopeNode, visited);
  }

  if (node.type === "LogicalExpression") {
    return isEnvDerived(node.left, trace, scopeNode, visited) || isEnvDerived(node.right, trace, scopeNode, visited);
  }

  if (node.type === "ConditionalExpression") {
    return isEnvDerived(node.consequent, trace, scopeNode, visited) || isEnvDerived(node.alternate, trace, scopeNode, visited);
  }

  if (node.type === "Identifier") {
    return checkIdentifierEnv(node, trace, scopeNode, visited);
  }

  if (node.type === "MemberExpression") {
    return checkMemberExpressionEnv(node, trace, scopeNode, visited);
  }

  if (node.type === "ChainExpression") {
    return isEnvDerived(node.expression, trace, scopeNode, visited);
  }

  if (node.type === "CallExpression") {
    return isEnvHelperReturn(node, trace, visited);
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

function shellOptionsMessage(
  optionsNode: ESTreeNode | undefined,
  argsNode: ESTreeNode | undefined,
  trace: EnvTrace,
  scopeNode: ESTreeNode
): string | null {
  if (!optionsNode) {
    return null;
  }

  const shellValue = getObjectProperty(optionsNode, "shell");
  if (!shellValue) {
    return null;
  }

  if (isEnvDerived(shellValue, trace, scopeNode)) {
    return "Shell interpreter built from environment variable. Hardcode the command or sanitize/allowlist the env value (CWE-78).";
  }

  const isShellTrue = shellValue.type === "Literal" && shellValue.value === true;
  const isArgsArray = argsNode?.type === "ArrayExpression";
  if (isShellTrue && isArgsArray && argsNode.elements.some((elem) => isEnvDerived(elem, trace, scopeNode))) {
    return "Shell command argument contains environment variable when shell is enabled. Hardcode the command or sanitize/allowlist the env value (CWE-78).";
  }

  return null;
}

function commandMessage(call: ESTree.CallExpression, trace: EnvTrace): string | null {
  const { cmdArg, optionsNode, argsNode } = resolveCallParts(call);
  const commandFromSource = isEnvDerived(cmdArg, trace, call)
    ? "Shell command built from environment variable. Hardcode the command or sanitize/allowlist the env value (CWE-78)."
    : null;

  return shellOptionsMessage(optionsNode, argsNode, trace, call) ?? commandFromSource;
}

// Records which parameters of the enclosing function reach this child-process call (one hop, same file).
function collectParameterSinks(call: ESTree.CallExpression, trace: EnvTrace, sinks: Map<ESTreeNode, number[]>): void {
  for (const variable of trace.context.sourceCode.getScope(call).variableScope.variables) {
    const definition = variable.defs.at(0);
    const isParameter = (node: ESTreeNode): boolean => variable.references.some((ref) => ref.identifier === node);
    if (definition?.type === "Parameter" && commandMessage(call, { ...trace, isSource: isParameter })) {
      appendTo(sinks, definition.node, definition.node.params.indexOf(definition.name));
    }
  }
}

function reportHelperCall(call: ESTree.CallExpression, trace: EnvTrace, sinks: Map<ESTreeNode, number[]>): void {
  const indexes = sinks.get(helperKey(call, trace.context));
  if (indexes?.some((index) => isEnvDerived(call.arguments[index], trace, call))) {
    trace.context.report({
      node: call,
      message: "Environment variable passed to a same-file helper that builds a shell command from it. Hardcode the command or sanitize/allowlist the env value (CWE-78).",
    });
  }
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
    const calls: ESTree.CallExpression[] = [];
    const returnValues = new Map<ESTreeNode, ESTreeNode[]>();
    const envTrace: EnvTrace = { context, isSource: isProcessEnv, returnValues };

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

      ReturnStatement(node) {
        appendTo(returnValues, context.sourceCode.getScope(node).variableScope.block, node.argument ?? node);
      },

      ArrowFunctionExpression(node) {
        appendTo(returnValues, node, node.body);
      },

      CallExpression(node: Rule.Node) {
        if (node.type !== "CallExpression") {
          return;
        }

        calls.push(node);
      },

      "Program:exit"() {
        const sinks = new Map<ESTreeNode, number[]>();
        const childCalls = calls.filter((call) => isChildProcessMethodCall(call, childFunctions, childModules));
        for (const call of childCalls) {
          const message = commandMessage(call, envTrace);
          if (message) {
            context.report({ node: call, message });
          }

          collectParameterSinks(call, envTrace, sinks);
        }

        for (const call of calls) {
          reportHelperCall(call, envTrace, sinks);
        }
      },
    };
  },
};
