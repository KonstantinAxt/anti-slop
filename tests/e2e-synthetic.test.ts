import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCliProcess } from "./cli-process.js";

describe("E2E Synthetic AI Slop Repo Verification", () => {
  let sandboxDir = "";

  beforeAll(() => {
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "anti-slop-e2e-sandbox-"));
    fs.mkdirSync(path.join(sandboxDir, "src/services"), { recursive: true });
    fs.mkdirSync(path.join(sandboxDir, "src/components"), { recursive: true });

    // 1. Loose tsconfig (Move #2)
    fs.writeFileSync(
      path.join(sandboxDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: false,
          noUncheckedIndexedAccess: false,
        },
      })
    );

    // 2. Dummy Component
    fs.writeFileSync(
      path.join(sandboxDir, "src/components/Button.tsx"),
      `export const Button = () => null;`
    );

    // 3. Service with Boundary Leak, Scar, Unchecked indexing, and any
    fs.writeFileSync(
      path.join(sandboxDir, "src/services/billing.service.ts"),
      `
      import { Button } from "../components/Button";

      export class BillingService {
        processInvoice(amounts: any[]) {
          const first = amounts[0]!;
          return Math.round(first * 10) / 10;
        }

        charge() {
          return true;
        }
      }
      `
    );

    // 4. Test file with Hollow Assertions and Stale vi.mock
    fs.writeFileSync(
      path.join(sandboxDir, "src/billing.test.ts"),
      `
      import { describe, it, expect, vi } from "vitest";

      vi.mock("./services/billing.service", () => ({
        charge: vi.fn(),
        legacyDeletedInvoice: vi.fn(),
      }));

      describe("billing", () => {
        it("runs the test", () => {
          const fn = vi.fn();
          fn();
          expect(fn).toHaveBeenCalled();
        });
      });
      `
    );
  });

  afterAll(() => {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  });

  it("detects all Evil Martians categories on a synthetic repository", async ({ signal }) => {
    const { stdout } = await runCliProcess(["--json"], sandboxDir, signal);
    const report = JSON.parse(stdout);

    expect(report.passed).toBe(false);

    const ruleIds = report.findings.map((f: { rule: string }) => f.rule);

    // Move #2 Strict TS
    expect(ruleIds).toContain("strict-mode");
    expect(ruleIds).toContain("no-unchecked-indexed-access");
    expect(ruleIds).toContain("no-non-null-assertion");

    // Move #3 Behavioral
    expect(ruleIds).toContain("no-explicit-any");

    // Move #4 Boundaries
    expect(ruleIds).toContain("ui-free-service");

    // Move #5 Scars
    expect(ruleIds).toContain("no-service-rounding");

    // Move #7 Hollow Assertions
    expect(ruleIds).toContain("hollow-call-assertion");

    // Move #8 Stale Mock Resolver
    expect(ruleIds).toContain("stale-mock-export");
  });

  it("outputs the LLM prompt for a synthetic repository", async ({ signal }) => {
    const { stdout: llmOutput } = await runCliProcess(["--llm"], sandboxDir, signal);

    expect(llmOutput).toContain("# Anti-AI Slop Review Findings");
    expect(llmOutput).not.toContain("LLM Code Review Guidance");
    expect(llmOutput).toContain("legacyDeletedInvoice");
    expect(llmOutput).toContain("no-service-rounding");
  });
});
