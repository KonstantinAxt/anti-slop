import { describe, expect, it } from "bun:test";
import type { Finding } from "../src/types.js";
import { checkScars } from "../src/checks/scars.js";

const CHECK_NAME = "scars";
const NO_SERVICE_ROUNDING_RULE = "no-service-rounding";
const NO_EMPTY_CATCH_RULE = "no-empty-catch";
const NO_UNVALIDATED_API_CAST_RULE = "no-unvalidated-api-cast";
const NO_TRIVIAL_OBJECT_WRAPPER_RULE = "no-trivial-object-wrapper";
const NO_ASYNC_ARRAY_CALLBACK_RULE = "no-async-array-callback";
const NO_PASS_THROUGH_CLASS_RULE = "no-pass-through-class";
const NO_SINGLE_IMPL_INTERFACE_RULE = "no-single-impl-interface";

const SEVERITY_ERROR = "error";
const SEVERITY_WARNING = "warning";
const SYNC_FILE = "src/sync.ts";

const WHY_SERVICE_ROUNDING =
  "Precision invariant: Services compute, formatters round. Rounding twice moves values off true precision. Keep unrounded raw precision in business layers and format only at UI boundary.";
const SUGGESTION_SERVICE_ROUNDING =
  "Return the unrounded numeric value and perform rounding only in the presentation/formatting layer.";

const WHY_TRIVIAL_WRAPPER =
  "Unnecessary indirection: Extracting functions that solely forward parameters into an object without computation or branching adds cognitive overhead and circumvents linter intent.";
const SUGGESTION_TRIVIAL_WRAPPER =
  "Pass the object directly or use useMemo at the consumer call site instead of creating a passthrough wrapper.";

const WHY_FOREACH_ASYNC =
  "Array.prototype.forEach ignores returned promises, running async callbacks concurrently in the background without awaiting completion or catching rejected promises.";
const SUGGESTION_FOREACH_ASYNC =
  "Use 'for (const item of items) { await ... }' for sequential execution or 'await Promise.all(items.map(...))' for concurrent execution.";

const WHY_FILTER_ASYNC =
  "Async functions return a Promise object, which is truthy in JavaScript regardless of whether the resolved boolean is true or false.";
const SUGGESTION_FILTER_ASYNC =
  "Map to resolved boolean values with Promise.all and filter based on resolved indices, or use a sequential for-loop.";

const WHY_GENERIC_ASYNC =
  "Passing an async function to Array methods produces unresolved Promise objects instead of values, causing silent data flow corruption.";
const SUGGESTION_GENERIC_ASYNC =
  "Wrap the mapped expression in 'await Promise.all(...)', or iterate explicitly with 'for...of'.";

const WHY_PASS_THROUGH =
  "Over-engineering / Middle Man smell: Introducing wrapper classes that solely forward calls to an underlying service or client without adding business logic, validation, or transformation creates unnecessary indirection.";
const SUGGESTION_PASS_THROUGH =
  "Use the underlying dependency directly or merge this logic into the calling code.";

const WHY_SINGLE_IMPL =
  "Speculative generality: Declaring non-exported interfaces implemented by only a single local class adds boilerplate abstraction before a second implementation exists (YAGNI).";
const SUGGESTION_SINGLE_IMPL =
  "Remove the interface and use the class directly, or inline the contract.";

const WHY_EMPTY_CATCH =
  "Silent error suppression is a common AI pattern that masks fatal operational failures.";
const SUGGESTION_EMPTY_CATCH =
  "Log the error, rethrow, or handle the specific failure explicitly.";

function checkSingleAsyncArrayFinding(
  filePath: string,
  code: string
): Finding | undefined {
  const findings = checkScars(filePath, code);
  const asyncArrayFindings = findings.filter(
    (f) => f.rule === NO_ASYNC_ARRAY_CALLBACK_RULE
  );

  expect(asyncArrayFindings.length).toBe(1);

  return asyncArrayFindings[0];
}

const WHY_API_CAST =
  "Contract integrity: Unvalidated type assertions allow nonexistent API fields to compile. Use contract-generated clients or runtime schema validation (e.g. Zod).";
const SUGGESTION_API_CAST =
  "Parse API responses with a Zod schema or use OpenAPI generated client contracts (@hey-api/openapi-ts) instead of unsafe compile-time assertions.";


describe("Codebase Scars Checker (Move #5 & #1)", () => {
  it("flags Math.round or toFixed in a service or computation file with exact finding structure", () => {
    const serviceCode = "export class PayrollService {\n  calculate(h: number) {\n    return Math.round(h);\n  }\n  format(r: number) {\n    return r.toFixed(2);\n  }\n}";

    const findings = checkScars("src/services/payroll.service.ts", serviceCode);

    expect(findings.length).toBe(2);

    expect(findings[0]).toEqual({
      check: CHECK_NAME,
      rule: NO_SERVICE_ROUNDING_RULE,
      severity: SEVERITY_ERROR,
      message: "Math.round() called inside service/computation file.",
      file: "src/services/payroll.service.ts",
      line: 3,
      column: 12,
      excerpt: "Math.round(h)",
      why: WHY_SERVICE_ROUNDING,
      suggestion: SUGGESTION_SERVICE_ROUNDING,
    });

    expect(findings[1]).toEqual({
      check: CHECK_NAME,
      rule: NO_SERVICE_ROUNDING_RULE,
      severity: SEVERITY_ERROR,
      message: "toFixed() called inside service/computation file.",
      file: "src/services/payroll.service.ts",
      line: 6,
      column: 12,
      excerpt: "r.toFixed(2)",
      why: WHY_SERVICE_ROUNDING,
      suggestion: SUGGESTION_SERVICE_ROUNDING,
    });
  });

  it("flags Math.round in root service, store, model, calculator and computation directories", () => {
    const code = "export function compute(x: number) { return Math.round(x); }";

    expect(checkScars("services/calc.ts", code).length).toBe(1);

    expect(checkScars("stores/user.ts", code).length).toBe(1);

    expect(checkScars("models/order.ts", code).length).toBe(1);

    expect(checkScars("calculators/tax.ts", code).length).toBe(1);

    expect(checkScars("computations/metrics.ts", code).length).toBe(1);

    expect(checkScars("payroll.service.ts", code).length).toBe(1);

    expect(checkScars("state.store.js", code).length).toBe(1);

    expect(checkScars("tax.calc.tsx", code).length).toBe(1);
  });

  it("permits Math.round in non-service paths and other Math functions in services", () => {
    const nonServiceCode = "export function formatDisplayHours(hours: number) { return Math.round(hours * 10) / 10; }";

    const nonServiceFindings = checkScars("src/utils/formatters.ts", nonServiceCode);

    expect(nonServiceFindings.filter((f) => f.rule === NO_SERVICE_ROUNDING_RULE)).toEqual([]);

    const otherMethodsCode = "export function calc(x: number) { return Math.floor(x) + Math.ceil(x) + Math.abs(x); }";

    const otherFindings = checkScars("services/calc.ts", otherMethodsCode);

    expect(otherFindings.filter((f) => f.rule === NO_SERVICE_ROUNDING_RULE)).toEqual([]);

    const otherObjectCode = "export function calc(x: { round: (n: number) => number }) { return x.round(1); }";

    const objectFindings = checkScars("services/calc.ts", otherObjectCode);

    expect(objectFindings.filter((f) => f.rule === NO_SERVICE_ROUNDING_RULE)).toEqual([]);
  });

  it("flags empty catch blocks with exact finding attributes", () => {
    const code = "async function syncData() {\n  try {\n    await fetch('/api/sync');\n  } catch (e) {}\n}";

    const findings = checkScars(SYNC_FILE, code);
    const emptyCatchFindings = findings.filter((f) => f.rule === NO_EMPTY_CATCH_RULE);

    expect(emptyCatchFindings.length).toBe(1);

    expect(emptyCatchFindings[0]).toEqual({
      check: CHECK_NAME,
      rule: NO_EMPTY_CATCH_RULE,
      severity: SEVERITY_ERROR,
      message: "Empty catch block silently swallowing exceptions.",
      file: SYNC_FILE,
      line: 4,
      column: 5,
      excerpt: "catch (e) {}",
      why: WHY_EMPTY_CATCH,
      suggestion: SUGGESTION_EMPTY_CATCH,
    });
  });

  it("flags catch block containing only comments and permits non-empty catch blocks", () => {
    const commentOnlyCode = "try { doSomething(); } catch (e) {\n  // empty comment\n}";

    const commentFindings = checkScars(SYNC_FILE, commentOnlyCode).filter((f) => f.rule === NO_EMPTY_CATCH_RULE);

    expect(commentFindings.length).toBe(1);

    const rethrowCode = "try { doSomething(); } catch (e) { throw e; }";

    expect(checkScars(SYNC_FILE, rethrowCode).filter((f) => f.rule === NO_EMPTY_CATCH_RULE)).toEqual([]);

    const emptyReturnCode = "try { doSomething(); } catch (e) { return; }";

    expect(checkScars(SYNC_FILE, emptyReturnCode).filter((f) => f.rule === NO_EMPTY_CATCH_RULE)).toEqual([]);

    const valueReturnCode = "try { doSomething(); } catch (e) { return null; }";

    expect(checkScars(SYNC_FILE, valueReturnCode).filter((f) => f.rule === NO_EMPTY_CATCH_RULE)).toEqual([]);

    const logCode = "try { doSomething(); } catch (e) { console.error(e); }";

    expect(checkScars(SYNC_FILE, logCode).filter((f) => f.rule === NO_EMPTY_CATCH_RULE)).toEqual([]);
  });

  it("permits catch blocks when try contains nested branching or loops", () => {
    const nestedCode = `
      function runNested(items: number[]) {
        try {
          if (items.length > 0) {
            for (const item of items) {
              if (item < 0) {
                throw new Error("negative");
              }
            }
          }
        } catch (e) {
          handleError(e);
        }
      }
    `;

    const findings = checkScars("src/nested.ts", nestedCode).filter((f) => f.rule === NO_EMPTY_CATCH_RULE);

    expect(findings).toEqual([]);
  });

  it("flags raw unchecked JSON type assertion and OpenAPI casts with exact finding", () => {
    const code = "interface UserProfile { name: string; }\nasync function fetchUser(): Promise<UserProfile> {\n  const res = await fetch('/api/user');\n  return (await res.json()) as UserProfile;\n}";

    const findings = checkScars("src/api/user.ts", code);
    const castFindings = findings.filter((f) => f.rule === NO_UNVALIDATED_API_CAST_RULE);

    expect(castFindings.length).toBe(1);

    expect(castFindings[0]).toEqual({
      check: CHECK_NAME,
      rule: NO_UNVALIDATED_API_CAST_RULE,
      severity: SEVERITY_ERROR,
      message: "Unvalidated API response type assertion ('as Type').",
      file: "src/api/user.ts",
      line: 4,
      column: 10,
      excerpt: "(await res.json()) as UserProfile",
      why: WHY_API_CAST,
      suggestion: SUGGESTION_API_CAST,
    });
  });

  it("flags fetch and axios type assertions while permitting ordinary safe type casts", () => {
    const fetchCast = "const p = fetch('/api') as Promise<Response>;";

    expect(checkScars("src/client.ts", fetchCast).filter((f) => f.rule === NO_UNVALIDATED_API_CAST_RULE).length).toBe(1);

    const axiosCast = "const r = axios.get('/api') as ApiResponse;";

    expect(checkScars("src/client.ts", axiosCast).filter((f) => f.rule === NO_UNVALIDATED_API_CAST_RULE).length).toBe(1);

    const angleBracketCast = "const data = <UserProfile>(await res.json());";

    expect(checkScars("src/client.ts", angleBracketCast).filter((f) => f.rule === NO_UNVALIDATED_API_CAST_RULE).length).toBe(1);

    const safeCast = "const str = (123).toString() as string;\nconst num = <number>42;\nconst parsed = JSON.parse(str) as { id: number };";

    expect(checkScars("src/safe.ts", safeCast).filter((f) => f.rule === NO_UNVALIDATED_API_CAST_RULE)).toEqual([]);
  });

  it("flags trivial object-packing wrapper functions with exact finding attributes", () => {
    const code = "const createCard = (cardLink: string, listing: number) => ({ cardLink, listing });";

    const findings = checkScars("src/components/item.tsx", code);
    const wrapperFindings = findings.filter((f) => f.rule === NO_TRIVIAL_OBJECT_WRAPPER_RULE);

    expect(wrapperFindings.length).toBe(1);

    expect(wrapperFindings[0]).toEqual({
      check: CHECK_NAME,
      rule: NO_TRIVIAL_OBJECT_WRAPPER_RULE,
      severity: SEVERITY_WARNING,
      message: "Trivial wrapper function 'createCard' merely packs parameters into an object literal without logic.",
      file: "src/components/item.tsx",
      line: 1,
      column: 7,
      excerpt: "createCard = (cardLink: string, listing: number) => ({ cardLink, listing })",
      why: WHY_TRIVIAL_WRAPPER,
      suggestion: SUGGESTION_TRIVIAL_WRAPPER,
    });
  });

  it("flags function declarations, function expressions, and property assignments", () => {
    const fnDecl = "function pack(a: string, b: number) {\n  return { a, b };\n}";

    const declFindings = checkScars("src/decl.ts", fnDecl).filter((f) => f.rule === NO_TRIVIAL_OBJECT_WRAPPER_RULE);

    expect(declFindings.length).toBe(1);

    expect(declFindings[0]?.message).toContain("'pack'");

    const fnExpr = "const make = function(x: number, y: number) { return { x, y }; };";

    const exprFindings = checkScars("src/expr.ts", fnExpr).filter((f) => f.rule === NO_TRIVIAL_OBJECT_WRAPPER_RULE);

    expect(exprFindings.length).toBe(1);

    expect(exprFindings[0]?.message).toContain("'make'");

    const propAssign = "const packProps = (foo: string, bar: number) => ({ first: foo, second: bar });";

    const propFindings = checkScars("src/prop.ts", propAssign).filter((f) => f.rule === NO_TRIVIAL_OBJECT_WRAPPER_RULE);

    expect(propFindings.length).toBe(1);

  });

  it("permits functions that perform computation, transformation, or non-trivial object construction", () => {
    const computationCode = `
      const createSlotStyle = (start: number, size: number) => ({
        left: 0,
        transform: \`translateX(\${start}px)\`,
        width: \`\${size}px\`,
      });

      const createMixed = (a: string) => ({
        a,
        count: 1,
      });

      const createSpread = (a: Record<string, unknown>) => ({
        ...a,
      });

      const createMethod = (a: string) => ({
        a,
        action() { return a; },
      });

      function createEmpty() {
        return {};
      }

      function multiStatement(a: string) {
        console.log(a);
        return { a };
      }

      function destructParam({ a }: { a: string }) {
        return { a };
      }

      function returnNonObject(a: string) {
        return a;
      }

      function emptyReturn(a: string) {
        return;
      }
    `;

    const findings = checkScars("src/components/item.tsx", computationCode);
    const wrapperFindings = findings.filter((f) => f.rule === NO_TRIVIAL_OBJECT_WRAPPER_RULE);

    expect(wrapperFindings).toEqual([]);
  });

  it("flags forEach with async callback with exact error finding", () => {
    const code = "async function processAll(items: number[]) {\n  items.forEach(async (item) => {\n    await doWork(item);\n  });\n}";

    const finding = checkSingleAsyncArrayFinding("src/processor.ts", code);

    expect(finding).toEqual({
      check: CHECK_NAME,
      rule: NO_ASYNC_ARRAY_CALLBACK_RULE,
      severity: SEVERITY_ERROR,
      message: "Array.prototype.forEach with an async callback is not awaited and drops errors.",
      file: "src/processor.ts",
      line: 2,
      column: 3,
      excerpt: "items.forEach(async (item) => {\n    await doWork(item);\n  })",
      why: WHY_FOREACH_ASYNC,
      suggestion: SUGGESTION_FOREACH_ASYNC,
    });
  });

  it("flags filter with async callback with exact error finding", () => {
    const code = "async function filterActive(items: number[]) {\n  return items.filter(async (item) => {\n    return await isItemActive(item);\n  });\n}";

    const finding = checkSingleAsyncArrayFinding("src/filter.ts", code);

    expect(finding).toEqual({
      check: CHECK_NAME,
      rule: NO_ASYNC_ARRAY_CALLBACK_RULE,
      severity: SEVERITY_ERROR,
      message: "Array.prototype.filter with an async callback always evaluates to true.",
      file: "src/filter.ts",
      line: 2,
      column: 10,
      excerpt: "items.filter(async (item) => {\n    return await isItemActive(item);\n  })",
      why: WHY_FILTER_ASYNC,
      suggestion: SUGGESTION_FILTER_ASYNC,
    });
  });

  it("flags map, reduce, and reduceRight with async callback with exact error finding", () => {
    const mapCode = "function getPromises(items: number[]) {\n  return items.map(async (item) => {\n    return await fetchItem(item);\n  });\n}";

    const mapFindings = checkScars("src/mapper.ts", mapCode).filter((f) => f.rule === NO_ASYNC_ARRAY_CALLBACK_RULE);

    expect(mapFindings.length).toBe(1);

    expect(mapFindings[0]).toEqual({
      check: CHECK_NAME,
      rule: NO_ASYNC_ARRAY_CALLBACK_RULE,
      severity: SEVERITY_ERROR,
      message: "Array.prototype.map with an unhandled async callback returns an array of Promises without awaiting.",
      file: "src/mapper.ts",
      line: 2,
      column: 10,
      excerpt: "items.map(async (item) => {\n    return await fetchItem(item);\n  })",
      why: WHY_GENERIC_ASYNC,
      suggestion: SUGGESTION_GENERIC_ASYNC,
    });

    const reduceCode = "const total = items.reduce(async (acc, x) => (await acc) + x, Promise.resolve(0));";

    const reduceFindings = checkScars("src/reduce.ts", reduceCode).filter((f) => f.rule === NO_ASYNC_ARRAY_CALLBACK_RULE);

    expect(reduceFindings.length).toBe(1);

    expect(reduceFindings[0]?.message).toContain("reduce");

    const reduceRightCode = "const totalR = items.reduceRight(async (acc, x) => (await acc) + x, Promise.resolve(0));";

    const reduceRightFindings = checkScars("src/reduceRight.ts", reduceRightCode).filter((f) => f.rule === NO_ASYNC_ARRAY_CALLBACK_RULE);

    expect(reduceRightFindings.length).toBe(1);

    expect(reduceRightFindings[0]?.message).toContain("reduceRight");

    const fnExprCode = "items.forEach(async function(item) { await doWork(item); });";

    expect(checkScars("src/fn.ts", fnExprCode).filter((f) => f.rule === NO_ASYNC_ARRAY_CALLBACK_RULE).length).toBe(1);
  });

  it("truncates long excerpts at 80 characters limit", () => {
    const longCode = "items.forEach(async (item) => { const veryLongVariableNameToEnsureLengthExceedsEightyCharacters = 123; return item; });";

    const findings = checkScars("src/long.ts", longCode).filter((f) => f.rule === NO_ASYNC_ARRAY_CALLBACK_RULE);

    expect(findings.length).toBe(1);

    expect(findings[0]?.excerpt?.length).toBe(80);
  });

  it("permits array.map with async callback when wrapped in Promise combinators (all, allSettled, race, any)", () => {
    const code = `
      async function fetchAll(items: number[]) {
        const all = await Promise.all(items.map(async (item) => {
          return await fetchItem(item);
        }));
        const settled = await Promise.allSettled(items.map(async (item) => {
          return await fetchItem(item);
        }));
        const raced = await Promise.race(items.map(async (item) => {
          return await fetchItem(item);
        }));
        const anyRes = await Promise.any(items.map(async (item) => {
          return await fetchItem(item);
        }));
        return { all, settled, raced, anyRes };
      }
    `;

    const findings = checkScars("src/fetcher.ts", code);
    const asyncArrayFindings = findings.filter((f) => f.rule === NO_ASYNC_ARRAY_CALLBACK_RULE);

    expect(asyncArrayFindings).toEqual([]);
  });

  it("permits synchronous array callbacks and non-monitored array methods", () => {
    const syncCode = `
      items.forEach((item) => { console.log(item); });
      items.filter((item) => item > 0);
      items.map((item) => item * 2);
      items.some(async (item) => item > 0);
      items.find(async (item) => item > 0);
      items.map(fetchItem);
    `;

    const findings = checkScars("src/syncArray.ts", syncCode).filter((f) => f.rule === NO_ASYNC_ARRAY_CALLBACK_RULE);

    expect(findings).toEqual([]);
  });

  it("flags middleman pass-through classes with exact warning finding", () => {
    const code = "export class UserServiceProxy {\n  constructor(private userService: UserService) {}\n  getUser(id: string) {\n    return this.userService.getUser(id);\n  }\n  deleteUser(id: string) {\n    return this.userService.deleteUser(id);\n  }\n}";

    const findings = checkScars("src/proxy.ts", code);
    const passThroughFindings = findings.filter((f) => f.rule === NO_PASS_THROUGH_CLASS_RULE);

    expect(passThroughFindings.length).toBe(1);

    expect(passThroughFindings[0]).toEqual({
      check: CHECK_NAME,
      rule: NO_PASS_THROUGH_CLASS_RULE,
      severity: SEVERITY_WARNING,
      message: "Class 'UserServiceProxy' is a pass-through middleman that merely delegates all methods to an injected dependency.",
      file: "src/proxy.ts",
      line: 1,
      column: 1,
      excerpt: "export class UserServiceProxy {\n  constructor(private userService: UserService) ",
      why: WHY_PASS_THROUGH,
      suggestion: SUGGESTION_PASS_THROUGH,
    });
  });

  it("flags pass-through classes with protected, public, readonly, property declarations, and expression statements", () => {
    const protectedCode = `
      class ProtectedProxy {
        constructor(protected client: ApiClient) {}
        fetch(url: string) { return this.client.fetch(url); }
      }
    `;

    expect(checkScars("src/prot.ts", protectedCode).filter((f) => f.rule === NO_PASS_THROUGH_CLASS_RULE).length).toBe(1);

    const publicCode = `
      class PublicProxy {
        constructor(public client: ApiClient) {}
        fetch(url: string) { return this.client.fetch(url); }
      }
    `;

    expect(checkScars("src/pub.ts", publicCode).filter((f) => f.rule === NO_PASS_THROUGH_CLASS_RULE).length).toBe(1);

    const readonlyCode = `
      class ReadonlyProxy {
        constructor(readonly client: ApiClient) {}
        fetch(url: string) { return this.client.fetch(url); }
      }
    `;

    expect(checkScars("src/ro.ts", readonlyCode).filter((f) => f.rule === NO_PASS_THROUGH_CLASS_RULE).length).toBe(1);

    const propDeclCode = `
      class PropProxy {
        client: ApiClient;
        fetch(url: string) { return this.client.fetch(url); }
      }
    `;

    expect(checkScars("src/prop.ts", propDeclCode).filter((f) => f.rule === NO_PASS_THROUGH_CLASS_RULE).length).toBe(1);

    const exprStmtCode = `
      class StmtProxy {
        constructor(private client: ApiClient) {}
        log(msg: string) { this.client.log(msg); }
      }
    `;

    expect(checkScars("src/stmt.ts", exprStmtCode).filter((f) => f.rule === NO_PASS_THROUGH_CLASS_RULE).length).toBe(1);

    const anonClassCode = `
      export default class {
        constructor(private client: ApiClient) {}
        fetch(url: string) { return this.client.fetch(url); }
      }
    `;

    const anonFindings = checkScars("src/anonClass.ts", anonClassCode).filter((f) => f.rule === NO_PASS_THROUGH_CLASS_RULE);

    expect(anonFindings.length).toBe(1);

    expect(anonFindings[0]?.message).toContain("'AnonymousClass'");
  });

  it("permits classes that contain actual business logic, calculations, or non-pass-through structures", () => {
    const businessLogicCode = `
      export class OrderServiceProxy {
        constructor(private orderService: OrderService) {}

        processOrder(order: unknown) {
          const validated = validateOrder(order);
          return this.orderService.process(validated);
        }
      }

      class MixedClass {
        constructor(private client: ApiClient) {}
        fetch(url: string) { return this.client.fetch(url); }
        compute(x: number) { return x * 2; }
      }

      class NoDepsClass {
        compute(x: number) { return x * 2; }
      }

      class EmptyClass {
        constructor(private client: ApiClient) {}
      }

      class ExternalCallClass {
        constructor(private client: ApiClient) {}
        fetch(url: string) { return otherFunction(url); }
      }

      class PropertyAccessClass {
        constructor(private client: ApiClient) {}
        fetch() { return this.client.status; }
      }

      class NoModifierParamClass {
        constructor(client: ApiClient) {}
        fetch(url: string) { return 123; }
      }
    `;

    const findings = checkScars("src/order.ts", businessLogicCode);
    const passThroughFindings = findings.filter((f) => f.rule === NO_PASS_THROUGH_CLASS_RULE);

    expect(passThroughFindings).toEqual([]);
  });

  it("flags speculative unexported interfaces with only one local implementing class with exact finding", () => {
    const code = "interface IRepository {\n  find(id: string): unknown;\n}\n\nexport class SqlRepository implements IRepository {\n  find(id: string) {\n    return { id };\n  }\n}";

    const singleImplFindings = checkScars("src/repo.ts", code).filter((f) => f.rule === NO_SINGLE_IMPL_INTERFACE_RULE);

    expect(singleImplFindings.length).toBe(1);

    expect(singleImplFindings[0]).toEqual({
      check: CHECK_NAME,
      rule: NO_SINGLE_IMPL_INTERFACE_RULE,
      severity: SEVERITY_WARNING,
      message: "Interface 'IRepository' has only one concrete implementation ('SqlRepository') and is not exported.",
      file: "src/repo.ts",
      line: 1,
      column: 1,
      excerpt: "interface IRepository {\n  find(id: string): unknown;\n}",
      why: WHY_SINGLE_IMPL,
      suggestion: SUGGESTION_SINGLE_IMPL,
    });
  });

  it("flags anonymous classes implementing an unexported interface", () => {
    const code = `
      interface IAction {
        run(): void;
      }
      export default class implements IAction {
        run() {}
      }
    `;

    const singleImplFindings = checkScars("src/action.ts", code).filter((f) => f.rule === NO_SINGLE_IMPL_INTERFACE_RULE);

    expect(singleImplFindings.length).toBe(1);

    expect(singleImplFindings[0]?.message).toContain("('AnonymousClass')");
  });

  it("permits exported interfaces, Props/State interfaces, and interfaces with multiple implementations", () => {
    const code = `
      export interface IExportedContract {
        exec(): void;
      }
      class Alpha implements IExportedContract {
        exec() {}
      }

      interface IMulti {
        run(): void;
      }
      class WorkerA implements IMulti {
        run() {}
      }
      class WorkerB implements IMulti {
        run() {}
      }

      interface ButtonProps {
        label: string;
      }
      class ButtonComponent implements ButtonProps {
        label = "click";
      }

      interface UserState {
        loggedIn: boolean;
      }
      class StateManager implements UserState {
        loggedIn = true;
      }

      class BaseClass {}
      class ChildClass extends BaseClass {}
    `;

    const singleImplFindings = checkScars("src/contracts.ts", code).filter((f) => f.rule === NO_SINGLE_IMPL_INTERFACE_RULE);

    expect(singleImplFindings).toEqual([]);
  });
});
