import { describe, expect, it } from "bun:test";
import { checkHollowTests } from "../src/checks/hollow-tests.js";

const NO_LOGIC_IN_TEST_RULE = "no-logic-in-test";
const NO_LOOP_IN_TEST_RULE = "no-loop-in-test";
const HOLLOW_TESTS_CHECK = "hollow-tests";
const MISSING_ASSERTION_RULE = "missing-assertion";

describe("Hollow Test Assertions Checker (Move #7 & #3)", () => {
  it("flags toHaveBeenCalled() called without arguments", () => {
    const code = `
      it("saves the user", () => {
        const spy = vi.fn();
        saveUser(spy);
        expect(spy).toHaveBeenCalled();
      });
    `;

    const findings = checkHollowTests("src/user.test.ts", code);

    expect(findings.some((f) => f.rule === "hollow-call-assertion")).toBe(true);
    expect(findings[0]?.why).toContain("Assertion quality");
  });

  it("flags bare toBeDefined() and toBeTruthy() on function call results", () => {
    const code = `
      it("generates token", () => {
        const token = generateToken();
        expect(token).toBeDefined();
        expect(token).toBeTruthy();
      });
    `;

    const findings = checkHollowTests("src/auth.test.ts", code);

    expect(findings.filter((f) => f.rule === "hollow-shape-assertion").length).toBe(2);
  });

  it("flags forgotten .only in tests", () => {
    const code = `
      it.only("runs this test exclusively", () => {
        expect(add(1, 1)).toBe(2);
      });
    `;

    const findings = checkHollowTests("src/calc.test.ts", code);

    expect(findings.some((f) => f.rule === "no-focused-test")).toBe(true);
  });

  it("flags tests without any assertions", () => {
    const code = `
      it("renders without exploding", () => {
        render(<App />);
        // no assertions made!
      });
    `;

    const findings = checkHollowTests("src/app.test.tsx", code);

    expect(findings.some((f) => f.rule === MISSING_ASSERTION_RULE)).toBe(true);
  });

  it("passes comprehensive, behavior-verifying tests", () => {
    const code = `
      it("updates the balance correctly", () => {
        const account = new Account(100);
        account.deposit(50);
        expect(account.balance).toBe(150);
      });
    `;
    const findings = checkHollowTests("src/account.test.ts", code);

    expect(findings).toEqual([]);
  });

  it("recognizes Playwright expect.poll as an assertion", () => {
    const code = `
      test("polls element state", async () => {
        await expect.poll(() => getScrollLeft()).toBe(600);
      });
    `;

    const findings = checkHollowTests("e2e/test.spec.ts", code);

    expect(findings.some((f) => f.rule === MISSING_ASSERTION_RULE)).toBe(false);
  });

  it("flags tautological assertions comparing expressions to themselves", () => {
    const code = `
      it("tests tautology", () => {
        expect(true).toBe(true);
        expect(result).toEqual(result);
      });
    `;

    const findings = checkHollowTests("src/tautology.test.ts", code);
    const tautologies = findings.filter((f) => f.rule === "tautological-assertion");

    expect(tautologies.length).toBe(2);
    expect(tautologies[0]?.severity).toBe("error");
    expect(tautologies[0]?.why).toContain("Assertion integrity");
  });

  it("flags conditional assertions inside test functions", () => {
    const code = `
      it("tests user conditionally", () => {
        const user = fetchUser();
        if (user) {
          expect(user.id).toBe(1);
        }
      });
    `;

    const findings = checkHollowTests("src/user.test.ts", code);
    const conditionals = findings.filter((f) => f.rule === NO_LOGIC_IN_TEST_RULE);

    expect(conditionals.length).toBe(1);
    expect(conditionals[0]?.severity).toBe("error");
    expect(conditionals[0]?.message).toContain("'if'");
    expect(conditionals[0]?.why).toContain("Test determinism");
  });

  it("flags loops wrapping assertions in tests (for, for..of, for..in, while, do..while)", () => {
    const code = `
      it("tests with various loops", () => {
        for (const item of items) {
          expect(item).toBeDefined();
        }
        for (let i = 0; i < 5; i++) {
          expect(i).toBeLessThan(5);
        }
        for (const k in map) {
          expect(k).toBeTruthy();
        }
        while (hasMore) {
          expect(next()).toBeDefined();
        }
        do {
          expect(poll()).toBe(true);
        } while (retry);
      });
    `;

    const findings = checkHollowTests("src/loop.test.ts", code);
    const loopFindings = findings.filter((f) => f.rule === NO_LOGIC_IN_TEST_RULE);

    expect(loopFindings.length).toBe(5);
    expect(loopFindings.some((f) => f.message.includes("'for..of'"))).toBe(true);
    expect(loopFindings.some((f) => f.message.includes("'for'"))).toBe(true);
    expect(loopFindings.some((f) => f.message.includes("'for..in'"))).toBe(true);
    expect(loopFindings.some((f) => f.message.includes("'while'"))).toBe(true);
    expect(loopFindings.some((f) => f.message.includes("'do..while'"))).toBe(true);

    const noLoopFindings = findings.filter((f) => f.rule === NO_LOOP_IN_TEST_RULE);

    expect(noLoopFindings.length).toBe(0);
  });

  it("flags loops without inner assertions inside test functions as no-loop-in-test warnings", () => {
    const code = `
      it("tests setup with procedural loops", () => {
        for (const item of items) {
          setup(item);
        }
        for (let i = 0; i < 5; i++) {
          populate(i);
        }
        for (const k in map) {
          configure(k);
        }
        while (hasPending()) {
          processNext();
        }
        do {
          drain();
        } while (retry);

        expect(isComplete()).toBe(true);
      });
    `;

    const findings = checkHollowTests("src/procedural-loop.test.ts", code);
    const loopWarnings = findings.filter((f) => f.rule === NO_LOOP_IN_TEST_RULE);
    const logicErrors = findings.filter((f) => f.rule === NO_LOGIC_IN_TEST_RULE);

    expect(loopWarnings.length).toBe(5);
    expect(logicErrors.length).toBe(0);
    expect(loopWarnings.every((f) => f.severity === "warning")).toBe(true);
    expect(loopWarnings.some((f) => f.message.includes("'for..of'"))).toBe(true);
    expect(loopWarnings.some((f) => f.message.includes("'for'"))).toBe(true);
    expect(loopWarnings.some((f) => f.message.includes("'for..in'"))).toBe(true);
    expect(loopWarnings.some((f) => f.message.includes("'while'"))).toBe(true);
    expect(loopWarnings.some((f) => f.message.includes("'do..while'"))).toBe(true);
    expect(loopWarnings[0]?.why).toBe(
      "Readability and determinism: Loops in test setup or assertions obscure test flow. Use straight-line actions, array utilities, or it.each instead."
    );
    expect(loopWarnings[0]?.suggestion).toBe(
      "Unroll the loop into explicit straight-line actions or use it.each."
    );
  });

  it("does not flag loops outside test functions (helpers, module scope, setup fixtures)", () => {
    const code = `
      function createFixtures() {
        const res = [];
        for (let i = 0; i < 5; i++) {
          res.push(i);
        }
        for (const item of items) {
          process(item);
        }
        while (more()) {
          step();
        }
        return res;
      }

      describe("my suite", () => {
        function describeHelper() {
          for (let j = 0; j < 3; j++) {
            init(j);
          }
        }

        it("straight-line test case", () => {
          const fixtures = createFixtures();
          expect(fixtures.length).toBe(5);
        });
      });
    `;

    const findings = checkHollowTests("src/helpers.test.ts", code);
    const loopWarnings = findings.filter((f) => f.rule === NO_LOOP_IN_TEST_RULE);
    const logicErrors = findings.filter((f) => f.rule === NO_LOGIC_IN_TEST_RULE);

    expect(loopWarnings.length).toBe(0);
    expect(logicErrors.length).toBe(0);
  });

  it("flags switch statements and ternaries wrapping assertions in tests", () => {
    const code = `
      it("tests with switch and ternary", () => {
        switch (mode) {
          case "a":
            expect(val).toBe(1);
            break;
          default:
            expect(val).toBe(0);
        }

        mode === "a" ? expect(val).toBe(1) : expect(val).toBe(0);
      });
    `;

    const findings = checkHollowTests("src/branch.test.ts", code);
    const branchFindings = findings.filter((f) => f.rule === NO_LOGIC_IN_TEST_RULE);

    expect(branchFindings.length).toBe(2);
    expect(branchFindings.some((f) => f.message.includes("'switch'"))).toBe(true);
    expect(branchFindings.some((f) => f.message.includes("'ternary'"))).toBe(true);
  });

  it("allows straight-line assertions and parameterized it.each test definitions", () => {
    const code = `
      it("straight-line assertions", () => {
        const a = 1;
        const b = 2;
        expect(a).toBe(1);
        expect(b).toBe(2);
      });

      it.each([
        [1, 2, 3],
        [2, 3, 5],
      ])("adds %i + %i = %i", (a, b, expected) => {
        expect(a + b).toBe(expected);
      });
    `;

    const findings = checkHollowTests("src/valid.test.ts", code);
    const logicFindings = findings.filter((f) => f.rule === NO_LOGIC_IN_TEST_RULE);

    expect(logicFindings.length).toBe(0);
  });

  it("flags static sleeps and fixed timeouts in test files", () => {
    const code = `
      test("loads page after sleep", async () => {
        await sleep(1000);
        setTimeout(() => {}, 500);
        await page.waitForTimeout(3000);
        cy.wait(5000);
        expect(element).toBeVisible();
      });
    `;

    const findings = checkHollowTests("src/flow.test.ts", code);
    const sleepFindings = findings.filter((f) => f.rule === "no-static-sleep");

    expect(sleepFindings.length).toBe(4);
    expect(sleepFindings.every((f) => f.severity === "error")).toBe(true);
    expect(sleepFindings[0]?.why).toContain("Test flakiness & performance");
  });

  it("flags arithmetic calculations inside assertion matchers", () => {
    const code = `
      it("renders the slot size correctly", () => {
        expect(slots[0]?.size).toBe(120 * pxPerMinute);
        expect(slots[1]?.size).toBe(90 * pxPerMinute);
        expect(totalWidth).toBe(420 * pxPerMinute);
        expect(offset).toEqual(base + 50);
      });
    `;

    const findings = checkHollowTests("src/slots.test.ts", code);
    const calcFindings = findings.filter((f) => f.rule === "no-assertion-calculation");

    expect(calcFindings.length).toBe(4);
    expect(calcFindings.every((f) => f.severity === "error")).toBe(true);
    expect(calcFindings[0]?.message).toContain("120 * pxPerMinute");
    expect(calcFindings[0]?.why).toContain("Test determinism");
  });

  it("allows direct literal values and string concatenation in assertions", () => {
    const code = `
      it("renders with direct constants and values", () => {
        const EXPECTED_SIZE = 120;
        expect(slots[0]?.size).toBe(EXPECTED_SIZE);
        expect(response.status).toBe(200);
        expect(label).toBe("prefix_" + id);
        expect(items).toHaveLength(5);
      });
    `;

    const findings = checkHollowTests("src/slots.test.ts", code);
    const calcFindings = findings.filter((f) => f.rule === "no-assertion-calculation");

    expect(calcFindings.length).toBe(0);
  });

  it("flags duplicate cases in it.each array tables", () => {
    const code = `
      it.each([
        [1, 2, 3],
        [4, 5, 9],
        [1, 2, 3],
      ])("adds %i + %i = %i", (a, b, expected) => {
        expect(a + b).toBe(expected);
      });
    `;

    const findings = checkHollowTests("src/calc.test.ts", code);
    const duplicates = findings.filter((f) => f.rule === "duplicate-each-case");

    expect(duplicates.length).toBe(1);
    expect(duplicates[0]?.severity).toBe("error");
    expect(duplicates[0]?.message).toContain("[1, 2, 3]");
    expect(duplicates[0]?.why).toContain("Test redundancy");
  });

  it("flags duplicate cases in it.each tagged template tables", () => {
    const code = `
      it.each\`
        a    | b    | expected
        \${1} | \${2} | \${3}
        \${4} | \${5} | \${9}
        \${1} | \${2} | \${3}
      \`("adds $a + $b = $expected", ({ a, b, expected }) => {
        expect(a + b).toBe(expected);
      });
    `;

    const templateFindings = checkHollowTests("src/tagged-calc.test.ts", code);
    const matched = templateFindings.find((finding) => finding.rule === "duplicate-each-case");

    expect(matched?.severity).toBe("error");
    expect(matched?.message).toContain("1, 2, 3");
  });

  it("flags dead parameters in parameterized test callbacks", () => {
    const code = `
      it.each([
        { input: "hello", expected: 5, extraTag: "test" },
      ])("tests length", ({ input, expected, extraTag, _discarded }) => {
        expect(input.length).toBe(expected);
      });
    `;

    const findings = checkHollowTests("src/str.test.ts", code);
    const deadParams = findings.filter((f) => f.rule === "dead-each-parameter");

    expect(deadParams.length).toBe(1);
    expect(deadParams[0]?.severity).toBe("error");
    expect(deadParams[0]?.message).toContain("'extraTag'");
    expect(deadParams[0]?.why).toContain("Test veracity");
  });

  it("flags over-parameterized test tables with more than 15 cases", () => {
    const cases = Array.from({ length: 18 }, (_, i) => `[${i}, ${i + 1}]`).join(",\n");
    const code = `
      it.each([
        ${cases}
      ])("tests increment %i", (val, expected) => {
        expect(val + 1).toBe(expected);
      });
    `;

    const findings = checkHollowTests("src/bloat.test.ts", code);
    const overParams = findings.filter((f) => f.rule === "over-parameterized-test");

    expect(overParams.length).toBe(1);
    expect(overParams[0]?.severity).toBe("warning");
    expect(overParams[0]?.message).toContain("18 cases");
    expect(overParams[0]?.why).toContain("Test hygiene & performance");
  });

  it("allows well-bounded parameterized test tables with unique cases and used parameters", () => {
    const code = `
      it.each([
        [1, 2, 3],
        [2, 3, 5],
        [3, 4, 7],
      ])("adds %i + %i = %i", (a, b, expected) => {
        expect(a + b).toBe(expected);
      });
    `;

    const findings = checkHollowTests("src/valid-each.test.ts", code);

    expect(findings.some((f) => f.rule === "duplicate-each-case")).toBe(false);
    expect(findings.some((f) => f.rule === "dead-each-parameter")).toBe(false);
    expect(findings.some((f) => f.rule === "over-parameterized-test")).toBe(false);
  });

  it("flags parameterized tests without any assertions", () => {
    const code = `
      it.each([
        [1, 2],
        [3, 4],
      ])("runs %i without asserting", (a, b) => {
        const sum = a + b;
        // no assertions made!
      });
    `;

    const findings = checkHollowTests("src/empty-each.test.ts", code);
    const missing = findings.filter((f) => f.rule === MISSING_ASSERTION_RULE);

    expect(missing.length).toBe(1);
    expect(missing[0]?.severity).toBe("error");
  });

  it("flags forgotten .only in Cypress (.cy.ts) spec files", () => {
    const code = `
      describe("workflow", () => {
        it.only("runs focused workflow", () => {
          cy.get(".item").should("be.visible");
        });
      });
    `;

    const findings = checkHollowTests("cypress/tests/workflows/TodoList.cy.ts", code);

    expect(findings.some((f) => f.rule === "no-focused-test")).toBe(true);
  });

  it("recognizes Cypress assertions with local function declarations and expressions", () => {
    const code = `
      function assertValidItem(val: any) {
        expect(val).toBe(1);
      }
      const assertValidArrow = (val: any) => {
        expect(val).toBe(2);
      };
      const assertValidExpr = function(val: any) {
        expect(val).toBe(3);
      };

      describe("cypress suite", () => {
        it("passes with function declaration callback", () => {
          cy.get(".item").should(assertValidItem);
        });

        it("passes with arrow function callback", () => {
          cy.get(".item").should(assertValidArrow);
        });

        it("passes with function expression callback", () => {
          cy.get(".item").and(assertValidExpr);
        });
      });
    `;

    const findings = checkHollowTests("cypress/tests/callbacks.cy.ts", code);
    const missingAssertionFindings = findings.filter((f) => f.rule === MISSING_ASSERTION_RULE);

    expect(missingAssertionFindings).toHaveLength(0);
  });

  it("flags Cypress tests when local callback function has no assertions or is unknown", () => {
    const code = `
      function emptyCallback(val: any) {
        console.log(val);
      }

      describe("cypress suite with empty callbacks", () => {
        it("fails when local callback has no assertions", () => {
          cy.get(".item").should(emptyCallback);
        });

        it("fails when callback identifier is unresolved", () => {
          cy.get(".item").should(unresolvedCallback);
        });
      });
    `;

    const findings = checkHollowTests("cypress/tests/empty-callbacks.cy.ts", code);
    const missingAssertionFindings = findings.filter((f) => f.rule === MISSING_ASSERTION_RULE);

    expect(missingAssertionFindings).toHaveLength(2);
  });

  it("verifies test-title-contract-mismatch and explicit value matching", () => {
    const code = `
      it("returns null when item is empty", () => {
        expect(getItem()).toBe(null);
      });

      it("returns undefined when item is missing", () => {
        expect(getItem()).toEqual(undefined);
      });

      it("returns false on failure", () => {
        expect(getStatus()).toBe(false);
      });

      it("returns true on success", () => {
        expect(getStatus()).toEqual(true);
      });

      it("returns null with toBeNull matcher", () => {
        expect(getItem()).toBeNull();
      });

      it("returns false with mismatching assertion", () => {
        expect(getStatus()).toBe(123);
      });
    `;

    const findings = checkHollowTests("tests/contract.test.ts", code);
    const mismatchFindings = findings.filter((f) => f.rule === "test-title-contract-mismatch");

    expect(mismatchFindings).toHaveLength(1);
    expect(mismatchFindings[0]?.severity).toBe("warning");
    expect(mismatchFindings[0]?.message).toContain("returning 'false'");
  });

  it("verifies exact contract, metadata, and coordinates for all hollow-tests rules", () => {
    const focusedCode = `
      describe.only("suite", () => {
        test.only("case", () => {
          expect(sum(1, 2)).toBe(3);
        });
      });
    `;
    const focusedFindings = checkHollowTests("src/focused.test.ts", focusedCode);

    expect(focusedFindings.length).toBe(2);
    expect(focusedFindings[0]?.check).toBe(HOLLOW_TESTS_CHECK);
    expect(focusedFindings[0]?.rule).toBe("no-focused-test");
    expect(focusedFindings[0]?.severity).toBe("error");
    expect(focusedFindings[0]?.line).toBe(2);
    expect(focusedFindings[0]?.column).toBe(7);
    expect(focusedFindings[0]?.message).toBe("Forbidden focused test 'describe.only()' found.");
    expect(focusedFindings[0]?.why).toBe("Test hygiene: Forgotten .only turns one test green instead of running the complete suite.");
    expect(focusedFindings[0]?.suggestion).toBe("Remove .only so the complete test suite runs in review and CI.");
    expect(focusedFindings[1]?.message).toBe("Forbidden focused test 'test.only()' found.");

    const missingCode = `
      it("empty test", () => {
        const a = 1;
      });
    `;
    const missingFindings = checkHollowTests("src/missing.test.ts", missingCode);

    expect(missingFindings.length).toBe(1);
    expect(missingFindings[0]?.check).toBe(HOLLOW_TESTS_CHECK);
    expect(missingFindings[0]?.rule).toBe(MISSING_ASSERTION_RULE);
    expect(missingFindings[0]?.severity).toBe("error");
    expect(missingFindings[0]?.line).toBe(2);
    expect(missingFindings[0]?.column).toBe(7);
    expect(missingFindings[0]?.message).toBe('Test \'"empty test"\' has zero assertions.');
    expect(missingFindings[0]?.why).toBe("Assertion coverage: A test that merely executes code without asserting behavior gives false confidence.");
    expect(missingFindings[0]?.suggestion).toBe("Add meaningful expect(...) assertions that verify state changes or outputs.");

    const shapeCode = `
      it("checks shape", () => {
        expect(call()).toBeDefined();
        expect(call()).toBeTruthy();
      });
    `;
    const shapeFindings = checkHollowTests("src/shape.test.ts", shapeCode);

    expect(shapeFindings.length).toBe(2);
    expect(shapeFindings[0]?.check).toBe(HOLLOW_TESTS_CHECK);
    expect(shapeFindings[0]?.rule).toBe("hollow-shape-assertion");
    expect(shapeFindings[0]?.severity).toBe("warning");
    expect(shapeFindings[0]?.line).toBe(3);
    expect(shapeFindings[0]?.column).toBe(9);
    expect(shapeFindings[0]?.message).toBe("Hollow assertion: 'toBeDefined()' checks value presence instead of value correctness.");
    expect(shapeFindings[0]?.why).toBe("Assertion quality: toBeDefined() or toBeTruthy() lets mutated return values survive undetected while keeping tests green.");
    expect(shapeFindings[0]?.suggestion).toBe("Assert the concrete value (e.g. toEqual(...) or toBe(...)) instead of merely checking existence.");
    expect(shapeFindings[1]?.message).toBe("Hollow assertion: 'toBeTruthy()' checks value presence instead of value correctness.");
    expect(shapeFindings[1]?.why).toBe("Assertion quality: toBeDefined() or toBeTruthy() lets mutated return values survive undetected while keeping tests green.");
    expect(shapeFindings[1]?.suggestion).toBe("Assert the concrete value (e.g. toEqual(...) or toBe(...)) instead of merely checking existence.");

    const callCode = `
      it("checks call", () => {
        expect(spy).toHaveBeenCalled();
      });
    `;
    const callFindings = checkHollowTests("src/call.test.ts", callCode);

    expect(callFindings.length).toBe(1);
    expect(callFindings[0]?.check).toBe(HOLLOW_TESTS_CHECK);
    expect(callFindings[0]?.rule).toBe("hollow-call-assertion");
    expect(callFindings[0]?.severity).toBe("warning");
    expect(callFindings[0]?.line).toBe(3);
    expect(callFindings[0]?.column).toBe(9);
    expect(callFindings[0]?.message).toBe("Hollow assertion: 'toHaveBeenCalled()' checks call existence without verifying arguments.");
    expect(callFindings[0]?.why).toBe("Assertion quality: toHaveBeenCalled() checks call existence without verifying arguments.");
    expect(callFindings[0]?.suggestion).toBe("Use toHaveBeenCalledWith(...) to verify the exact payload passed to the collaborator.");

    const tautologyCode = `
      it("checks tautology", () => {
        expect(actual).toBe(actual);
      });
    `;
    const tautologyFindings = checkHollowTests("src/taut.test.ts", tautologyCode);

    expect(tautologyFindings.length).toBe(1);
    expect(tautologyFindings[0]?.check).toBe(HOLLOW_TESTS_CHECK);
    expect(tautologyFindings[0]?.rule).toBe("tautological-assertion");
    expect(tautologyFindings[0]?.severity).toBe("error");
    expect(tautologyFindings[0]?.line).toBe(3);
    expect(tautologyFindings[0]?.column).toBe(9);
    expect(tautologyFindings[0]?.message).toBe("Tautological assertion: 'expect(actual).toBe(actual)' compares identical expressions.");
    expect(tautologyFindings[0]?.why).toBe("Assertion integrity: Comparing an expression to itself always passes regardless of whether the system under test works.");
    expect(tautologyFindings[0]?.suggestion).toBe("Assert the concrete expected invariant or value instead of comparing identical expressions.");

    const sleepCode = `
      test("sleeps", async () => {
        await sleep(100);
        expect(sum(1, 1)).toBe(2);
      });
    `;
    const sleepFindings = checkHollowTests("src/sleep.test.ts", sleepCode);

    expect(sleepFindings.length).toBe(1);
    expect(sleepFindings[0]?.check).toBe(HOLLOW_TESTS_CHECK);
    expect(sleepFindings[0]?.rule).toBe("no-static-sleep");
    expect(sleepFindings[0]?.severity).toBe("error");
    expect(sleepFindings[0]?.line).toBe(3);
    expect(sleepFindings[0]?.column).toBe(15);
    expect(sleepFindings[0]?.message).toBe("Anti-pattern: Static sleep/timeout 'sleep()' detected in test.");
    expect(sleepFindings[0]?.why).toBe("Test flakiness & performance: Static sleeps mask timing bugs and arbitrarily inflate CI runtime.");
    expect(sleepFindings[0]?.suggestion).toBe("Use framework auto-waiting, event promises, or condition polling instead of static delays.");

    const calcCode = `
      it("calculates", () => {
        expect(result).toBe(base - 10);
      });
    `;
    const calcFindings = checkHollowTests("src/calc.test.ts", calcCode);

    expect(calcFindings.length).toBe(1);
    expect(calcFindings[0]?.check).toBe(HOLLOW_TESTS_CHECK);
    expect(calcFindings[0]?.rule).toBe("no-assertion-calculation");
    expect(calcFindings[0]?.severity).toBe("error");
    expect(calcFindings[0]?.line).toBe(3);
    expect(calcFindings[0]?.column).toBe(29);
    expect(calcFindings[0]?.message).toBe("Assertion contains inline calculation ('base - 10').");
    expect(calcFindings[0]?.why).toBe("Test determinism: Inline arithmetic in assertions duplicates implementation logic and can hide incorrect assumptions. Declare explicit expected constants or pre-computed fixtures instead.");
    expect(calcFindings[0]?.suggestion).toBe("Replace the inline calculation with a pre-computed constant or explicit expected value.");

    const fixtureCode = `
      it("fixture scope", () => {
        const items = [1, 2, 3, 4, 5, 6, 7];
        expect(items.length).toBe(7);
      });
    `;
    const fixtureFindings = checkHollowTests("src/fixture.test.ts", fixtureCode);

    expect(fixtureFindings.length).toBe(1);
    expect(fixtureFindings[0]?.check).toBe(HOLLOW_TESTS_CHECK);
    expect(fixtureFindings[0]?.rule).toBe("test-fixture-scope");
    expect(fixtureFindings[0]?.severity).toBe("warning");
    expect(fixtureFindings[0]?.line).toBe(3);
    expect(fixtureFindings[0]?.column).toBe(15);
    expect(fixtureFindings[0]?.message).toBe("Large test fixture 'items' (7 items) declared inside test case body.");
    expect(fixtureFindings[0]?.why).toBe("Test clarity & fixture scoping: Declaring massive static fixture data inside test scope clutters test bodies and obscures assertion logic.");
    expect(fixtureFindings[0]?.suggestion).toBe("Move large static fixture declarations outside the test scope (module-level or dedicated mock/fixture files).");
  });

  it("flags duplicate test bodies in the same file with identical assertions and logic", () => {
    const code = `
      it("computes order summary total", () => {
        const subtotal = 100;
        const tax = 10;
        const total = subtotal + tax;

        expect(total).toBe(110);
      });

      it("calculates checkout total", () => {
        // Different comment and formatting
        const subtotal = 100;
        const tax = 10;
        const total = subtotal + tax;

        expect(total).toBe(110);
      });
    `;

    const findings = checkHollowTests("src/order.test.ts", code);

    const duplicates = findings.filter((f) => f.rule === "duplicate-test-body");

    expect(duplicates.length).toBe(1);

    expect(duplicates.at(0)?.severity).toBe("error");

    expect(duplicates.at(0)?.line).toBe(10);

    expect(duplicates.at(0)?.message).toContain("line 2");

    expect(duplicates.at(0)?.why).toContain("Duplicate test bodies execute identical assertions");
  });

  it("does not flag near-duplicate tests with different assertions or expected values", () => {
    const code = `
      it("computes standard discount", () => {
        const base = 100;
        const discount = 10;

        expect(base - discount).toBe(90);
      });

      it("computes premium discount", () => {
        const base = 100;
        const discount = 20;

        expect(base - discount).toBe(80);
      });
    `;

    const findings = checkHollowTests("src/discount.test.ts", code);

    const duplicates = findings.filter((f) => f.rule === "duplicate-test-body");

    expect(duplicates).toHaveLength(0);
  });

  it("does not flag identical test bodies across different describe blocks with separate setups", () => {
    const code = `
      describe("Admin context", () => {
        let role = "";

        beforeEach(() => {
          role = "admin";
        });

        it("verifies permissions", () => {
          const user = { role };
          const allowed = user.role === "admin";

          expect(allowed).toBe(true);
        });
      });

      describe("Member context", () => {
        let role = "";

        beforeEach(() => {
          role = "member";
        });

        it("verifies permissions", () => {
          const user = { role };
          const allowed = user.role === "admin";

          expect(allowed).toBe(true);
        });
      });
    `;

    const findings = checkHollowTests("src/permissions.test.ts", code);

    const duplicates = findings.filter((f) => f.rule === "duplicate-test-body");

    expect(duplicates).toHaveLength(0);
  });

  it("flags duplicate test bodies within the same describe block", () => {
    const code = `
      describe("Checkout suite", () => {
        it("first case in suite", () => {
          const amount = 50;
          const fee = 5;
          const total = amount + fee;

          expect(total).toBe(55);
        });

        it("duplicate case in suite", () => {
          const amount = 50;
          const fee = 5;
          const total = amount + fee;

          expect(total).toBe(55);
        });
      });
    `;

    const suiteFindings = checkHollowTests("src/checkout.test.ts", code);

    const suiteMatch = suiteFindings.find((f) => f.rule === "duplicate-test-body");

    expect(suiteMatch?.line).toBe(11);

    expect(suiteMatch?.message).toBe(
      "Duplicate test body: test case 'duplicate case in suite' duplicates the test on line 3."
    );
  });

  it("does not flag trivial one-liner test bodies below minimum size threshold", () => {
    const code = `
      it("smoke test one", () => {
        expect(true).toBe(true);
      });

      it("smoke test two", () => {
        expect(true).toBe(true);
      });

      it("concise arrow test one", () => expect(1).toBe(1));

      it("concise arrow test two", () => expect(1).toBe(1));
    `;

    const findings = checkHollowTests("src/smoke.test.ts", code);

    const duplicates = findings.filter((f) => f.rule === "duplicate-test-body");

    expect(duplicates).toHaveLength(0);
  });

  it("handles test modifiers and parameterized each tables correctly", () => {
    const code = `
      it.only("runs focused case", () => {
        const value = "hello";

        expect(value.length).toBe(5);
      });

      it.skip("runs skipped duplicate", () => {
        const value = "hello";

        expect(value.length).toBe(5);
      });

      it.each([1, 2])("handles distinct data table 1", (n) => {
        const res = n * 2;

        expect(res).toBeGreaterThan(0);
      });

      it.each([3, 4])("handles distinct data table 2", (n) => {
        const res = n * 2;

        expect(res).toBeGreaterThan(0);
      });

      it.each([1, 2])("duplicates parameterized table 1", (n) => {
        const res = n * 2;

        expect(res).toBeGreaterThan(0);
      });
    `;

    const findings = checkHollowTests("src/modifiers.test.ts", code);

    const duplicates = findings.filter((f) => f.rule === "duplicate-test-body");

    expect(duplicates.length).toBe(2);

    expect(duplicates.at(0)?.line).toBe(8);

    expect(duplicates.at(0)?.message).toContain("line 2");

    expect(duplicates.at(1)?.line).toBe(26);

    expect(duplicates.at(1)?.message).toContain("line 14");
  });

  it("verifies exact contract, metadata, and coordinates for duplicate-test-body", () => {
    const code = `
      test("first test", () => {
        const item = "alpha";

        expect(item).toBe("alpha");
      });

      test("duplicate test", () => {
        const item = "alpha";

        expect(item).toBe("alpha");
      });
    `;

    const findings = checkHollowTests("src/contract.test.ts", code);

    const matched = findings.find((f) => f.rule === "duplicate-test-body");

    expect(matched?.check).toBe(HOLLOW_TESTS_CHECK);

    expect(matched?.rule).toBe("duplicate-test-body");

    expect(matched?.severity).toBe("error");

    expect(matched?.line).toBe(8);

    expect(matched?.message).toBe(
      "Duplicate test body: test case 'duplicate test' duplicates the test on line 2."
    );

    expect(matched?.why).toBe(
      "Test hygiene: Duplicate test bodies execute identical assertions and logic, bloating suite execution time without testing distinct behavior."
    );

    expect(matched?.suggestion).toBe(
      "Remove the duplicate test case or adjust its inputs and assertions to test unique behavior."
    );
  });
});
