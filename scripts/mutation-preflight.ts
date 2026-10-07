#!/usr/bin/env node
import * as process from "node:process";
import {
  calculateMutationPreflight,
  exportCiOutputs,
  formatTerminalPreflight,
  type MutationPreflightOptions,
} from "../src/checks/mutation-preflight.js";

const DEFAULT_EXIT_CODE_SUCCESS = 0;
const DEFAULT_EXIT_CODE_FAILURE = 1;
const DECIMAL_RADIX = 10;

interface ParsedCliArgs {
  options: MutationPreflightOptions;
  json: boolean;
  failOnBroad: boolean;
  showHelp: boolean;
}

function parseCliArgs(args: string[]): ParsedCliArgs {
  const options: MutationPreflightOptions = {
    cwd: process.cwd(),
    files: [],
  };
  let json = false;
  let failOnBroad = false;
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === "-h" || arg === "--help") {
      showHelp = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--ci") {
      options.ci = true;
    } else if (arg === "--fail-on-broad") {
      failOnBroad = true;
    } else if (arg === "--staged") {
      options.staged = true;
    } else if (arg === "--since") {
      i++;
      options.since = args[i];
    } else if (arg === "--concurrency" || arg === "--mutation-concurrency") {
      i++;
      const val = parseInt(args[i] ?? "0", DECIMAL_RADIX);
      if (!isNaN(val) && val > 0) {
        options.concurrency = val;
      }
    } else if (arg === "--max-mutation-files") {
      i++;
      const val = parseInt(args[i] ?? "0", DECIMAL_RADIX);
      if (!isNaN(val) && val > 0) {
        options.maxMutationFiles = val;
      }
    } else if (!arg.startsWith("-")) {
      options.files = [...(options.files ?? []), arg];
    }
  }

  return { options, json, failOnBroad, showHelp };
}

function printHelp(): void {
  console.log(`
Anti-Slop Mutation Preflight & Capacity Estimator

Calculates mutant volume, cache reuse, execution runtime estimates,
and safe desktop concurrency before launching heavy Stryker mutation suites.

Usage:
  node --import tsx scripts/mutation-preflight.ts [options] [files...]
  pnpm run test:mutation:preflight [options] [files...]

Options:
  --since <ref>            Estimate diff against git ref (e.g. origin/main, HEAD~1)
  --staged                 Estimate currently staged git files
  --concurrency <n>        Simulate with specific worker concurrency
  --max-mutation-files <n> Custom file limit guard (default: 8)
  --fail-on-broad          Exit with 1 if mutable files exceed safety threshold
  --ci                     Export GitHub Actions outputs and step summary
  --json                   Output machine-readable JSON report
  -h, --help               Show this help message

Examples:
  pnpm run test:mutation:preflight --since origin/main
  pnpm run test:mutation:preflight src/checks/pr-size.ts
  node --import tsx scripts/mutation-preflight.ts --ci --since origin/main
`);
}

async function main(): Promise<void> {
  const cliArgs = process.argv.slice(2);
  const { options, json, failOnBroad, showHelp } = parseCliArgs(cliArgs);

  if (showHelp) {
    printHelp();
    process.exit(DEFAULT_EXIT_CODE_SUCCESS);
  }

  const isCiEnvironment = Boolean(process.env.CI) || Boolean(options.ci);
  const report = await calculateMutationPreflight(options);

  if (isCiEnvironment) {
    exportCiOutputs(report);
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTerminalPreflight(report));
  }

  if (failOnBroad && report.isScopeTooBroad) {
    console.error(`\n❌ Preflight failed: ${report.mutableFiles.length} files exceed safety limit of ${report.maxFilesLimit}.`);
    process.exit(DEFAULT_EXIT_CODE_FAILURE);
  }

  process.exit(DEFAULT_EXIT_CODE_SUCCESS);
}

main().catch((err: unknown) => {
  console.error("Fatal preflight error:", err);
  process.exit(DEFAULT_EXIT_CODE_FAILURE);
});
