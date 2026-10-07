import { describe, it, expect, vi } from "vitest";

expect(true).toBe(true);

describe("Vitest Rules Suite", () => {
  it("duplicate title", () => {
    const fn = vi.fn();
    fn();
    expect(fn).toHaveBeenCalled();
    const arr = [1];
    expect(arr.length).toBe(1);
    console.log("redundant log");
    setTimeout(() => {}, 50);
  });
  it("duplicate title", () => {
    expect("valid-expect-failure");
    const cond = true;
    if (cond) {
      expect(cond).toBe(true);
    }
  });
});
