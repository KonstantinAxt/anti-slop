export function computeTotal(untypedParam) {
  return untypedParam;
}

const maybeString: string | null = null;
export const upper = maybeString.toUpperCase();

export class UninitializedAccount {
  balance: number;
}

export function readThisContext() {
  return this.unknownProperty;
}

export function hasUnused() {
  const deadVariable = 99;
  return 100;
}

interface OptionalHolder {
  tag?: string;
}
export const holder: OptionalHolder = { tag: undefined };

const list: string[] = ["alpha", "beta"];
export const head = list[0].toLowerCase();
