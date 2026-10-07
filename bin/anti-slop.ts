import * as fs from "node:fs";
import type { AntiSlopOptions } from "../src/types.js";

const HELP_TEXT = `
🛡️  anti-slop — Deterministic Code Review Gate
Catches structural AI-generated code defects before reviews

USAGE:
  anti-slop [options] [files|dirs...]

OPTIONS:
  --staged                Check only git-staged files
  --since <ref>           Check files changed since git ref (e.g. origin/main, HEAD~1)
  --format <fmt>          Output format: terminal | llm | json (default: terminal)
  --llm                   Shortcut for --format llm (Markdown prompt for LLM review)
  --json                  Shortcut for --format json
  --allow-loose-tsconfig  Allow loose tsconfig in repo (virtual strict TS checks code; implicit-any warns)
  --mutation, --stryker   Run Stryker mutation testing against target files
  --min-mutation-score <pct> Minimum mutation score required (e.g. 80)
  --max-mutation-files <n> Maximum mutable files before mutation gate aborts (default: 8)
  --mutation-preflight, --preflight Estimate mutation scope, runtime, and safe concurrency
  --crap                  Run CRAP (Change Risk Anti-Pattern) analysis next to mutation testing
  --crap-threshold <num>  CRAP risk score threshold (default: 30)
  --pr-size               Run PR size review check based on git diff
  --pr-size-warn-lines <n> Review lines warning threshold (default: 200)
  --pr-size-fail-lines <n> Review lines failure threshold (default: 500)
  --pr-size-warn-files <n> Changed files warning threshold (default: 10)
  --checks, --check <list> Comma-separated checks to run: base | crap | mutation | pr-size
  --pr-size-fail-files <n> Changed files failure threshold (default: 25)
  -v, --version           Show version number
  -h, --help              Show this help message

EXAMPLES:
  anti-slop                               # Scans current repository
  anti-slop --staged                      # Pre-commit review gate
  anti-slop --since origin/main           # PR review gate
  anti-slop --crap                        # Run CRAP analysis on repository
  anti-slop --mutation --crap             # Run mutation testing and CRAP analysis
  anti-slop --since origin/main --llm     # Pipe to LLM reviewer (e.g. ocr, diffray, pbcopy)
  anti-slop src/services/                 # Check specific directory
`;

function writeStream(stream: NodeJS.WriteStream, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const chunk = data.endsWith("\n") ? data : data + "\n";
    let settled = false;
    const onDone = (err?: Error | null) => {
      if (settled) return;
      settled = true;
      if (err && (err as NodeJS.ErrnoException).code !== "EPIPE") {
        reject(err);
      } else {
        resolve();
      }
    };

    const ok = stream.write(chunk, onDone);
    if (!ok) {
      stream.once("drain", () => onDone());
      stream.once("error", onDone);
    }
  });
}
function getVersion(): string {
  try {
    const pkgPath = new URL("../package.json", import.meta.url);
    const content = fs.readFileSync(pkgPath, "utf8");
    return JSON.parse(content).version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

export async function runCli(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("-v") || args.includes("--version")) {
    process.exitCode = 0;
    await writeStream(process.stdout, getVersion());
    return;
  }

  if (args.includes("-h") || args.includes("--help")) {
    process.exitCode = 0;
    await writeStream(process.stdout, HELP_TEXT);
    return;
  }
  const options: AntiSlopOptions = {
    cwd: process.cwd(),
  };

  let format: "terminal" | "llm" | "json" = "terminal";
  let mutationPreflight = false;
  const positionalFiles: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg) continue;

    if (arg === "--staged") {
      options.staged = true;
    } else if (arg === "--since") {
      i++;
      options.since = args[i];
    } else if (arg === "--checks" || arg === "--check") {
      i++;
      const raw = args[i] ?? "";
      const list = raw.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
      options.checks = [...(options.checks ?? []), ...list];
    } else if (arg === "--format") {
      i++;
      const fmt = args[i];
      if (fmt === "terminal" || fmt === "llm" || fmt === "json") {
        format = fmt;
      }
    } else if (arg === "--llm") {
      format = "llm";
    } else if (arg === "--json") {
      format = "json";
    } else if (arg === "--mutation" || arg === "--stryker") {
      options.mutation = true;
    } else if (arg === "--mutation-preflight" || arg === "--preflight") {
      mutationPreflight = true;
    } else if (arg === "--min-mutation-score") {
      i++;
      const val = parseFloat(args[i] ?? "80");
      if (!isNaN(val)) {
        options.minMutationScore = val;
        options.mutation = true;
      }
    } else if (arg === "--mutation-concurrency") {
      i++;
      const val = parseInt(args[i] ?? "2", 10);
      if (!isNaN(val) && val > 0) {
        options.mutationConcurrency = val;
      }
    } else if (arg === "--max-mutation-files") {
      i++;
      const val = parseInt(args[i] ?? "8", 10);
      if (!isNaN(val) && val > 0) {
        options.maxMutationFiles = val;
      }
    } else if (arg === "--crap") {
      options.crap = true;
    } else if (arg === "--crap-threshold") {
      i++;
      const val = parseFloat(args[i] ?? "30");
      if (!isNaN(val)) {
        options.crapThreshold = val;
      }
    } else if (arg === "--pr-size") {
      options.prSize = true;
    } else if (arg === "--pr-size-warn-lines") {
      i++;
      const val = parseInt(args[i] ?? "200", 10);
      if (!isNaN(val)) options.prSizeWarnLines = val;
    } else if (arg === "--pr-size-fail-lines") {
      i++;
      const val = parseInt(args[i] ?? "500", 10);
      if (!isNaN(val)) options.prSizeFailLines = val;
    } else if (arg === "--pr-size-warn-files") {
      i++;
      const val = parseInt(args[i] ?? "10", 10);
      if (!isNaN(val)) options.prSizeWarnFiles = val;
    } else if (arg === "--pr-size-fail-files") {
      i++;
      const val = parseInt(args[i] ?? "25", 10);
      if (!isNaN(val)) options.prSizeFailFiles = val;
    } else if (arg === "--allow-loose-tsconfig" || arg === "--loose-tsconfig") {
      options.allowLooseTsConfig = true;
    } else if (!arg.startsWith("-")) {
      positionalFiles.push(arg);
    }
  }

  if (positionalFiles.length > 0) {
    options.files = positionalFiles;
  }

  if (mutationPreflight) {
    // Exception: dynamic import defers loading mutation preflight engine so --help and fast paths remain instant
    const { calculateMutationPreflight, formatTerminalPreflight, exportCiOutputs } = await import(
      "../src/checks/mutation-preflight.js"
    );
    const report = await calculateMutationPreflight({
      cwd: options.cwd,
      files: options.files,
      since: options.since,
      staged: options.staged,
      concurrency: options.mutationConcurrency,
      maxMutationFiles: options.maxMutationFiles,
    });
    if (Boolean(process.env.CI)) {
      exportCiOutputs(report);
    }
    const output = format === "json" ? JSON.stringify(report, null, 2) : formatTerminalPreflight(report);
    await writeStream(process.stdout, output);
    return;
  }
  try {
    // Exception: dynamic import defers loading the heavy ESLint and TypeScript engine so --help exits instantly
    const { runAntiSlop, formatOutput } = await import("../src/index.ts");
    const result = await runAntiSlop(options);
    const output = formatOutput(result, format);

    const isSuccess = result.passed && result.completedAllChecks !== false;
    if (format === "terminal" && isSuccess) {
      process.exitCode = 0;
      await writeStream(process.stdout, output);
    } else if (format === "terminal") {
      process.exitCode = 1;
      await writeStream(process.stderr, output);
    } else {
      process.exitCode = isSuccess ? 0 : 1;
      await writeStream(process.stdout, output);
    }
  } catch (err) {
    process.exitCode = 2;
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    await writeStream(process.stderr, `Fatal error running anti-slop: ${msg}`);
  }
}

await runCli();

