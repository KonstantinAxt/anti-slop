import {
  formatCrapReport,
  DEFAULT_CRAP_THRESHOLD,
  CRAP_LOW_RISK_THRESHOLD,
} from "./checks/crap-runner.js";
import type { AntiSlopResult, CrapEntry, Finding } from "./types.js";
const JSON_INDENT = 2;


/**
 * Format anti-slop findings and metrics for terminal, LLM, or JSON presentation.
 *
 * @param result Anti-slop scan result.
 * @param format Target output format identifier.
 * @returns Formatted output report string.
 */
export function formatOutput(
  result: AntiSlopResult,
  format: "terminal" | "llm" | "json" = "terminal"
): string {
  switch (format) {
    case "json":
      return JSON.stringify(result, null, JSON_INDENT);
    case "llm":
      return formatLlmPrompt(result);
    case "terminal":
    default:
      return formatTerminal(result);
  }
}
function getIncompleteCheckDetails(result: AntiSlopResult): { isIncomplete: boolean; failedChecks: string[] } {
  const isIncomplete = result.status === "incomplete" || result.completedAllChecks === false;
  const failedChecks = Object.entries(result.checks ?? {})
    .filter(([_, chk]) => chk.status === "failed")
    .map(([name, chk]) => `${name}: ${chk.error ?? "failed"}`);

  return { isIncomplete, failedChecks };
}


function formatLlmPrompt(result: AntiSlopResult): string {
  const errors = result.findings.filter((finding) => finding.severity === "error");
  const warnings = result.findings.filter((finding) => finding.severity === "warning");
  const { isIncomplete, failedChecks } = getIncompleteCheckDetails(result);

  let statusText = "PASS (No anti-slop violations detected)";
  if (isIncomplete) {
    statusText = `INCOMPLETE (${failedChecks.length > 0 ? failedChecks.join("; ") : "one or more checks failed"})`;
  } else if (!result.passed) {
    statusText = `FAIL (${errors.length} errors, ${warnings.length} warnings)`;
  }

  const lines: string[] = [
    "# Anti-AI Slop Review Findings",
    "",
    `**Status:** ${statusText} across ${result.totalFilesChecked} files (${result.durationMs}ms).`,
    "",
  ];
  if (result.crapEntries && result.crapEntries.length > 0) {
    lines.push("## CRAP (Change Risk Anti-Pattern) Report");
    lines.push("");
    lines.push(formatCrapMarkdown(result.crapEntries));
    lines.push("");
  }
  if (result.mutationMetrics) {
    const metrics = result.mutationMetrics;
    lines.push(`**Mutation Score:** ${metrics.score.toFixed(1)}% (${metrics.killed} killed, ${metrics.survived} survived, ${metrics.noCoverage} uncovered, ${metrics.timeout} timeout)`);
    lines.push("");
  }

  if (result.findings.length === 0) {
    if (isIncomplete) {
      lines.push("Scan incomplete: one or more quality checks failed during execution.");
    } else {
      lines.push("No deterministic anti-slop violations detected.");
    }

    return lines.join("\n");
  }

  lines.push("## Violations");
  lines.push("");

  result.findings.forEach((finding, idx) => {
    const icon = finding.severity === "error" ? "[ERROR]" : "[WARN]";
    lines.push(`### ${idx + 1}. ${icon} \`${finding.rule}\` (${finding.check})`);
    lines.push(`- **Location:** \`${finding.file}:${finding.line}:${finding.column}\``);
    lines.push(`- **Problem:** ${finding.message}`);

    if (finding.excerpt) {
      lines.push("- **Code Excerpt:**");
      lines.push("```typescript");
      lines.push(finding.excerpt);
      lines.push("```");
    }

    if (finding.why) {
      lines.push(`- **Why it matters:** ${finding.why}`);
    }

    if (finding.suggestion) {
      lines.push(`- **Remediation:** ${finding.suggestion}`);
    }

    lines.push("");
  });

  return lines.join("\n");
}

function formatCrapMarkdown(entries: CrapEntry[]): string {
  const sorted = [...entries].sort((first, second) => second.crap - first.crap);
  const lines = [
    "| Function | File | CC | Cov% | CRAP | Risk |",
    "|---|---|---|---|---|---|",
  ];

  for (const entry of sorted) {
    let risk = "Low";
    if (entry.crap > DEFAULT_CRAP_THRESHOLD) {
      risk = "**High**";
    } else if (entry.crap > CRAP_LOW_RISK_THRESHOLD) {
      risk = "Moderate";
    }
    lines.push(
      `| \`${entry.functionName}\` | \`${entry.file}\` | ${entry.complexity} | ${entry.coverage.toFixed(1)}% | ${entry.crap.toFixed(1)} | ${risk} |`
    );
  }

  return lines.join("\n");
}

function formatCrapTerminal(entries: CrapEntry[]): string {
  return formatCrapReport(entries, { useColor: true });
}

function formatFinding(finding: Finding): string[] {
  const RED = "\x1b[31m";
  const YELLOW = "\x1b[33m";
  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";

  const tag =
    finding.severity === "error"
      ? `${RED}error${RESET}`
      : `${YELLOW}warn${RESET}`;
  const lines = [
    `  ${DIM}${finding.line}:${finding.column}${RESET}  ${tag}  ${finding.message}  ${DIM}(${finding.rule})${RESET}`,
  ];
  if (finding.excerpt) {
    lines.push(`    ${DIM}│${RESET}  ${finding.excerpt}`);
  }
  if (finding.suggestion) {
    lines.push(`    ${DIM}↳ fix: ${finding.suggestion}${RESET}`);
  }

  return lines;
}

function formatTerminal(result: AntiSlopResult): string {
  const lines: string[] = [];

  const RED = "\x1b[31m";
  const YELLOW = "\x1b[33m";
  const GREEN = "\x1b[32m";
  const CYAN = "\x1b[36m";
  const BOLD = "\x1b[1m";
  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";

  lines.push("");
  lines.push(`${BOLD}🛡️  anti-slop - Deterministic Code Review Gate${RESET}`);
  lines.push(`${DIM}Catches structural defects and shortcuts before code review${RESET}`);
  lines.push("");
  const { isIncomplete, failedChecks } = getIncompleteCheckDetails(result);

  if (isIncomplete) {
    lines.push(`${BOLD}${RED}✖ Scan incomplete:${RESET} ${failedChecks.length > 0 ? failedChecks.join("; ") : "one or more checks failed"}`);
    lines.push("");
  }

  if (result.crapEntries && result.crapEntries.length > 0) {
    lines.push(formatCrapTerminal(result.crapEntries));
    lines.push("");
  }
  if (result.mutationMetrics) {
    const metrics = result.mutationMetrics;
    const scorePassingThreshold = 80;
    const scoreColor = metrics.score >= scorePassingThreshold ? GREEN : RED;
    lines.push(`Mutation Score: ${scoreColor}${BOLD}${metrics.score.toFixed(1)}%${RESET} (${metrics.killed} killed, ${metrics.survived} survived, ${metrics.noCoverage} uncovered, ${metrics.timeout} timeout)`);
    lines.push("");
  }

  if (result.findings.length === 0) {
    if (isIncomplete) {
      lines.push(`${RED}✖ Scan incomplete!${RESET} Checked ${result.totalFilesChecked} files in ${result.durationMs}ms, but one or more checker families failed.`);
    } else {
      lines.push(`${GREEN}✔ All checks passed!${RESET} Scanned ${result.totalFilesChecked} files in ${result.durationMs}ms.`);
    }
    lines.push("");

    return lines.join("\n");
  }

  const byFile: Record<string, Finding[]> = {};
  for (const finding of result.findings) {
    (byFile[finding.file] ??= []).push(finding);
  }

  for (const [file, fileFindings] of Object.entries(byFile)) {
    lines.push(`${BOLD}${CYAN}${file}${RESET}`);
    for (const finding of fileFindings) {
      lines.push(...formatFinding(finding));
    }
    lines.push("");
  }

  const errors = result.findings.filter((finding) => finding.severity === "error").length;
  const warnings = result.findings.filter((finding) => finding.severity === "warning").length;

  const summaryColor = isIncomplete || errors > 0 ? RED : YELLOW;
  const summaryPrefix = isIncomplete
    ? `✖ Scan incomplete (${errors} error(s), ${warnings} warning(s))`
    : `✖ Found ${errors} error(s), ${warnings} warning(s)`;
  lines.push(
    `${BOLD}${summaryColor}${summaryPrefix}${RESET} in ${result.totalFilesChecked} files (${result.durationMs}ms)`
  );
  lines.push(`${DIM}Tip: Run with --format llm to generate review prompt for LLM tools (ocr, diffray, etc.)${RESET}`);
  lines.push("");

  return lines.join("\n");
}
