import { describe, expect, it } from "vitest";

const registry = new Map<string, number>();
const optionalMap = new Map<string, number | undefined>();
const untypedMap = new Map();

class CustomStore {
  has(_key: string): boolean {
    return true;
  }

  get(_key: string): number {
    return 1;
  }
}

const customStore = new CustomStore();

function mutateMap(target: Map<string, number>): void {
  target.clear();
}

function consumeValue(val: number): number {
  return val + 1;
}

function handleSingleLookup(key: string): number {
  const val = registry.get(key);

  if (val !== undefined) {
    return consumeValue(val);
  }

  return 0;
}

function handleOptionalValueType(key: string): number {
  if (optionalMap.has(key)) {
    const val = optionalMap.get(key);

    return val ?? 0;
  }

  return 0;
}

function handleMutationBetween(key: string): number {
  if (registry.has(key)) {
    mutateMap(registry);
    const val = registry.get(key);

    return val ?? 0;
  }

  return 0;
}

function handleDifferentKey(firstKey: string, secondKey: string): number {
  if (registry.has(firstKey)) {
    const val = registry.get(secondKey);

    return val ?? 0;
  }

  return 0;
}

function handleDifferentReceiver(otherRegistry: Map<string, number>, key: string): number {
  if (registry.has(key)) {
    const val = otherRegistry.get(key);

    return val ?? 0;
  }

  return 0;
}

function handleCustomStore(key: string): number {
  if (customStore.has(key)) {
    return customStore.get(key);
  }

  return 0;
}

function handleUntypedMap(key: string): number {
  if (untypedMap.has(key)) {
    const val = untypedMap.get(key);

    return typeof val === "number" ? val : 0;
  }

  return 0;
}

describe("Clean Presence Check Fixtures", () => {
  it("verifies single lookup produces expected output", () => {
    expect(handleSingleLookup("missing")).toBe(0);
  });

  it("verifies optional value type map lookup", () => {
    expect(handleOptionalValueType("missing")).toBe(0);
  });

  it("verifies mutation between has and get", () => {
    expect(handleMutationBetween("missing")).toBe(0);
  });

  it("verifies different key lookups", () => {
    expect(handleDifferentKey("first", "second")).toBe(0);
  });

  it("verifies different receiver lookups", () => {
    const otherMap = new Map<string, number>();

    expect(handleDifferentReceiver(otherMap, "key")).toBe(0);
  });

  it("verifies custom non-map store lookups", () => {
    expect(handleCustomStore("key")).toBe(1);
  });

  it("verifies untyped map lookups", () => {
    expect(handleUntypedMap("key")).toBe(0);
  });
});
