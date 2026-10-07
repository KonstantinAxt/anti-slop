export function complexFunction(a: number, b: number, c: number, d: number): number {
  let result = 0;
  if (a > 0) {
    if (b > 0) {
      if (c > 0) {
        if (d > 0) {
          for (let i = 0; i < 10; i++) {
            while (result < 100) {
              if (i % 2 === 0) {
                result += a + b;
              } else {
                result += c + d;
              }
            }
          }
        }
      }
    }
  }
  return result;
}

export function identicalConditions(score: number): string {
  if (score > 10) {
    return "high";
  } else if (score > 10) {
    return "high again";
  }
  return "low";
}

export function duplicatedBranches(flag: boolean): number {
  if (flag) {
    const x = 10;
    return x * 2;
  } else {
    const x = 10;
    return x * 2;
  }
}

export function identicalExpressions(num: number): number {
  return num / num;
}

export function duplicateStrings(): string[] {
  const s1 = "alpha beta gamma delta epsilon";
  const s2 = "alpha beta gamma delta epsilon";
  const s3 = "alpha beta gamma delta epsilon";
  const s4 = "alpha beta gamma delta epsilon";
  const s5 = "alpha beta gamma delta epsilon";
  return [s1, s2, s3, s4, s5];
}
