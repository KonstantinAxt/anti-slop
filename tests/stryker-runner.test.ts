import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildBunCommand,
  buildStrykerOptions,
  buildVitestCommand,
  calculateMutationMetrics,
  checkMemoryThreshold,
  checkScopeLimit,
  cleanupStrykerSandbox,
  createStrykerErrorFinding,
  evaluateScoreThreshold,
  extractMutantFindings,
  extractObjectKeys,
  extractTestScript,
  registerExitCleanup,
  checkMutation,
  checkMutationWithStryker,
  detectTestSetup,
  filterProductionFilesForMutation,
  findNearestOwningTest,
  getOptimalConcurrency,
  mapMutantToFinding,
  validateMutationPreconditions,
  type StrykerMutantSummary,
} from "../src/checks/stryker-runner.js";

const MOCK_BRANCH_FILES = [
  "/repo/src/billing.ts",
  "/repo/src/billing.test.ts",
  "/repo/tests/e2e.spec.ts",
  "/repo/README.md",
  "/repo/src/types.d.ts",
  "/repo/src/components/button.tsx",
];

const CLI_PATH = path.resolve(__dirname, "../bin/anti-slop");
const SAMPLE_MUTANTS_METRICS: StrykerMutantSummary[] = [
  { id: "1", fileName: "a.ts", status: "Killed" },
  { id: "2", fileName: "a.ts", status: "Killed" },
  { id: "3", fileName: "a.ts", status: "Killed" },
  { id: "4", fileName: "a.ts", status: "Killed" },
  { id: "5", fileName: "a.ts", status: "Timeout" },
  { id: "6", fileName: "a.ts", status: "Survived" },
  { id: "7", fileName: "a.ts", status: "NoCoverage" },
  { id: "8", fileName: "a.ts", status: "CompileError" },
];
const LOW_METRICS_FIXTURE = {
  total: 10,
  killed: 7,
  survived: 3,
  noCoverage: 0,
  timeout: 0,
  compileErrors: 0,
  runtimeErrors: 0,
  score: 70,
};

describe("Stryker Mutation Runner", () => {
  it("maps survived mutant to error finding", () => {
    const mutant: StrykerMutantSummary = {
      id: "1",
      fileName: "src/calculator.ts",
      status: "Survived",
      mutatorName: "ArithmeticOperator",
      replacement: "-",
      location: {
        start: { line: 10, column: 5 },
        end: { line: 10, column: 6 },
      },
    };

    const finding = mapMutantToFinding(mutant);

    expect(finding).not.toBeNull();
    expect(finding?.check).toBe("mutation-test");
    expect(finding?.rule).toBe("surviving-mutant");
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toBe("Surviving mutant: ArithmeticOperator mutant survived ('-')");
    expect(finding?.file).toBe("src/calculator.ts");
    expect(finding?.line).toBe(10);
    expect(finding?.column).toBe(5);
    expect(finding?.why).toBe("Mutation testing: Code was modified with a mutant, but tests still passed without noticing the bug.");
    expect(finding?.suggestion).toBe("Add an assertion in your test suite that verifies this specific behavior or invariant.");

    // Lowercase status, missing replacement, missing mutatorName, missing location
    const bareMutant: StrykerMutantSummary = {
      id: "1b",
      fileName: "src/bare.ts",
      status: "survived",
    };
    const bareFinding = mapMutantToFinding(bareMutant);
    expect(bareFinding?.message).toBe("Surviving mutant: Expression mutant survived");
    expect(bareFinding?.line).toBe(1);
    expect(bareFinding?.column).toBe(1);
  });

  it("maps uncovered mutant to warning finding", () => {
    const mutant: StrykerMutantSummary = {
      id: "2",
      fileName: "src/legacy.ts",
      status: "NoCoverage",
      mutatorName: "BlockStatement",
      location: {
        start: { line: 42, column: 1 },
        end: { line: 45, column: 2 },
      },
    };

    const finding = mapMutantToFinding(mutant);

    expect(finding).not.toBeNull();
    expect(finding?.check).toBe("mutation-test");
    expect(finding?.rule).toBe("uncovered-mutant");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toBe("Uncovered mutant: BlockStatement has zero test coverage");
    expect(finding?.file).toBe("src/legacy.ts");
    expect(finding?.line).toBe(42);
    expect(finding?.column).toBe(1);
    expect(finding?.why).toBe("Mutation testing: This code branch is never reached or executed by any test in the test suite.");
    expect(finding?.suggestion).toBe("Write tests covering this execution path.");

    // Lowercase noCoverage status
    const lowercaseUncovered: StrykerMutantSummary = {
      id: "2b",
      fileName: "src/low.ts",
      status: "noCoverage",
    };
    const lowFinding = mapMutantToFinding(lowercaseUncovered);
    expect(lowFinding?.rule).toBe("uncovered-mutant");
    expect(lowFinding?.message).toBe("Uncovered mutant: Expression has zero test coverage");
  });
  it("returns null for killed mutants", () => {
    const mutant: StrykerMutantSummary = {
      id: "3",
      fileName: "src/valid.ts",
      status: "Killed",
      mutatorName: "EqualityOperator",
    };

    const finding = mapMutantToFinding(mutant);

    expect(finding).toBeNull();
  });

  it("handles unconfigured runner gracefully with informative finding", async () => {
    const findings = await checkMutationWithStryker(os.tmpdir(), ["non-existent-file.ts"]);

    expect(findings[0]?.rule).toBe("stryker-config-missing");
    expect(findings[0]?.severity).toBe("warning");
  });

  it("CLI --help displays --mutation and --stryker options", () => {
    const stdout = execSync(`node ${CLI_PATH} --help`, { encoding: "utf-8", timeout: 30000 });

    expect(stdout).toContain("--mutation");
    expect(stdout).toContain("--stryker");
  }, 30000);

  it("filters out test files, docs, scripts, and declarations when scoping mutation targets", () => {
    const cwd = "/repo";
    const filesWithScripts = [
      ...MOCK_BRANCH_FILES,
      "/repo/scripts/check-bundle-size.mjs",
      "/repo/scripts/build.ts",
    ];
    const scoped = filterProductionFilesForMutation(cwd, filesWithScripts);

    expect(scoped).toEqual(["src/billing.ts", "src/components/button.tsx"]);
  });

  it("skips mutation testing if branch only touched tests or documentation", async () => {
    const testOnlyBranchFiles = [
      "tests/checkout.test.ts",
      "docs/architecture.md",
    ];

    const findings = await checkMutationWithStryker(process.cwd(), testOnlyBranchFiles);

    expect(findings).toEqual([]);
  });

  it("detects test runner deterministically in workspace", () => {
    const setup = detectTestSetup(process.cwd());

    expect(setup).not.toBeNull();
    expect(setup?.testCommand).toContain("vitest");
    expect(setup?.packageManager).toBe("pnpm");
  });

  it("targets nearest owning test when mutateFiles are provided", () => {
    const setup = detectTestSetup(process.cwd(), ["src/checks/boundaries.ts"]);

    expect(setup).not.toBeNull();
    expect(setup?.testCommand).toContain("vitest");
    expect(setup?.testCommand).toContain("boundaries.ts");
  });

  it("detects Bun test runner when bun.lock is present", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bun-detect-"));
    try {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "");
      const setup = detectTestSetup(tempDir);
      expect(setup?.testCommand).toContain("bun test");
      expect(setup?.testCommand).toContain("--bail=1");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects Jest test runner and appends related flags when mutateFiles provided", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jest-detect-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: { test: "jest" },
          devDependencies: { jest: "^29.0.0" },
        })
      );
      const setup = detectTestSetup(tempDir, ["src/service.ts"]);
      expect(setup?.testCommand).toContain("jest --watchAll=false");
      expect(setup?.testCommand).toContain("--findRelatedTests src/service.ts");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects Yarn package manager when yarn.lock is present", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yarn-detect-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devDependencies: { vitest: "^1.0.0" },
        })
      );
      fs.writeFileSync(path.join(tempDir, "yarn.lock"), "");
      const setup = detectTestSetup(tempDir);
      expect(setup?.packageManager).toBe("yarn");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("filters duplicate --run flags when synthesizing vitest command", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vitest-dedup-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: { test: "vitest run --run" },
        })
      );
      const setup = detectTestSetup(tempDir);
      const tokens = setup?.testCommand.split(" ") ?? [];
      const runCount = tokens.filter((t) => t === "--run").length;
      expect(runCount).toBe(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves nearest owning test accurately or falls back to tests directory path", () => {
    const owning = findNearestOwningTest(process.cwd(), "src/checks/pr-size.ts");
    expect(owning).toBe("tests/pr-size.test.ts");

    const indexOwning = findNearestOwningTest(process.cwd(), "src/index.ts");
    expect(indexOwning).toBe("tests/runner.test.ts");

    const cliOwning = findNearestOwningTest(process.cwd(), "bin/anti-slop");
    expect(cliOwning).toBe("tests/cli.test.ts");
  });
  it("creates error severity finding when Stryker runner fails with string or Error", () => {
    const errFinding = createStrykerErrorFinding("/repo", new Error("OptionsValidator failure"));
    expect(errFinding.rule).toBe("stryker-runner-error");
    expect(errFinding.severity).toBe("error");
    expect(errFinding.message).toBe("Stryker mutation runner failed: OptionsValidator failure");
    expect(errFinding.file).toBe("/repo/package.json");
    expect(errFinding.line).toBe(1);
    expect(errFinding.column).toBe(1);
    expect(errFinding.why).toBe("Mutation testing failed to execute due to an internal runner error or configuration failure.");
    expect(errFinding.suggestion).toBe("Review Stryker options, test runner configuration, or error logs.");

    const strFinding = createStrykerErrorFinding("/repo", "Crash in worker");
    expect(strFinding.message).toBe("Stryker mutation runner failed: Crash in worker");
  });

  it("registers and deregisters exit cleanup handlers", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exit-cleanup-test-"));
    try {
      const unregister = registerExitCleanup(tempDir);
      expect(typeof unregister).toBe("function");
      unregister();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("synthesizes base Stryker config in memory when no config file exists", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zero-config-test-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devDependencies: { vitest: "^1.0.0" },
        })
      );

      const { options, errorFinding } = buildStrykerOptions(tempDir, ["src/service.ts"], 2);

      expect(errorFinding).toBeUndefined();
      expect(options?.testRunner).toBe("command");
      expect(options?.commandRunner?.command).toContain("vitest related src/service.ts --run");
      expect(options?.commandRunner?.command).toContain("--exclude \"**/.stryker-tmp/**\"");
      expect(options?.concurrency).toBe(2);
      expect(options?.coverageAnalysis).toBe("off");
      expect(options?.mutate).toEqual(["src/service.ts"]);
      expect(options?.disableTypeChecks).toBe("{src,lib,test,tests}/**/*.{js,ts,jsx,tsx}");
      expect(options?.ignorePatterns).toContain(".claude/**");
      expect(options?.ignorePatterns).toContain("coverage/**");
      expect(options?.ignorePatterns).toContain("reports/**");
      expect(options?.incremental).toBe(true);
      expect(options?.incrementalFile).toBe("reports/mutation/stryker-incremental.json");
      expect(options?.ignoreStatic).toBeUndefined();
      expect(options?.timeoutMS).toBe(10000);
      expect(options?.dryRunTimeoutMinutes).toBe(2);
      expect(options?.maxTestRunnerReuse).toBe(20);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("creates error severity finding when Stryker runner fails or throws", () => {
    const finding = createStrykerErrorFinding("/repo", new Error("OptionsValidator failure"));

    expect(finding.rule).toBe("stryker-runner-error");
    expect(finding.severity).toBe("error");
    expect(finding.message).toContain("OptionsValidator failure");
  });

  it("aborts when mutation scope exceeds safe file limit", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scope-cap-test-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devDependencies: { vitest: "^1.0.0" },
        })
      );
      const broadFiles = Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`);
      const findings = await checkMutationWithStryker(tempDir, broadFiles);

      expect(findings.length).toBe(1);
      expect(findings[0]?.rule).toBe("stryker-scope-too-broad");
      expect(findings[0]?.severity).toBe("warning");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("skips mutation testing when only test files or docs are targeted", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skip-mutation-test-"));
    try {
      const findings = await checkMutationWithStryker(tempDir, ["src/app.test.ts", "README.md"]);

      expect(findings).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns config-missing finding when no test runner is configured", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "missing-config-test-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "empty-project" })
      );
      const findings = await checkMutationWithStryker(tempDir, ["src/service.ts"]);

      expect(findings.length).toBe(1);
      expect(findings[0]?.rule).toBe("stryker-config-missing");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("calculates mutation score and metrics accurately", () => {
    const metrics = calculateMutationMetrics(SAMPLE_MUTANTS_METRICS);

    expect(metrics.total).toBe(8);
    expect(metrics.killed).toBe(4);
    expect(metrics.timeout).toBe(1);
    expect(metrics.survived).toBe(1);
    expect(metrics.noCoverage).toBe(1);
    expect(metrics.compileErrors).toBe(1);

    // Caught: 4 killed + 1 timeout = 5. Total valid: 5 + 1 survived + 1 noCoverage = 7.
    // Score: 5/7 * 100 = 71.4%
    const EXPECTED_SCORE = 71.4;

    expect(metrics.score).toBe(EXPECTED_SCORE);
  });

  it("returns 100% score for empty results or compile-error-only mutants, and tracks RuntimeError", () => {
    expect(calculateMutationMetrics([]).score).toBe(100);
    expect(
      calculateMutationMetrics([
        { id: "1", fileName: "a.ts", status: "CompileError" },
        { id: "2", fileName: "a.ts", status: "RuntimeError" },
      ]).score
    ).toBe(100);
    const metricsWithRuntime = calculateMutationMetrics([
      { id: "1", fileName: "a.ts", status: "Killed" },
      { id: "2", fileName: "a.ts", status: "RuntimeError" },
    ]);
    expect(metricsWithRuntime.runtimeErrors).toBe(1);
    expect(metricsWithRuntime.killed).toBe(1);
  });

  it("extracts object keys across primitives, objects, and null values", () => {
    expect(extractObjectKeys(null)).toEqual([]);
    expect(extractObjectKeys(undefined)).toEqual([]);
    expect(extractObjectKeys("string")).toEqual([]);
    expect(extractObjectKeys(42)).toEqual([]);
    expect(extractObjectKeys({ a: 1, b: "two" })).toEqual(["a", "b"]);
  });

  it("extracts test script from package.json objects safely", () => {
    expect(extractTestScript({})).toBe("");
    expect(extractTestScript({ scripts: null })).toBe("");
    expect(extractTestScript({ scripts: "not an object" })).toBe("");
    expect(extractTestScript({ scripts: { other: "echo" } })).toBe("");
    expect(extractTestScript({ scripts: { test: 123 } })).toBe("");
    expect(extractTestScript({ scripts: { test: "vitest run" } })).toBe("vitest run");
  });

  it("builds vitest commands across empty, prefix, and runner variants", () => {
    expect(buildVitestCommand("", "pnpm", "")).toBe(
      'pnpm vitest run --exclude "**/.stryker-tmp/**"'
    );
    expect(buildVitestCommand("", "pnpm", "src/foo.ts")).toBe(
      'pnpm vitest related src/foo.ts --run --exclude "**/.stryker-tmp/**"'
    );
    expect(buildVitestCommand("npx vitest", "npx", "")).toBe(
      'npx vitest run --exclude "**/.stryker-tmp/**"'
    );
    expect(buildVitestCommand("pnpm exec vitest", "pnpm", "")).toBe(
      'pnpm vitest run --exclude "**/.stryker-tmp/**"'
    );
    expect(buildVitestCommand("bunx vitest", "bunx", "")).toBe(
      'bunx vitest run --exclude "**/.stryker-tmp/**"'
    );
    expect(buildVitestCommand("yarn vitest", "yarn", "")).toBe(
      'yarn vitest run --exclude "**/.stryker-tmp/**"'
    );
    expect(buildVitestCommand("custom-tool test", "pnpm", "")).toBe(
      'custom-tool test --exclude "**/.stryker-tmp/**"'
    );
  });

  it("builds bun command with wildcards fallback and empty targets", () => {
    expect(buildBunCommand("", [])).toContain("bun test");
    expect(buildBunCommand("", [])).toContain("--bail=1");
    expect(buildBunCommand("", ["src/**/*.ts"])).toContain("bun test");
    expect(buildBunCommand("", ["src/**/*.ts"])).toContain("--bail=1");
  });

  it("resolves optimal concurrency from ANTI_SLOP_MUTATION_CONCURRENCY env var", () => {
    const prev = process.env.ANTI_SLOP_MUTATION_CONCURRENCY;
    try {
      process.env.ANTI_SLOP_MUTATION_CONCURRENCY = "6";
      expect(getOptimalConcurrency()).toBe(6);

      process.env.ANTI_SLOP_MUTATION_CONCURRENCY = "invalid";
      expect(getOptimalConcurrency()).toBeGreaterThanOrEqual(1);

      process.env.ANTI_SLOP_MUTATION_CONCURRENCY = "0";
      expect(getOptimalConcurrency()).toBeGreaterThanOrEqual(1);
    } finally {
      if (prev !== undefined) process.env.ANTI_SLOP_MUTATION_CONCURRENCY = prev;
      else delete process.env.ANTI_SLOP_MUTATION_CONCURRENCY;
    }
  });

  it("detects custom script falling back to package manager test command", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "custom-runner-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ scripts: { test: "node custom-suite.js" } })
      );
      const setup = detectTestSetup(tempDir);
      expect(setup?.testCommand).toBe("npm test");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles checkMutation with skip, missing config, and broad scope", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "check-mutation-api-"));
    try {
      // 1. Skip on non-production files
      const skipRes = await checkMutation(tempDir, ["README.md"]);
      expect(skipRes.findings).toEqual([]);

      // 2. Missing config
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
      const missingRes = await checkMutation(tempDir, ["src/service.ts"]);
      expect(missingRes.findings).toHaveLength(1);
      expect(missingRes.findings[0]?.rule).toBe("stryker-config-missing");

      // 3. Scope too broad
      const broadFiles = Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`);
      const broadRes = await checkMutation(tempDir, broadFiles, { maxMutationFiles: 12 });
      expect(broadRes.findings).toHaveLength(1);
      expect(broadRes.findings[0]?.rule).toBe("stryker-scope-too-broad");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("evaluates mutation score against threshold with exact counts and metadata", () => {
    const targetThreshold = 80;
    const finding = evaluateScoreThreshold(LOW_METRICS_FIXTURE, targetThreshold, "src/index.ts");

    expect(finding).not.toBeNull();
    expect(finding?.check).toBe("mutation-test");
    expect(finding?.severity).toBe("error");
    expect(finding?.rule).toBe("mutation-score-threshold");
    expect(finding?.file).toBe("src/index.ts");
    expect(finding?.line).toBe(1);
    expect(finding?.column).toBe(1);
    expect(finding?.message).toBe("Mutation score 70.0% is below required threshold of 80% (7/10 caught).");
    expect(finding?.why).toBe("Mutation testing requires at least 80% of valid mutants to be caught by the test suite.");
    expect(finding?.suggestion).toBe("Add assertions in test suite to kill surviving and uncovered mutants.");

    const passingFinding = evaluateScoreThreshold(LOW_METRICS_FIXTURE, 70, "src/index.ts");
    expect(passingFinding).toBeNull();

    const undefinedFinding = evaluateScoreThreshold(LOW_METRICS_FIXTURE, undefined, "src/index.ts");
    expect(undefinedFinding).toBeNull();
  });

  it("calculates optimal concurrency and respects user overrides and safety limits", () => {
    expect(getOptimalConcurrency(3)).toBe(3);
    expect(getOptimalConcurrency(16)).toBe(16);
    expect(getOptimalConcurrency(0)).toBeGreaterThanOrEqual(1);
    expect(getOptimalConcurrency(undefined)).toBeGreaterThanOrEqual(1);
  });
  it("cleans up .stryker-tmp sandbox directory safely", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stryker-cleanup-test-"));
    try {
      const tmpDir = path.join(tempDir, ".stryker-tmp");
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "dummy.txt"), "test");
      expect(fs.existsSync(tmpDir)).toBe(true);

      cleanupStrykerSandbox(tempDir);
      expect(fs.existsSync(tmpDir)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("evaluates checkMemoryThreshold under critical memory pressure and healthy memory", () => {
    const lowMemFinding = checkMemoryThreshold(10 * 1024 * 1024, 16 * 1024 * 1024 * 1024, "/repo");
    expect(lowMemFinding).not.toBeNull();
    expect(lowMemFinding?.check).toBe("mutation-test");
    expect(lowMemFinding?.rule).toBe("stryker-low-memory-abort");
    expect(lowMemFinding?.severity).toBe("warning");
    expect(lowMemFinding?.message).toContain("critically low free memory");
    expect(lowMemFinding?.why).toBe("Executing mutation sandboxes under critical memory pressure can freeze the host system.");
    expect(lowMemFinding?.suggestion).toBe("Close background applications to free memory before running mutation tests.");

    const healthyFinding = checkMemoryThreshold(8 * 1024 * 1024 * 1024, 16 * 1024 * 1024 * 1024, "/repo");
    expect(healthyFinding).toBeNull();
  });

  it("evaluates checkScopeLimit under boundary conditions", () => {
    expect(checkScopeLimit(6, "/repo", 8)).toBeNull();
    expect(checkScopeLimit(8, "/repo", 8)).toBeNull();

    const broadFinding = checkScopeLimit(9, "/repo", 8);
    expect(broadFinding).not.toBeNull();
    expect(broadFinding?.rule).toBe("stryker-scope-too-broad");
    expect(broadFinding?.severity).toBe("warning");
    expect(broadFinding?.message).toBe("Mutation run aborted: scope too broad (9 files exceed safety limit of 8).");
  });

  it("extracts and maps mutant findings from results list", () => {
    const sampleResults = [
      { id: "1", fileName: "src/a.ts", status: "Killed" },
      { id: "2", fileName: "src/b.ts", status: "Survived", mutatorName: "ArithmeticOperator" },
      { id: "3", fileName: "src/c.ts", status: "NoCoverage", mutatorName: "BooleanLiteral" },
    ];
    const findings = extractMutantFindings(sampleResults);
    expect(findings).toHaveLength(2);
    expect(findings[0]?.rule).toBe("surviving-mutant");
    expect(findings[1]?.rule).toBe("uncovered-mutant");
  });

  it("detects any supported Stryker config file variant", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stryker-config-variant-"));
    try {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "stryker.config.mjs"), "export default {};");
      const pre = validateMutationPreconditions(tempDir, ["src/app.ts"]);
      expect(pre.options).toBeDefined();
      expect(pre.errorFindings).toBeUndefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves optimal concurrency with explicit, env, and auto modes", () => {
    expect(getOptimalConcurrency(5)).toBe(5);

    const prevEnv = process.env.ANTI_SLOP_MUTATION_CONCURRENCY;
    try {
      process.env.ANTI_SLOP_MUTATION_CONCURRENCY = "4";

      expect(getOptimalConcurrency()).toBe(4);
    } finally {
      if (prevEnv !== undefined) {
        process.env.ANTI_SLOP_MUTATION_CONCURRENCY = prevEnv;
      } else {
        delete process.env.ANTI_SLOP_MUTATION_CONCURRENCY;
      }
    }

    const autoConcurrency = getOptimalConcurrency();

    expect(autoConcurrency).toBeGreaterThanOrEqual(1);
  });

  it("validates mutation preconditions across empty, broad, and valid targets", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stryker-pre-test-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ scripts: { test: "bun test" } })
      );
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "");

      const skipResult = validateMutationPreconditions(tempDir, ["README.md", "types.d.ts"]);

      expect(skipResult.skip).toBe(true);
      const nineFiles = Array.from({ length: 9 }, (_, idx) => `src/file${idx}.ts`);
      const broadResult = validateMutationPreconditions(tempDir, nineFiles);
      expect(broadResult.errorFindings?.[0]?.rule).toBe("stryker-scope-too-broad");

      const eightFiles = Array.from({ length: 8 }, (_, idx) => `src/file${idx}.ts`);
      const eightResult = validateMutationPreconditions(tempDir, eightFiles);
      expect(eightResult.errorFindings).toBeUndefined();

      const customLimitResult = validateMutationPreconditions(tempDir, eightFiles, undefined, 4);
      expect(customLimitResult.errorFindings?.[0]?.rule).toBe("stryker-scope-too-broad");

      // Fallback for non-positive maxMutationFiles
      const fallbackResult = validateMutationPreconditions(tempDir, eightFiles, undefined, -1);
      expect(fallbackResult.errorFindings).toBeUndefined();
      const zeroResult = validateMutationPreconditions(tempDir, eightFiles, undefined, 0);
      expect(zeroResult.errorFindings).toBeUndefined();
      const validResult = validateMutationPreconditions(tempDir, ["src/file1.ts"], 3);
      expect(validResult.options?.concurrency).toBe(3);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("tests evaluateScoreThreshold arithmetic and exact message formatting", () => {
    const finding = evaluateScoreThreshold(
      { killed: 10, timeout: 5, survived: 5, noCoverage: 5, score: 60, total: 25, compileErrors: 0, runtimeErrors: 0 },
      80,
      "src/index.ts"
    );
    expect(finding).not.toBeNull();
    expect(finding?.message).toBe("Mutation score 60.0% is below required threshold of 80% (15/25 caught).");
    expect(finding?.rule).toBe("mutation-score-threshold");
    expect(finding?.severity).toBe("error");
    expect(finding?.why).toBe("Mutation testing requires at least 80% of valid mutants to be caught by the test suite.");
    expect(finding?.suggestion).toBe("Add assertions in test suite to kill surviving and uncovered mutants.");

    // When passing threshold
    expect(evaluateScoreThreshold({ killed: 20, timeout: 0, survived: 0, noCoverage: 0, score: 100, total: 20, compileErrors: 0, runtimeErrors: 0 }, 80, "src/index.ts")).toBeNull();
    // When minScore is undefined
    expect(evaluateScoreThreshold({ killed: 10, timeout: 0, survived: 10, noCoverage: 0, score: 50, total: 20, compileErrors: 0, runtimeErrors: 0 }, undefined, "src/index.ts")).toBeNull();
  });
  it("tests checkScopeLimit exact messages and fields", () => {
    const limitFinding = checkScopeLimit(15, "/fake/repo", 8);
    expect(limitFinding?.rule).toBe("stryker-scope-too-broad");
    expect(limitFinding?.severity).toBe("warning");
    expect(limitFinding?.message).toBe("Mutation run aborted: scope too broad (15 files exceed safety limit of 8).");
    expect(limitFinding?.why).toBe("Running mutation tests across 15 files simultaneously can saturate CPU and memory.");
    expect(limitFinding?.suggestion).toBe("Target specific files: anti-slop --mutation <file1> <file2>");
    expect(checkScopeLimit(5, "/fake/repo", 8)).toBeNull();
  });

  it("tests registerExitCleanup attaches and removes process signal listeners", () => {
    const exitBefore = process.listenerCount("exit");
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");
    const tempCleanDir = path.join(os.tmpdir(), "safe-test-cleanup-dir");
    const cleanup = registerExitCleanup(tempCleanDir);
    const expectedExit = exitBefore + 1;
    const expectedSigint = sigintBefore + 1;
    const expectedSigterm = sigtermBefore + 1;
    expect(process.listenerCount("exit")).toBe(expectedExit);
    expect(process.listenerCount("SIGINT")).toBe(expectedSigint);
    expect(process.listenerCount("SIGTERM")).toBe(expectedSigterm);

    cleanup();
    expect(process.listenerCount("exit")).toBe(exitBefore);
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });
});
