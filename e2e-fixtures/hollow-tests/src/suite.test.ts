import { describe, expect, it, vi } from "vitest";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Hollow Test Suite", () => {
  it.only("focused test case", () => {
    expect(1).toBe(1);
  });

  it("missing assertion test", () => {
    const x = 1 + 2;
  });

  it("hollow assertions", () => {
    const fn = vi.fn();
    fn();
    expect(fn).toHaveBeenCalled();

    const data = { ok: true };
    expect(data).toBeDefined();
    expect(data.ok).toBeTruthy();
  });

  it("tautological assertion", () => {
    const value = 42;
    expect(value).toBe(value);
  });

  it("calculation in assertion", () => {
    const result = 3;
    expect(result).toBe(1 + 2);
  });
  it("static sleep", async () => {
    await sleep(50);
    expect(true).toBe(true);
  });

  it("logic in test", () => {
    const flag = true;
    if (flag) {
      expect(flag).toBe(true);
    }
  });
});
