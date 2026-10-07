import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { checkHollowTests } from "../src/checks/hollow-tests";
import { checkWithEslint } from "../src/checks/eslint-runner";

const NO_FOCUSED_TEST_RULE = "no-focused-test";
const MISSING_ASSERTION_RULE = "missing-assertion";

describe("Rule Regressions & Durable Fixtures", () => {
  describe("Cypress Test File Probes", () => {
    const fixturesDir = path.resolve(import.meta.dir, "../e2e-fixtures/hollow-tests/cypress/workflows");
    const issuePath = path.join(fixturesDir, "TodoList.cy.ts");
    const cleanPath = path.join(fixturesDir, "TodoListClean.cy.ts");
    const lookalikePath = path.join(fixturesDir, "TodoListLookalike.cy.ts");
    const assertionFreePath = path.join(fixturesDir, "TodoListAssertionFree.cy.ts");

    it("flags forbidden focused test (it.only) in Cypress (.cy.ts) fixture file", async () => {
      const code = fs.readFileSync(issuePath, "utf-8");
      const relPath = "cypress/tests/workflows/TodoList.cy.ts";
      const findings = await checkHollowTests(relPath, code);
      const focusedFinding = findings.find((f) => f.rule === NO_FOCUSED_TEST_RULE);
      const missingAssertion = findings.find((f) => f.rule === MISSING_ASSERTION_RULE);

      expect(focusedFinding?.rule).toBe(NO_FOCUSED_TEST_RULE);
      expect(focusedFinding?.severity).toBe("error");
      expect(focusedFinding?.file).toBe(relPath);
      expect(missingAssertion).toBeUndefined();
    });

    it("passes cleanly on corrected counterpart fixture without .only and with assertions", async () => {
      const code = fs.readFileSync(cleanPath, "utf-8");
      const relPath = "cypress/tests/workflows/TodoListClean.cy.ts";
      const hollowFindings = await checkHollowTests(relPath, code);
      const eslintFindings = await checkWithEslint(relPath, code);

      expect(hollowFindings).toEqual([]);
      expect(eslintFindings.filter((f) => f.severity === "error")).toEqual([]);
    });

    it("does not false-positive on legitimate lookalike with non-test .only and Cypress should assertion", async () => {
      const code = fs.readFileSync(lookalikePath, "utf-8");
      const relPath = "cypress/tests/workflows/TodoListLookalike.cy.ts";
      const hollowFindings = await checkHollowTests(relPath, code);

      expect(hollowFindings).toEqual([]);
    });

    it("flags genuine assertion-free Cypress test as missing-assertion", async () => {
      const code = fs.readFileSync(assertionFreePath, "utf-8");
      const relPath = "cypress/tests/workflows/TodoListAssertionFree.cy.ts";
      const findings = await checkHollowTests(relPath, code);
      const missingAssertion = findings.find((f) => f.rule === MISSING_ASSERTION_RULE);

      expect(missingAssertion?.rule).toBe(MISSING_ASSERTION_RULE);
      expect(missingAssertion?.severity).toBe("error");
    });

    it("flags empty callback in Cypress should as missing-assertion", async () => {
      const code = `
describe("Workflow with empty callback", () => {
  it("has empty assertion callback", () => {
    cy.get(".item").should(() => {});
  });
});
`;
      const relPath = "cypress/tests/workflows/TodoListEmptyCallback.cy.ts";
      const findings = await checkHollowTests(relPath, code);
      const missingAssertion = findings.find((f) => f.rule === MISSING_ASSERTION_RULE);

      expect(missingAssertion?.rule).toBe(MISSING_ASSERTION_RULE);
    });

    it("accepts valid nonempty Cypress assertion callback with expect", async () => {
      const code = `
describe("Workflow with nonempty callback", () => {
  it("has valid assertion callback", () => {
    cy.get(".item").should(($el) => {
      expect($el).to.have.length(1);
    });
  });
});
`;
      const relPath = "cypress/tests/workflows/TodoListNonemptyCallback.cy.ts";
      const findings = await checkHollowTests(relPath, code);

      expect(findings).toEqual([]);
    });

    it("does not count ordinary objects with .should method as Cypress assertions", async () => {
      const code = `
describe("Non-cypress should call", () => {
  it("calls fake should on plain object", () => {
    const helper = { should: (cb: () => void) => cb() };
    helper.should(() => {});
  });
});
`;
      const relPath = "cypress/tests/workflows/TodoListFakeShould.cy.ts";
      const findings = await checkHollowTests(relPath, code);
      const missingAssertion = findings.find((f) => f.rule === MISSING_ASSERTION_RULE);

      expect(missingAssertion?.rule).toBe(MISSING_ASSERTION_RULE);
    });
  });

  describe("React Hook Missing Dependency Detection", () => {
    const compPath = "src/components/NotificationBanner.tsx";

    it("flags missing hook dependency when closure variable is omitted from deps array", async () => {
      const issueBearingCode = `
import React, { useEffect } from 'react';

export function NotificationBanner({ accountId, bannerTitle }: { accountId: string; bannerTitle: string }) {
    useEffect(() => {
        const id = accountId;
    }, []);

    return <div>{bannerTitle}</div>;
}
`;
      const findings = await checkWithEslint(compPath, issueBearingCode);
      const hookFinding = findings.find((f) => f.rule === "react-hooks/exhaustive-deps");

      expect(hookFinding?.rule).toBe("react-hooks/exhaustive-deps");
      expect(hookFinding?.severity).toBe("warning");
    });

    it("passes cleanly when dependency is included in deps array", async () => {
      const correctedCode = `
import React, { useEffect } from 'react';

export function NotificationBanner({ accountId, bannerTitle }: { accountId: string; bannerTitle: string }) {
    useEffect(() => {
        const id = accountId;
    }, [accountId]);

    return <div>{bannerTitle}</div>;
}
`;
      const findings = await checkWithEslint(compPath, correctedCode);
      const hookFinding = findings.find((f) => f.rule === "react-hooks/exhaustive-deps");

      expect(hookFinding).toBeUndefined();
    });
  });

  describe("Type Assertion vs Narrowing Discipline", () => {
    const middlewarePath = "src/utils/routing/resolveFormat.ts";

    it("flags type assertion bypass with consistent-type-assertions", async () => {
      const assertionCode = `
enum DocumentFormat {
  PDF = 'pdf',
  HTML = 'html'
}

export function isValidFormat(match: string): boolean {
  return Object.values(DocumentFormat).includes(match as DocumentFormat);
}
`;
      const findings = await checkWithEslint(middlewarePath, assertionCode);
      const assertionFinding = findings.find((f) => f.rule === "@typescript-eslint/consistent-type-assertions");

      expect(assertionFinding?.rule).toBe("@typescript-eslint/consistent-type-assertions");
    });

    it("passes cleanly when using type predicate narrowing instead of assertion", async () => {
      const narrowedCode = `
enum DocumentFormat {
  PDF = 'pdf',
  HTML = 'html'
}

function isDocumentFormat(val: string): val is DocumentFormat {
  return Object.values(DocumentFormat).some((p) => p === val);
}

export function isValidFormat(match: string): boolean {
  return isDocumentFormat(match);
}
`;
      const findings = await checkWithEslint(middlewarePath, narrowedCode);
      const assertionFinding = findings.find((f) => f.rule === "@typescript-eslint/consistent-type-assertions");

      expect(assertionFinding).toBeUndefined();
    });
  });

  describe("Mock Path Exclusion Integrity", () => {
    it("exempts mock files from comment-discipline syntax restatement rules", async () => {
      const mockPath = "src/mock/inventoryDataset.mock.ts";
      const mockCode = `
// Inventory catalog records mock
export const inventoryMock = {
  items: [1, 2, 3]
};
`;
      const findings = await checkWithEslint(mockPath, mockCode);
      const commentFinding = findings.find((f) => f.rule.startsWith("comment-discipline/"));

      expect(commentFinding).toBeUndefined();
    });

    it("flags redundant syntax restatements in production source files", async () => {
      const prodPath = "src/components/InventoryGrid.tsx";
      const prodCode = `
/**
 * Calculates total items.
 */
export function calculateTotalItems(items: number[]): number {
  return items.length;
}
`;
      const findings = await checkWithEslint(prodPath, prodCode);
      const commentFinding = findings.find((f) => f.rule === "comment-discipline/no-syntax-restatement");

      expect(commentFinding?.rule).toBe("comment-discipline/no-syntax-restatement");
    });
  });
});
