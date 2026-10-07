import { describe, it, expect } from "bun:test";
import { checkHollowTests } from "../src/checks/hollow-tests";
import { checkDeadCode } from "../src/checks/dead-code";
import path from "node:path";
import fs from "node:fs";

describe("Public Rule Defect Probes", () => {
  describe("Empty Cypress callback assertion check", () => {
    it("flags missing-assertion when cy.should callback is empty", async () => {
      const code = `
describe("Workflow with empty should", () => {
  it("does not assert anything in should", () => {
    cy.get(".item").should(() => {});
  });
});
`;
      const targetFile = "cypress/tests/workflows/EmptyCallback.cy.ts";
      const hollowResults = await checkHollowTests(targetFile, code);
      const emptyFinding = hollowResults.find((item) => item.rule === "missing-assertion");

      expect(emptyFinding?.rule).toBe("missing-assertion");
      expect(emptyFinding?.severity).toBe("error");
    });
  });

  describe("Dead-code script helper scan discipline", () => {
    it("does not blindly treat every file in scripts/ as an entrypoint exempt from analysis", () => {
      const scriptsDir = path.join(process.cwd(), "scripts");
      fs.mkdirSync(scriptsDir, { recursive: true });
      const tempHelper = path.join(scriptsDir, "temp-unreferenced-probe.ts");
      fs.writeFileSync(tempHelper, "export function neverUsedFn() { return 42; }\n");
      try {
        const findings = checkDeadCode([tempHelper], {
          cwd: process.cwd(),
        });
        const unusedFinding = findings.find((f) => f.rule === "unused-export" || f.rule === "unused-file");

        expect(unusedFinding?.rule).toBe("unused-file");
      } finally {
        if (fs.existsSync(tempHelper)) {
          fs.unlinkSync(tempHelper);
        }
      }
    });
  });
});
