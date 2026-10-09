import type { Rule } from "eslint";
import type { Comment as ESTreeComment, Node as ESTreeNode } from "estree";

const DEFAULT_MARKERS: readonly string[] = ["SAFETY:"] as const;

export function isAstNode(value: unknown): value is ESTreeNode {
  return typeof value === "object" && value !== null && "type" in value;
}

function isConstAssertion(node: ESTreeNode): boolean {
  if (!("typeAnnotation" in node)) return false;
  const ann: unknown = node.typeAnnotation;
  if (!ann || typeof ann !== "object") return false;
  const annType: string = "type" in ann ? String(ann.type) : "";
  if (annType !== "TSTypeReference") return false;
  if (!("typeName" in ann)) return false;
  const typeName: unknown = ann.typeName;
  if (!typeName || typeof typeName !== "object") return false;
  const typeNameType: string = "type" in typeName ? String(typeName.type) : "";
  if (typeNameType !== "Identifier") return false;

  return "name" in typeName && String(typeName.name) === "const";
}

export function extractCleanComment(commentValue: string): string {
  return commentValue.replaceAll(/^\s*\*+/gm, "").replaceAll(/\s+/g, " ").trim();
}

export function hasValidJustification(
  commentValue: string,
  markers: readonly string[],
): boolean {
  const clean = extractCleanComment(commentValue);
  for (const marker of markers) {
    if (clean.startsWith(marker) && clean.length > marker.length) {
      return true;
    }
  }

  return false;
}

function getAncestorStartLines(node: ESTreeNode): number[] {
  const lines: number[] = [node.loc?.start.line ?? 0];
  let curr: ESTreeNode = node;
  while ("parent" in curr && isAstNode(curr.parent)) {
    const parent: ESTreeNode = curr.parent;
    if (parent.type === "BlockStatement") {
      break;
    }
    if (parent.loc) {
      lines.push(parent.loc.start.line);
    }
    curr = parent;
  }

  return lines;
}

export function isPrecedingComment(
  comment: ESTreeComment,
  ancestorStartLines: readonly number[],
  lines: readonly string[],
): boolean {
  const loc = comment.loc;
  if (!loc) return false;

  for (const startLine of ancestorStartLines) {
    if (loc.end.line === startLine - 1) {
      const lineText = lines[loc.start.line - 1] ?? "";
      const textBefore = lineText.slice(0, loc.start.column).trim();
      if (textBefore.length === 0) {
        return true;
      }
    }
  }

  return false;
}

function hasJustificationOnLines(
  node: ESTreeNode,
  context: Rule.RuleContext,
  markers: readonly string[],
): boolean {
  const nodeLoc = node.loc;
  if (!nodeLoc) return false;

  const nodeStartLine = nodeLoc.start.line;
  const nodeEndLine = nodeLoc.end.line;
  const ancestorStartLines = getAncestorStartLines(node);
  const sourceCode = context.sourceCode;

  for (const comment of sourceCode.getAllComments()) {
    const loc = comment.loc;
    if (!loc) continue;

    const isSameLine = loc.start.line <= nodeEndLine && loc.end.line >= nodeStartLine;

    if (isSameLine || isPrecedingComment(comment, ancestorStartLines, sourceCode.lines)) {
      if (hasValidJustification(comment.value, markers)) {
        return true;
      }
    }
  }

  return false;
}

export const requireAssertionJustificationRule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Requires TypeScript type assertions other than 'as const' to carry an invariant justification comment.",
    },
    schema: [
      {
        type: "object",
        properties: {
          markers: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingJustification:
        "Type assertion requires an invariant justification comment (e.g. '// SAFETY: <reason>') on the same line or immediately preceding line.",
    },
  },
  create(context: Rule.RuleContext) {
    const options = context.options[0];
    const markers =
      typeof options === "object" &&
      options !== null &&
      "markers" in options &&
      Array.isArray(options.markers)
        ? options.markers
        : DEFAULT_MARKERS;
    function checkAssertion(node: ESTreeNode): void {
      if (isConstAssertion(node)) {
        return;
      }
      if (!hasJustificationOnLines(node, context, markers)) {
        context.report({
          node,
          messageId: "missingJustification",
        });
      }
    }

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
};
