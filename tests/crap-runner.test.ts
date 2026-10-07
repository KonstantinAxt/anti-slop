import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CrapEntry } from "../src/types.js";
import {
  CHECK_NAME,
  type CrapCheckResult,
  DEFAULT_CRAP_THRESHOLD,
  RULE_NAME,
  calculateCrapScore,
  checkCrap,
  coverageForRange,
  extractFunctions,
  filterProductionFilesForCrap,
  findFileCoverage,
  formatCrapReport,
  parseLcov,
  parseLcovDaLine,
} from "../src/checks/crap-runner.js";
import { createSourceFile } from "../src/checks/ast.js";

const END_OF_RECORD = "end_of_record";

async function evaluateCrapFixture(
  tempDir: string,
  filePath: string,
  lcov?: string,
  threshold = 30
): Promise<CrapCheckResult> {
  try {
    return await checkCrap(tempDir, [filePath], threshold, lcov);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
async function assertSingleCleanCrapEntry(
  tempDir: string,
  filePath: string,
  lcov: string,
  threshold = 30
): Promise<CrapEntry | undefined> {
  const { findings, entries } = await evaluateCrapFixture(
    tempDir,
    filePath,
    lcov,
    threshold
  );

  expect(findings.length).toBe(0);
  expect(entries.length).toBe(1);

  return entries[0];
}



describe("CRAP Metric - Formula Invariants", () => {
  it("equals CC when test coverage is 100%", () => {
    expect(calculateCrapScore(1, 100)).toBe(1.0);

    expect(calculateCrapScore(5, 100)).toBe(5.0);

    expect(calculateCrapScore(10, 100)).toBe(10.0);

    expect(calculateCrapScore(25, 100)).toBe(25.0);

    expect(calculateCrapScore(40, 100)).toBe(40.0);
  });

  it("equals CC^2 + CC when test coverage is 0%", () => {
    expect(calculateCrapScore(1, 0)).toBe(2.0);

    expect(calculateCrapScore(2, 0)).toBe(6.0);

    expect(calculateCrapScore(5, 0)).toBe(30.0);

    expect(calculateCrapScore(10, 0)).toBe(110.0);

    expect(calculateCrapScore(12, 0)).toBe(156.0);
  });

  it("calculates exact CRAP score for partial coverage", () => {
    expect(calculateCrapScore(12, 50)).toBe(30.0);

    expect(calculateCrapScore(8, 75)).toBe(9.0);

    expect(calculateCrapScore(6, 80)).toBe(6.3);
  });

  it("clamps coverage between 0% and 100%", () => {
    expect(calculateCrapScore(5, -20)).toBe(calculateCrapScore(5, 0));

    expect(calculateCrapScore(5, -20)).toBe(30.0);

    expect(calculateCrapScore(5, 150)).toBe(calculateCrapScore(5, 100));

    expect(calculateCrapScore(5, 150)).toBe(5.0);
  });

  it("calculates exact CRAP score for CC = 1 at 0%, 50%, and 100% coverage", () => {
    expect(calculateCrapScore(1, 0)).toBe(2.0);

    expect(calculateCrapScore(1, 50)).toBe(1.1);

    expect(calculateCrapScore(1, 100)).toBe(1.0);
  });

  it("surpasses threshold 30 for complex functions even with high coverage", () => {
    expect(calculateCrapScore(31, 100)).toBeGreaterThan(DEFAULT_CRAP_THRESHOLD);
  });

  it("handles 0 cyclomatic complexity", () => {
    expect(calculateCrapScore(0, 0)).toBe(0.0);

    expect(calculateCrapScore(0, 50)).toBe(0.0);

    expect(calculateCrapScore(0, 100)).toBe(0.0);

    expect(calculateCrapScore(0, -10)).toBe(0.0);

    expect(calculateCrapScore(0, 150)).toBe(0.0);
  });

  it("clamps coverage below 0% and above 100% to exact boundary scores", () => {
    expect(calculateCrapScore(2, -10)).toBe(6.0);

    expect(calculateCrapScore(2, -0.1)).toBe(6.0);

    expect(calculateCrapScore(2, 0)).toBe(6.0);

    expect(calculateCrapScore(2, 100)).toBe(2.0);

    expect(calculateCrapScore(2, 100.1)).toBe(2.0);

    expect(calculateCrapScore(2, 200)).toBe(2.0);
  });

  it("rounds CRAP score to 1 decimal place accurately", () => {
    expect(calculateCrapScore(3, 33)).toBe(5.7);

    expect(calculateCrapScore(4, 33)).toBe(8.8);
  });

  it("handles negative cyclomatic complexity", () => {
    expect(calculateCrapScore(-5, 0)).toBe(20.0);

    expect(calculateCrapScore(-5, 100)).toBe(-5.0);

    expect(calculateCrapScore(-5, 50)).toBe(-1.9);
  });

  it("handles extreme complexity and coverage values", () => {
    expect(calculateCrapScore(1000, 0)).toBe(1001000.0);

    expect(calculateCrapScore(1000, 100)).toBe(1000.0);

    expect(calculateCrapScore(10, -500)).toBe(110.0);

    expect(calculateCrapScore(10, 500)).toBe(10.0);
  });
});

describe("CRAP Metric - Cyclomatic Complexity via TypeScript AST", () => {
  it("evaluates simple linear functions as CC = 1", () => {
    const code = `
      export function add(a: number, b: number): number {
        return a + b;
      }
    `;
    const sf = createSourceFile("add.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("add");

    expect(fns[0]?.complexity).toBe(1);
  });

  it("counts decision points for if/else, ternary, loops, and logical operators", () => {
    const code = `
      export function evaluateRisk(score: number, active: boolean, flags?: string[]): string {
        if (score > 100) {
          return "critical";
        } else if (score > 50) {
          for (let i = 0; i < 5; i++) {
            if (active && flags?.length) {
              return "high";
            }
          }
        }
        return score > 20 ? "medium" : "low";
      }
    `;
    const sf = createSourceFile("risk.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.complexity).toBe(8);
  });

  it("counts switch case clauses and catch blocks", () => {
    const code = `
      export function parseState(state: string) {
        try {
          switch (state) {
            case "A":
              return 1;
            case "B":
              return 2;
            case "C":
              return 3;
            default:
              return 0;
          }
        } catch (err) {
          return -1;
        }
      }
    `;
    const sf = createSourceFile("switch.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.complexity).toBe(5);
  });

  it("does not leak nested function complexity into outer function", () => {
    const code = `
      export function processList(items: number[]) {
        if (items.length === 0) return [];
        return items.map((x) => {
          if (x > 10) return x * 2;
          return x;
        });
      }
    `;
    const sf = createSourceFile("nested.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(2);

    const outer = fns.find((f) => f.name === "processList");
    const inner = fns.find((f) => f.name === "(anonymous)");

    expect(outer?.name).toBe("processList");

    expect(inner?.name).toBe("(anonymous)");

    expect(outer?.complexity).toBe(2);

    expect(inner?.complexity).toBe(2);
  });

  it("extracts class methods, constructors, getters, and setters with class names", () => {
    const code = `
      export class AccountService {
        constructor() {}
        get balance(): number { return 100; }
        set balance(val: number) {}
        deposit(amount: number) {
          if (amount <= 0) throw new Error("Invalid");
          return amount;
        }
      }
    `;
    const sf = createSourceFile("account.ts", code);
    const fns = extractFunctions(sf);

    const names = fns.map((f) => f.name);

    expect(names).toContain("AccountService.constructor");

    expect(names).toContain("AccountService.get balance");

    expect(names).toContain("AccountService.set balance");

    expect(names).toContain("AccountService.deposit");
  });

  it("counts property access chain optional chaining (?.) as a decision point", () => {
    const code = `
      export function getProp(user?: { name?: string }) {
        return user?.name;
      }
    `;
    const sf = createSourceFile("opt_prop.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("getProp");

    expect(fns[0]?.complexity).toBe(2);
  });

  it("counts element access chain optional chaining (?.[] ) as a decision point", () => {
    const code = `
      export function getElem(items?: string[], idx: number = 0) {
        return items?.[idx];
      }
    `;
    const sf = createSourceFile("opt_elem.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("getElem");

    expect(fns[0]?.complexity).toBe(2);
  });

  it("counts call chain optional chaining (?.()) as a decision point", () => {
    const code = `
      export function invoke(cb?: () => void) {
        cb?.();
      }
    `;
    const sf = createSourceFile("opt_call.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("invoke");

    expect(fns[0]?.complexity).toBe(2);
  });

  it("counts combined property, element, and call chains correctly", () => {
    const code = `
      export function processChain(handler?: { list?: Array<() => string> }) {
        return handler?.list?.[0]?.();
      }
    `;
    const sf = createSourceFile("opt_combo.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.complexity).toBe(4);
  });

  it("does not count non-optional member access, element access, or calls as decision points", () => {
    const code = `
      export function normalAccess(obj: { items: Array<() => string> }) {
        return obj.items[0]();
      }
    `;
    const sf = createSourceFile("norm_access.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.complexity).toBe(1);
  });

  it("counts ternary conditional expressions as decision points", () => {
    const code = `
      export function ternaryCheck(a: boolean, b: boolean) {
        return a ? (b ? 1 : 2) : 3;
      }
    `;
    const sf = createSourceFile("ternary.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("ternaryCheck");

    expect(fns[0]?.complexity).toBe(3);
  });

  it("counts do-while loops as decision points", () => {
    const code = `
      export function doWhileLoop(count: number) {
        let n = count;
        do {
          n--;
        } while (n > 0);
        return n;
      }
    `;
    const sf = createSourceFile("dowhile.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("doWhileLoop");

    expect(fns[0]?.complexity).toBe(2);
  });

  it("counts for-in loops as decision points", () => {
    const code = `
      export function forInLoop(obj: Record<string, string>) {
        const keys: string[] = [];
        for (const k in obj) {
          keys.push(k);
        }
        return keys;
      }
    `;
    const sf = createSourceFile("forin.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("forInLoop");

    expect(fns[0]?.complexity).toBe(2);
  });

  it("counts for-of loops as decision points", () => {
    const code = `
      export function forOfLoop(items: number[]) {
        let sum = 0;
        for (const item of items) {
          sum += item;
        }
        return sum;
      }
    `;
    const sf = createSourceFile("forof.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("forOfLoop");

    expect(fns[0]?.complexity).toBe(2);
  });

  it("counts while loops as decision points", () => {
    const code = `
      export function whileLoop(n: number) {
        let cur = n;
        while (cur > 0) {
          cur--;
        }
        return cur;
      }
    `;
    const sf = createSourceFile("while.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("whileLoop");

    expect(fns[0]?.complexity).toBe(2);
  });

  it("counts logical AND (&&) as a decision point", () => {
    const code = `
      export function checkAnd(a: boolean, b: boolean) {
        return a && b;
      }
    `;
    const sf = createSourceFile("and.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("checkAnd");

    expect(fns[0]?.complexity).toBe(2);
  });

  it("counts logical OR (||) as a decision point", () => {
    const code = `
      export function checkOr(a: boolean, b: boolean) {
        return a || b;
      }
    `;
    const sf = createSourceFile("or.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("checkOr");

    expect(fns[0]?.complexity).toBe(2);
  });

  it("counts nullish coalescing (??) as a decision point", () => {
    const code = `
      export function checkNullish(name: string | null, fallback: string) {
        return name ?? fallback;
      }
    `;
    const sf = createSourceFile("nullish.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("checkNullish");

    expect(fns[0]?.complexity).toBe(2);
  });

  it("does not count non-short-circuit binary operators as decision points", () => {
    const code = `
      export function mathOps(a: number, b: number) {
        return (a + b) * (a - b) | (a & b) ^ (a << b);
      }
    `;
    const sf = createSourceFile("math.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("mathOps");

    expect(fns[0]?.complexity).toBe(1);
  });

  it("counts each switch case clause as a decision point but ignores default clause", () => {
    const code = `
      export function switchCases(status: number) {
        switch (status) {
          case 200:
            return "OK";
          case 404:
            return "Not Found";
          case 500:
            return "Internal Error";
          default:
            return "Unknown";
        }
      }
    `;
    const sf = createSourceFile("switch_cases.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("switchCases");

    expect(fns[0]?.complexity).toBe(4);
  });

  it("evaluates switch statement with only default clause as CC = 1", () => {
    const code = `
      export function switchOnlyDefault(val: number) {
        switch (val) {
          default:
            return val;
        }
      }
    `;
    const sf = createSourceFile("switch_default.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("switchOnlyDefault");

    expect(fns[0]?.complexity).toBe(1);
  });

  it("counts catch clauses as decision points but ignores finally blocks", () => {
    const code = `
      export function tryCatchFinally() {
        try {
          const x = 1;
          return x;
        } catch (err) {
          return 0;
        } finally {
          // cleanup
        }
      }
    `;
    const sf = createSourceFile("catch.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("tryCatchFinally");

    expect(fns[0]?.complexity).toBe(2);
  });

  it("evaluates try-finally without catch as CC = 1", () => {
    const code = `
      export function tryFinally() {
        try {
          return 42;
        } finally {
          // cleanup
        }
      }
    `;
    const sf = createSourceFile("try_finally.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("tryFinally");

    expect(fns[0]?.complexity).toBe(1);
  });

  it("resolves assigned names for arrow functions and function expressions in various contexts", () => {
    const code = `
      const arrowFn = () => 1;
      const exprFn = function() { return 2; };
      const myObj = {
        methodProp: () => 3,
      };
      let reassigned;
      reassigned = function() { return 4; };
    `;
    const sf = createSourceFile("names.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(4);

    const names = fns.map((f) => f.name);

    expect(names[0]).toBe("arrowFn");

    expect(names[1]).toBe("exprFn");

    expect(names[2]).toBe("methodProp");

    expect(names[3]).toBe("reassigned");
  });

  it("resolves anonymous functions when not assigned", () => {
    const code = `
      export default function() {
        return "default export";
      }
    `;
    const sf = createSourceFile("anon_default.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.name).toBe("(anonymous function)");
  });

  it("resolves methods in named and unnamed class expressions", () => {
    const code = `
      const NamedExpr = class MyService {
        run() {}
      };
      const AnonExpr = class {
        execute() {}
      };
    `;
    const sf = createSourceFile("class_expr.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(2);

    const names = fns.map((f) => f.name);

    expect(names[0]).toBe("MyService.run");

    expect(names[1]).toBe("execute");
  });

  it("extracts exact startLine and endLine for function declarations", () => {
    const code = [
      "// line 1",
      "export function multiLine(a: number): number {",
      "  const b = a * 2;",
      "  return b + 1;",
      "}",
    ].join("\n");
    const sf = createSourceFile("multiline.ts", code);
    const fns = extractFunctions(sf);

    expect(fns.length).toBe(1);

    expect(fns[0]?.startLine).toBe(2);

    expect(fns[0]?.endLine).toBe(5);
  });
});

describe("CRAP Metric - LCOV Coverage Parsing & Mapping", () => {
  it("parses LCOV file into line hit records", () => {
    const lcov = `
TN:
SF:src/service.ts
DA:1,1
DA:2,1
DA:3,0
DA:4,5
end_of_record
SF:src/helper.ts
DA:10,0
DA:11,0
end_of_record
`;
    const map = parseLcov(lcov);

    expect(map.size).toBe(2);

    const serviceCov = map.get("src/service.ts");

    expect(serviceCov?.lines.size).toBe(4);

    expect(serviceCov?.lines.get(1)).toBe(true);

    expect(serviceCov?.lines.get(2)).toBe(true);

    expect(serviceCov?.lines.get(3)).toBe(false);

    expect(serviceCov?.lines.get(4)).toBe(true);

    const helperCov = map.get("src/helper.ts");

    expect(helperCov?.lines.get(10)).toBe(false);

    expect(helperCov?.lines.get(11)).toBe(false);
  });

  it("calculates percentage of covered lines in range", () => {
    const lcov = `
SF:src/calc.ts
DA:10,1
DA:11,1
DA:12,0
DA:13,1
end_of_record
`;
    const map = parseLcov(lcov);
    const fileCov = map.get("src/calc.ts");

    const cov = coverageForRange(fileCov, 10, 13);

    expect(cov).toBe(75.0);

    const emptyCov = coverageForRange(fileCov, 20, 25);

    expect(emptyCov).toBe(0.0);
  });

  it("handles single-line functions in coverageForRange", () => {
    const lcov = `
SF:src/single.ts
DA:5,1
DA:6,0
end_of_record
`;
    const map = parseLcov(lcov);
    const fileCov = map.get("src/single.ts");

    expect(coverageForRange(fileCov, 5, 5)).toBe(100.0);

    expect(coverageForRange(fileCov, 6, 6)).toBe(0.0);

    expect(coverageForRange(fileCov, 7, 7)).toBe(0.0);
  });

  it("handles out of bounds and inverted ranges in coverageForRange", () => {
    const lcov = `
SF:src/bounds.ts
DA:10,1
DA:11,1
end_of_record
`;
    const map = parseLcov(lcov);
    const fileCov = map.get("src/bounds.ts");

    expect(coverageForRange(fileCov, 15, 10)).toBe(0.0);

    expect(coverageForRange(fileCov, 1, 5)).toBe(0.0);

    expect(coverageForRange(fileCov, 20, 30)).toBe(0.0);

    expect(coverageForRange(fileCov, -10, -1)).toBe(0.0);

    expect(coverageForRange(undefined, 10, 11)).toBe(0.0);
  });

  it("distinguishes lines with zero hits from untracked lines in coverageForRange", () => {
    const lcov = `
SF:src/sparse.ts
DA:10,1
DA:12,0
end_of_record
`;
    const map = parseLcov(lcov);
    const fileCov = map.get("src/sparse.ts");

    expect(coverageForRange(fileCov, 10, 12)).toBe(50.0);

    expect(coverageForRange(fileCov, 11, 11)).toBe(0.0);

    expect(coverageForRange(fileCov, 12, 12)).toBe(0.0);
  });

  it("parses DA lines with zero hits, positive hits, extra parts, and ignores invalid lines", () => {
    const lcov = [
      "SF:src/mixed.ts",
      "DA:1,0",
      "DA:2,1",
      "DA:3,42",
      "DA:4,0,checksum",
      "DA:invalid,1",
      "DA:5,invalid",
      "DA:notenoughparts",
      END_OF_RECORD,
    ].join("\n");
    const map = parseLcov(lcov);
    const fileCov = map.get("src/mixed.ts");

    expect(fileCov?.lines.size).toBe(4);

    expect(fileCov?.lines.get(1)).toBe(false);

    expect(fileCov?.lines.get(2)).toBe(true);

    expect(fileCov?.lines.get(3)).toBe(true);

    expect(fileCov?.lines.get(4)).toBe(false);

    expect(fileCov?.lines.has(5)).toBe(false);
  });

  it("stores file coverage even when end_of_record is omitted at end of file", () => {
    const lcov = "SF:src/unclosed.ts\nDA:1,1\nDA:2,0";
    const map = parseLcov(lcov);

    expect(map.has("src/unclosed.ts")).toBe(true);

    const fileCov = map.get("src/unclosed.ts");

    expect(fileCov?.lines.size).toBe(2);

    expect(fileCov?.lines.get(1)).toBe(true);

    expect(fileCov?.lines.get(2)).toBe(false);
  });

  it("computes exact coverage percentage rounding for fractional divisions", () => {
    const lcov = [
      "SF:src/fractional.ts",
      "DA:1,1",
      "DA:2,0",
      "DA:3,0",
      "DA:4,1",
      "DA:5,1",
      "DA:6,0",
      END_OF_RECORD,
    ].join("\n");
    const map = parseLcov(lcov);
    const fileCov = map.get("src/fractional.ts");

    expect(coverageForRange(fileCov, 1, 3)).toBe(33.3);

    expect(coverageForRange(fileCov, 3, 5)).toBe(66.7);

    expect(coverageForRange(fileCov, 2, 3)).toBe(0.0);

    expect(coverageForRange(fileCov, 4, 5)).toBe(100.0);
  });
});

describe("CRAP Metric - End to End Analysis", () => {
  it("emits high-crap-risk finding when CRAP score exceeds threshold 30", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crap-test-"));
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    const complexCode = `
      export function complexProcess(a: number, b: number, c: number, d: number) {
        if (a > 0) {
          if (b > 0) {
            if (c > 0) {
              if (d > 0) {
                return a + b + c + d;
              }
            }
          }
        } else if (a < -10) {
          while (b > 0) {
            b--;
          }
        }
        return 0;
      }
    `;
    const filePath = path.join(srcDir, "complex.ts");
    fs.writeFileSync(filePath, complexCode);

    const lcov = `
SF:${filePath}
DA:3,0
DA:4,0
DA:5,0
DA:6,0
DA:7,0
DA:11,0
DA:12,0
DA:13,0
DA:16,0
end_of_record
`;

    const { findings, entries } = await evaluateCrapFixture(tempDir, filePath, lcov, 30);

    expect(entries.length).toBe(1);

    const entry = entries[0];

    expect(entry?.functionName).toBe("complexProcess");

    expect(entry?.file).toBe("src/complex.ts");

    expect(entry?.line).toBe(2);

    expect(entry?.complexity).toBe(7);

    expect(entry?.coverage).toBe(0.0);

    expect(entry?.crap).toBe(56.0);

    expect(findings.length).toBe(1);

    const finding = findings[0];

    expect(finding?.check).toBe(CHECK_NAME);

    expect(finding?.rule).toBe(RULE_NAME);

    expect(finding?.severity).toBe("error");

    expect(finding?.file).toBe("src/complex.ts");

    expect(finding?.line).toBe(2);

    expect(finding?.column).toBe(1);

    expect(finding?.why).toBe(
      "CRAP (Change Risk Anti-Pattern) indicates code that is both complex and insufficiently tested, making modifications highly risky."
    );

    expect(finding?.suggestion).toBe(
      "Add unit tests to cover missing execution paths or refactor to reduce cyclomatic complexity."
    );

    expect(finding?.message).toBe(
      "CRAP score 56.0 exceeds threshold 30 in 'complexProcess' (CC: 7, Coverage: 0.0%)"
    );
  });

  it("passes without findings when functions are simple or well covered", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crap-pass-"));
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    const code = `
      export function simpleAdd(a: number, b: number) {
        return a + b;
      }
    `;
    const filePath = path.join(srcDir, "add.ts");
    fs.writeFileSync(filePath, code);

    const lcov = `
SF:${filePath}
DA:3,1
end_of_record
`;

    const entry = await assertSingleCleanCrapEntry(tempDir, filePath, lcov, 30);

    expect(entry?.crap).toBe(1.0);
  });

const SAMPLE_FILES_FOR_CRAP_FILTER = [
  "src/service.ts",
  "src/components/Button.tsx",
  "src/utils.js",
  "src/views/App.jsx",
  "src/server.mjs",
  "src/client.cjs",
  "src/types.d.ts",
  "src/types/index.d.ts",
  "src/service.test.ts",
  "src/service.spec.js",
  "src/components/Button.test.tsx",
  "src/views/App.spec.jsx",
  "src/components/Button.stories.tsx",
  "src/views/App.story.jsx",
  "src/__tests__/integration.ts",
  "src/__mocks__/storage.js",
  "src/__fixtures__/data.ts",
  "src/__snapshots__/dom.ts",
  ".storybook/main.ts",
  "jest.config.js",
  "vite.config.ts",
  "setup.ts",
  "setup.js",
  "styles/main.css",
  "data/config.json",
  "README.md",
  "scripts/deploy.py",
];

  it("filters production files for crap analysis with various extensions and patterns", () => {
    const filtered = filterProductionFilesForCrap("/test", SAMPLE_FILES_FOR_CRAP_FILTER);

    expect(filtered).toEqual([
      "src/service.ts",
      "src/components/Button.tsx",
      "src/utils.js",
      "src/views/App.jsx",
      "src/server.mjs",
      "src/client.cjs",
    ]);

    expect(filtered).not.toContain("src/types.d.ts");
    expect(filtered).not.toContain("src/types/index.d.ts");
    expect(filtered).not.toContain("src/service.test.ts");
    expect(filtered).not.toContain("src/service.spec.js");
    expect(filtered).not.toContain("src/components/Button.test.tsx");
    expect(filtered).not.toContain("src/views/App.spec.jsx");
    expect(filtered).not.toContain("src/components/Button.stories.tsx");
    expect(filtered).not.toContain("src/views/App.story.jsx");
    expect(filtered).not.toContain("src/__tests__/integration.ts");
    expect(filtered).not.toContain("src/__mocks__/storage.js");
    expect(filtered).not.toContain(".storybook/main.ts");
    expect(filtered).not.toContain("jest.config.js");
    expect(filtered).not.toContain("vite.config.ts");
    expect(filtered).not.toContain("setup.ts");
    expect(filtered).not.toContain("setup.js");
    expect(filtered).not.toContain("styles/main.css");
    expect(filtered).not.toContain("data/config.json");
    expect(filtered).not.toContain("README.md");
    expect(filtered).not.toContain("scripts/deploy.py");
  });

  it("returns default glob patterns when files are empty or not provided", () => {
    expect(filterProductionFilesForCrap("/test")).toEqual([
      "src/**/*.{ts,js,tsx,jsx}",
      "!src/**/*.d.ts",
    ]);
    expect(filterProductionFilesForCrap("/test", [])).toEqual([
      "src/**/*.{ts,js,tsx,jsx}",
      "!src/**/*.d.ts",
    ]);
  });

  it("formats CRAP report table matching Uncle Bob style", () => {
    const entries = [
      {
        functionName: "complexFn",
        file: "src/billing.ts",
        line: 10,
        complexity: 12,
        coverage: 45.0,
        crap: 36.0,
      },
      {
        functionName: "simpleFn",
        file: "src/billing.ts",
        line: 50,
        complexity: 1,
        coverage: 100.0,
        crap: 1.0,
      },
    ];

    const report = formatCrapReport(entries);

    expect(report).toContain("CRAP Report");

    expect(report).toContain("Function");

    expect(report).toContain("File");

    expect(report).toContain("CC");

    expect(report).toContain("Cov%");

    expect(report).toContain("CRAP");
    expect(report).toContain("complexFn");
    expect(report).toContain("simpleFn");
    // High CRAP should appear before low CRAP
    const complexIdx = report.indexOf("complexFn");
    const simpleIdx = report.indexOf("simpleFn");
    expect(complexIdx).toBeLessThan(simpleIdx);
  });

  it("formats CRAP report with exact boundary colors for 30 and 5 thresholds", () => {
    const boundaryEntries = [
      {
        functionName: "boundaryThirty",
        file: "src/boundary.ts",
        line: 1,
        complexity: 10,
        coverage: 50.0,
        crap: 30.0, // Exactly 30.0 must be YELLOW, not RED
      },
      {
        functionName: "boundaryFive",
        file: "src/boundary.ts",
        line: 10,
        complexity: 5,
        coverage: 100.0,
        crap: 5.0, // Exactly 5.0 must be GREEN, not YELLOW
      },
    ];

    const report = formatCrapReport(boundaryEntries, { useColor: true });
    // 30.0 should be yellow (\x1b[33m), not red (\x1b[31m)
    expect(report).toContain("\x1b[33m    30.0\x1b[0m");
    // 5.0 should be green (\x1b[32m), not yellow (\x1b[33m)
    expect(report).toContain("\x1b[32m     5.0\x1b[0m");
  });
  it("formats CRAP report with colored output across all risk tiers", () => {
    const entries = [
      {
        functionName: "highRiskFn",
        file: "src/high.ts",
        line: 1,
        complexity: 10,
        coverage: 0.0,
        crap: 110.0,
      },
      {
        functionName: "mediumRiskFn",
        file: "src/med.ts",
        line: 10,
        complexity: 3,
        coverage: 50.0,
        crap: 7.0,
      },
      {
        functionName: "lowRiskFn",
        file: "src/low.ts",
        line: 20,
        complexity: 1,
        coverage: 100.0,
        crap: 1.0,
      },
    ];

    const report = formatCrapReport(entries, { useColor: true });

    expect(report).toContain("\x1b[31m\x1b[1m");

    expect(report).toContain("\x1b[33m");

    expect(report).toContain("\x1b[32m");

    expect(report).toContain("\x1b[0m");
  });

  it("returns placeholder text when formatting empty CRAP entries", () => {
    const report = formatCrapReport([]);

    expect(report).toBe("CRAP Report\n===========\nNo analyzed functions found.\n");
  });

  it("truncates long function names and long file paths in report table", () => {
    const longName = "aVeryLongFunctionNameThatExceedsTheThirtyCharacterColumnWidthLimit";
    const longFile = "src/nested/deeply/within/directories/to/exceed/the/forty/character/limit/service.ts";
    const entries = [
      {
        functionName: longName,
        file: longFile,
        line: 1,
        complexity: 1,
        coverage: 100.0,
        crap: 1.0,
      },
    ];

    const report = formatCrapReport(entries);

    expect(report).toContain(`${longName.slice(0, 29)}…`);

    expect(report).toContain(`…${longFile.slice(-39)}`);
  });

  it("returns empty findings and entries when targetFiles contains only non-production files", async () => {
    const res = await checkCrap("/any/dir", ["src/my-service.test.ts"]);

    expect(res.findings.length).toBe(0);

    expect(res.entries.length).toBe(0);
  });

  it("emits crap-coverage-missing warning finding with exact line and column when no LCOV is provided", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crap-nolcov-"));
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    const code = "export function doNothing() { return 1; }";
    const filePath = path.join(srcDir, "noop.ts");
    fs.writeFileSync(filePath, code);

    const { findings, entries } = await checkCrap(tempDir, [filePath]);

    fs.rmSync(tempDir, { recursive: true });

    expect(findings.length).toBe(1);

    const warn = findings[0];

    expect(warn?.check).toBe(CHECK_NAME);

    expect(warn?.rule).toBe("crap-coverage-missing");

    expect(warn?.severity).toBe("warning");

    expect(warn?.file).toBe(path.join(tempDir, "package.json"));

    expect(warn?.line).toBe(1);

    expect(warn?.column).toBe(1);

    expect(warn?.message).toBe("No test coverage report found; assuming 0% coverage for CRAP scoring.");

    expect(warn?.why).toBe(
      "CRAP calculation requires test coverage. Without coverage data, all functions are treated as uncovered (cov=0%)."
    );

    expect(warn?.suggestion).toBe(
      "Configure tests with coverage (e.g. 'bun test --coverage' or Vitest/Jest coverage) to produce coverage/lcov.info."
    );

    expect(entries.length).toBe(1);

    expect(entries[0]?.coverage).toBe(0.0);

    expect(entries[0]?.crap).toBe(2.0);
  });

  it("skips non-existent files gracefully in checkCrap", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crap-missing-"));
    const nonExistent = path.join(tempDir, "src", "ghost.ts");

    const { findings, entries } = await checkCrap(tempDir, [nonExistent], 30, `SF:dummy\n${END_OF_RECORD}`);

    fs.rmSync(tempDir, { recursive: true });

    expect(findings.length).toBe(0);

    expect(entries.length).toBe(0);
  });

  it("matches relative file path from LCOV against target file in checkCrap", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crap-rel-"));
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    const code = "export function relFn(x: number) { return x * 2; }";
    const filePath = path.join(srcDir, "rel.ts");
    fs.writeFileSync(filePath, code);

    const lcov = [
      "SF:src/rel.ts",
      "DA:1,1",
      END_OF_RECORD,
    ].join("\n");

    const entry = await assertSingleCleanCrapEntry(tempDir, filePath, lcov, 30);

    expect(entry?.coverage).toBe(100.0);
    expect(entry?.crap).toBe(1.0);
  });

  it("respects threshold boundary when CRAP score equals threshold exactly", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crap-boundary-"));
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    const code = `
      export function boundaryFn(a: number) {
        if (a > 1) return 1;
        if (a > 2) return 2;
        if (a > 3) return 3;
        if (a > 4) return 4;
        return 0;
      }
    `;
    const filePath = path.join(srcDir, "boundary.ts");
    fs.writeFileSync(filePath, code);

    const lcov = [
      `SF:${filePath}`,
      "DA:3,0",
      END_OF_RECORD,
    ].join("\n");

    const atThreshold = await checkCrap(tempDir, [filePath], 30, lcov);

    expect(atThreshold.findings.length).toBe(0);

    expect(atThreshold.entries.length).toBe(1);

    expect(atThreshold.entries[0]?.crap).toBe(30.0);

    const belowThreshold = await checkCrap(tempDir, [filePath], 29.9, lcov);

    expect(belowThreshold.findings.length).toBe(1);

    fs.rmSync(tempDir, { recursive: true });
  });

  it("tests parseLcovDaLine parsing and error tolerance", () => {
    const map = new Map<number, boolean>();
    parseLcovDaLine("DA:10,2", map);
    expect(map.get(10)).toBe(true);

    parseLcovDaLine("DA:11,0", map);
    expect(map.get(11)).toBe(false);

    parseLcovDaLine("DA:12,abc", map);
    expect(map.has(12)).toBe(false);

    parseLcovDaLine("DA:xyz,1", map);
    expect(map.size).toBe(2);

    parseLcovDaLine("DA:10", map);
    expect(map.size).toBe(2);
  });

  it("tests findFileCoverage resolution across absolute and relative paths", () => {
    const cwd = "/repo";
    const covMap = new Map([
      ["/repo/src/app.ts", { lines: new Map([[1, true]]) }],
      ["src/lib.ts", { lines: new Map([[5, false]]) }],
    ]);

    // 1. Exact absolute match
    const matchAbs = findFileCoverage(covMap, "/repo/src/app.ts", cwd);
    expect(matchAbs).toBeDefined();
    expect(matchAbs?.lines.get(1)).toBe(true);

    // 2. Relative match
    const matchRel = findFileCoverage(covMap, "src/lib.ts", cwd);
    expect(matchRel).toBeDefined();
    expect(matchRel?.lines.get(5)).toBe(false);

    // 3. No match
    const noMatch = findFileCoverage(covMap, "src/missing.ts", cwd);
    expect(noMatch).toBeUndefined();
  });

  it("tests formatCrapReport truncation of long function and file names", () => {
    const longFnName = "thisIsAVeryLongFunctionNameThatExceedsTheColumnWidth";
    const longFileName = "a/very/deep/and/long/path/to/some/nested/file/in/the/project/module.ts";
    const report = formatCrapReport([
      {
        functionName: longFnName,
        file: longFileName,
        line: 1,
        complexity: 10,
        coverage: 50.0,
        crap: 45.0,
      },
      {
        functionName: "shortFn",
        file: "src/short.ts",
        line: 1,
        complexity: 1,
        coverage: 100.0,
        crap: 1.0,
      },
    ]);

    expect(report).toContain("…");
    expect(report.indexOf("thisIsAVeryLongFunction")).toBeLessThan(report.indexOf("shortFn"));
  });
});
