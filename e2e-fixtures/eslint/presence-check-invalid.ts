const registry = new Map<string, number>();

function consumeValue(val: number): number {
  return val + 1;
}

function failWithError(message: string): never {
  throw new Error(message);
}

export function handleUnreachableGuard(key: string): number {
  if (registry.has(key)) {
    const val = registry.get(key);

    if (val === undefined) {
      throw new Error("unreachable");
    }

    return consumeValue(val);
  }

  return 0;
}

export function handleNegatedEarlyReturn(key: string): number {
  if (!registry.has(key)) {
    return 0;
  }
  const val = registry.get(key) ?? failWithError("missing");

  return consumeValue(val);
}
