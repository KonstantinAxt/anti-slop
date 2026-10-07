import { describe, expect, it } from "vitest";
import { checkWithEslint } from "../src/checks/eslint-runner.js";

const RULE_NAME = "slop/no-redundant-presence-check";

async function expectSingleViolation(code: string, expectedSnippet: string): Promise<void> {
  const findings = await checkWithEslint("src/service.ts", code);
  const ruleFindings = findings.filter((finding) => finding.rule === RULE_NAME);

  expect(ruleFindings).toHaveLength(1);
  expect(ruleFindings[0]?.message).toContain(expectedSnippet);
}

async function expectClean(code: string): Promise<void> {
  const findings = await checkWithEslint("src/service.ts", code);
  const ruleFindings = findings.filter((finding) => finding.rule === RULE_NAME);

  expect(ruleFindings).toHaveLength(0);
}

describe("slop/no-redundant-presence-check", () => {
  it("flags unreachable guard pattern in if statement", async () => {
    const code = `
      const registry = new Map<string, number>();

      export function verifyPresence(key: string): number {
        if (registry.has(key)) {
          const val = registry.get(key);
          if (val === undefined) throw new Error("unreachable");
          return val;
        }
        return 0;
      }
    `;

    await expectSingleViolation(code, "unreachable guard");
  });

  it("flags unreachable guard pattern with negated early return and nullish coalesce throw", async () => {
    const code = `
      const registry = new Map<string, number>();

      function fail(message: string): never {
        throw new Error(message);
      }

      export function verifyPresence(key: string): number {
        if (!registry.has(key)) return 0;
        const val = registry.get(key) ?? fail("missing");
        return val;
      }
    `;

    await expectSingleViolation(code, "unreachable guard");
  });

  it("flags unreachable guard pattern with negated early return followed by if-undefined guard", async () => {
    const code = `
      const registry = new Map<string, number>();

      export function verifyPresence(key: string): number {
        if (!registry.has(key)) return 0;
        const val = registry.get(key);
        if (val === undefined) throw new Error("unreachable");
        return val;
      }
    `;

    await expectSingleViolation(code, "unreachable guard");
  });

  it("flags double lookup in ternary expression", async () => {
    const code = `
      const registry = new Map<string, number>();

      export function lookupValue(key: string): number {
        const val = registry.has(key) ? registry.get(key) : 0;
        return val ?? 0;
      }
    `;

    await expectSingleViolation(code, "before 'get(key)'");
  });

  it("flags double lookup in if statement without guard", async () => {
    const code = `
      const registry = new Map<string, number>();

      export function lookupValue(key: string): number {
        if (registry.has(key)) {
          const val = registry.get(key);
          return val ?? 0;
        }
        return 0;
      }
    `;

    await expectSingleViolation(code, "before 'get(key)'");
  });

  it("flags double lookup on this.property receiver in class", async () => {
    const code = `
      export class CacheService {
        private store = new Map<string, number>();

        public lookup(key: string): number {
          if (this.store.has(key)) {
            return this.store.get(key) ?? 0;
          }
          return 0;
        }
      }
    `;

    await expectSingleViolation(code, "this.store");
  });

  it("allows single lookup with undefined check", async () => {
    const code = `
      const registry = new Map<string, number>();

      export function lookupValue(key: string): number {
        const val = registry.get(key);
        if (val !== undefined) {
          return val;
        }
        return 0;
      }
    `;

    await expectClean(code);
  });

  it("allows presence check when value type includes undefined", async () => {
    const code = `
      const registry = new Map<string, number | undefined>();

      export function lookupValue(key: string): number | undefined {
        if (registry.has(key)) {
          return registry.get(key);
        }
        return 0;
      }
    `;

    await expectClean(code);
  });

  it("allows presence check when map is mutated between has and get", async () => {
    const code = `
      const registry = new Map<string, number>();

      function mutate(target: Map<string, number>): void {
        target.clear();
      }

      export function lookupValue(key: string): number {
        if (registry.has(key)) {
          mutate(registry);
          return registry.get(key) ?? 0;
        }
        return 0;
      }
    `;

    await expectClean(code);
  });

  it("allows presence check when function call occurs between has and get", async () => {
    const code = `
      const registry = new Map<string, number>();

      function logAccess(): void {
        console.log("access");
      }

      export function lookupValue(key: string): number {
        if (registry.has(key)) {
          logAccess();
          return registry.get(key) ?? 0;
        }
        return 0;
      }
    `;

    await expectClean(code);
  });

  it("allows presence check when key is reassigned between has and get", async () => {
    const code = `
      const registry = new Map<string, number>();

      export function lookupValue(key: string): number {
        if (registry.has(key)) {
          key = "other";
          return registry.get(key) ?? 0;
        }
        return 0;
      }
    `;

    await expectClean(code);
  });

  it("allows presence check when has and get use different keys", async () => {
    const code = `
      const registry = new Map<string, number>();

      export function lookupValue(firstKey: string, secondKey: string): number {
        if (registry.has(firstKey)) {
          return registry.get(secondKey) ?? 0;
        }
        return 0;
      }
    `;

    await expectClean(code);
  });

  it("allows presence check when has and get use different receivers", async () => {
    const code = `
      const firstMap = new Map<string, number>();
      const secondMap = new Map<string, number>();

      export function lookupValue(key: string): number {
        if (firstMap.has(key)) {
          return secondMap.get(key) ?? 0;
        }
        return 0;
      }
    `;

    await expectClean(code);
  });

  it("allows presence check on custom class that is not a Map", async () => {
    const code = `
      class CustomCache {
        has(_key: string): boolean { return true; }
        get(_key: string): number { return 1; }
      }

      const cache = new CustomCache();

      export function lookupValue(key: string): number {
        if (cache.has(key)) {
          return cache.get(key);
        }
        return 0;
      }
    `;

    await expectClean(code);
  });

  it("skips get already wrapped in non-null assertion", async () => {
    const code = `
      const registry = new Map<string, number>();

      export function lookupValue(key: string): number {
        if (registry.has(key)) {
          return registry.get(key)!;
        }
        return 0;
      }
    `;

    await expectClean(code);
  });

  it("skips get already wrapped in type assertion as", async () => {
    const code = `
      const registry = new Map<string, number>();

      export function lookupValue(key: string): number {
        if (registry.has(key)) {
          return registry.get(key) as number;
        }
        return 0;
      }
    `;

    await expectClean(code);
  });

  it("allows presence check when map value type is unknown", async () => {
    const code = `
      const registry = new Map();

      export function lookupValue(key: string): unknown {
        if (registry.has(key)) {
          return registry.get(key);
        }
        return null;
      }
    `;

    await expectClean(code);
  });

  it("allows presence check when map value type is any or unknown", async () => {
    const code = `
      const anyMap = new Map<string, any>();
      const unknownMap = new Map<string, unknown>();

      export function lookupAny(key: string): unknown {
        if (anyMap.has(key)) {
          return anyMap.get(key);
        }
        return null;
      }

      export function lookupUnknown(key: string): unknown {
        if (unknownMap.has(key)) {
          return unknownMap.get(key);
        }
        return null;
      }
    `;

    await expectClean(code);
  });

  it("flags double lookup with binary equality check against false or true", async () => {
    const code = `
      const registry = new Map<string, number>();

      export function lookupFalse(key: string): number {
        if (registry.has(key) === false) return 0;
        return registry.get(key) ?? 0;
      }

      export function lookupTrue(key: string): number {
        if (registry.has(key) !== true) return 0;
        return registry.get(key) ?? 0;
      }

      export function lookupInverted(key: string): number {
        if (false === registry.has(key)) return 0;
        return registry.get(key) ?? 0;
      }
    `;

    const findings = await checkWithEslint("src/service.ts", code);
    const ruleFindings = findings.filter((finding) => finding.rule === RULE_NAME);

    expect(ruleFindings).toHaveLength(3);
  });

  it("flags unreachable guard with inverted undefined check or null checks", async () => {
    const code = `
      const registry = new Map<string, number>();

      export function lookupInverted(key: string): number {
        if (registry.has(key)) {
          const val = registry.get(key);
          if (undefined === val) throw new Error();
          return val;
        }
        return 0;
      }

      export function lookupNull(key: string): number {
        if (registry.has(key)) {
          const val = registry.get(key);
          if (val == null) throw new Error();
          return val;
        }
        return 0;
      }
    `;

    const findings = await checkWithEslint("src/service.ts", code);
    const ruleFindings = findings.filter((finding) => finding.rule === RULE_NAME);

    expect(ruleFindings).toHaveLength(2);
  });
});
