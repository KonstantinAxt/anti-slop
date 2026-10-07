// TODO test plan: verify slop rules
// AI comments — should not have em-dash
// We should delve into this and leverage the synergy

export type UserIdentifier = string;

export class UtilityMathClass {
  static sum(a: number, b: number) { return a + b; }
  static mult(a: number, b: number) { return a * b; }
}

function targetAdd(a: number, b: number) { return a + b; }
const trivialWrapper = (a: number, b: number) => targetAdd(a, b);

export function testSlopOperations() {
  const k = 10;
  let calculation = k * 42000;
  const chained = ("sample" as unknown) as string;
  const singleCast = "sample" as string;
  return trivialWrapper(1, 2);
}
