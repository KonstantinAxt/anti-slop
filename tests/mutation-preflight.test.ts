import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  calculateMutationPreflight,
  evaluateResourceSafety,
  exportCiOutputs,
  extractMutantsFromCache,
  formatTerminalPreflight,
  loadIncrementalCache,
  measureCurrentCpuConsumption,
} from "../src/checks/mutation-preflight.js";

describe("Mutation Preflight & Capacity Estimator", () => {
  it("samples current CPU consumption in real-time", async () => {
    const sampleMs = 50;
    const cpuPct = await measureCurrentCpuConsumption(sampleMs);

    expect(cpuPct).toBeGreaterThanOrEqual(0);
    expect(cpuPct).toBeLessThanOrEqual(100);
  });

  it("evaluates resource safety and calculates safe concurrency cap", async () => {
    const safety = await evaluateResourceSafety({ sampleMs: 30 });

    expect(safety.cpuCount).toBeGreaterThan(0);
    expect(safety.cpuLoadPercent).toBeGreaterThanOrEqual(0);
    expect(safety.cpuLoadPercent).toBeLessThanOrEqual(100);
    expect(safety.recommendedConcurrency).toBeGreaterThanOrEqual(1);
    expect(safety.recommendedConcurrency).toBeLessThanOrEqual(4);
    expect(["idle", "moderate", "busy", "overloaded"]).toContain(safety.cpuStatus);
  });

  it("throttles recommended concurrency when CPU load is overloaded (>=80%)", async () => {
    const safety = await evaluateResourceSafety({
      mockCpuLoadPercent: 88,
      mockLoadAvg1Min: 12.0,
      mockCpuCount: 14,
      mockFreeMemBytes: 16 * 1024 * 1024 * 1024,
    });

    expect(safety.cpuStatus).toBe("overloaded");
    expect(safety.recommendedConcurrency).toBe(1);
    expect(safety.warning).toContain("High CPU consumption");
  });

  it("throttles recommended concurrency when CPU load is busy (60-79%)", async () => {
    const safety = await evaluateResourceSafety({
      mockCpuLoadPercent: 70,
      mockLoadAvg1Min: 6.0,
      mockCpuCount: 14,
      mockFreeMemBytes: 16 * 1024 * 1024 * 1024,
    });

    expect(safety.cpuStatus).toBe("busy");
    expect(safety.recommendedConcurrency).toBe(2);
    expect(safety.warning).toContain("Elevated CPU consumption");
  });

  it("allows standard safe concurrency when CPU is idle (<40%)", async () => {
    const safety = await evaluateResourceSafety({
      mockCpuLoadPercent: 15,
      mockLoadAvg1Min: 1.0,
      mockCpuCount: 14,
      mockFreeMemBytes: 16 * 1024 * 1024 * 1024,
    });

    expect(safety.cpuStatus).toBe("idle");
    expect(safety.recommendedConcurrency).toBe(4);
    expect(safety.isSafeForDesktop).toBe(true);
  });
  it("warns when requested concurrency exceeds recommended cap", async () => {
    const requestedWorkers = 99;
    const safety = await evaluateResourceSafety({
      requestedConcurrency: requestedWorkers,
      sampleMs: 30,
      mockFreeMemBytes: 16 * 1024 * 1024 * 1024,
    });

    expect(safety.isSafeForDesktop).toBe(false);
    expect(safety.warning).toContain("exceeds safe desktop threshold");
  });

  it("calculates mutant counts and estimates for target files", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-test-"));
    const fixtureFile = path.join(tempDir, "calculator.ts");
    fs.writeFileSync(
      fixtureFile,
      "export function add(a: number, b: number): number { return a + b; }\n",
      "utf-8"
    );

    try {
      const report = await calculateMutationPreflight({
        cwd: tempDir,
        files: [fixtureFile],
        concurrency: 4,
      });

      expect(report.mutableFiles).toHaveLength(1);
      expect(report.totalEstimatedMutants).toBe(2);
      expect(report.isScopeTooBroad).toBe(false);
      expect(report.fileEstimates).toHaveLength(1);
      expect(report.fileEstimates[0]?.estimatedMutants).toBe(2);
      expect(report.estimatedColdSeconds).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects scope too broad when mutable files exceed max limit", async () => {
    const report = await calculateMutationPreflight({
      cwd: process.cwd(),
      files: ["src/formatters.ts", "src/checks/pr-size.ts"],
      maxMutationFiles: 1,
      concurrency: 2,
    });

    expect(report.isScopeTooBroad).toBe(true);
    expect(report.mutableFiles).toHaveLength(2);
    expect(report.maxFilesLimit).toBe(1);
    expect(report.recommendedCommand).toContain("node bin/anti-slop --mutation");
  });

  it("formats terminal report with resource safety and execution estimates", async () => {
    const report = await calculateMutationPreflight({
      cwd: process.cwd(),
      files: ["src/formatters.ts"],
      concurrency: 4,
    });

    const output = formatTerminalPreflight(report);

    expect(output).toContain("⚡ Anti-Slop Mutation Preflight & Capacity Estimate");
    expect(output).toContain("src/formatters.ts");
    expect(output).toContain("System Resources & VSCode Safety");
    expect(output).toContain("Current Load:");
    expect(output).toContain("Estimated Execution Time");
    expect(output).toContain("Recommended Safe Command");
  });

  it("exports CI step summary and GitHub Actions outputs", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-ci-"));
    const fakeOutputFile = path.join(tempDir, "github_output");
    const fakeSummaryFile = path.join(tempDir, "github_summary");

    fs.writeFileSync(fakeOutputFile, "", "utf-8");
    fs.writeFileSync(fakeSummaryFile, "", "utf-8");

    process.env.GITHUB_OUTPUT = fakeOutputFile;
    process.env.GITHUB_STEP_SUMMARY = fakeSummaryFile;

    try {
      const report = await calculateMutationPreflight({
        cwd: process.cwd(),
        files: ["src/formatters.ts"],
      });

      exportCiOutputs(report);

      const outputContent = fs.readFileSync(fakeOutputFile, "utf-8");
      const summaryContent = fs.readFileSync(fakeSummaryFile, "utf-8");

      expect(outputContent).toContain("estimated_cold_seconds=");
      expect(outputContent).toContain("total_mutants=");
      expect(outputContent).toContain("scope_too_broad=false");

      expect(summaryContent).toContain("## ⚡ Mutation Preflight & Capacity Estimate");
      expect(summaryContent).toContain("Total Mutants");
    } finally {
      delete process.env.GITHUB_OUTPUT;
      delete process.env.GITHUB_STEP_SUMMARY;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("extracts mutant counts from cache files object and handles malformed shapes", () => {
    expect(extractMutantsFromCache(undefined)).toEqual({});
    expect(extractMutantsFromCache(null)).toEqual({});
    expect(extractMutantsFromCache("string")).toEqual({});
    expect(extractMutantsFromCache({})).toEqual({});

    const sample = {
      "src/file1.ts": { mutants: [1, 2, 3] },
      "src/file2.ts": { mutants: "not an array" },
      "src/file3.ts": null,
      "src/file4.ts": { other: true },
    };

    expect(extractMutantsFromCache(sample)).toEqual({
      "src/file1.ts": 3,
    });
  });

  it("loads incremental cache file or returns empty object gracefully", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-cache-"));
    try {
      expect(loadIncrementalCache(tempDir)).toEqual({});

      const reportsDir = path.join(tempDir, "reports", "mutation");
      fs.mkdirSync(reportsDir, { recursive: true });
      const cachePath = path.join(reportsDir, "stryker-incremental.json");

      fs.writeFileSync(cachePath, "invalid json {", "utf-8");

      expect(loadIncrementalCache(tempDir)).toEqual({});

      fs.writeFileSync(
        cachePath,
        JSON.stringify({ files: { "src/a.ts": { mutants: [1, 2] } } }),
        "utf-8"
      );

      expect(loadIncrementalCache(tempDir)).toEqual({ "src/a.ts": 2 });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
