import { describe, expect, it, vi } from "vitest";

vi.mock("./target", () => ({
  fakeNonExistentFunction: () => "mocked",
}));

describe("Stale Mock Suite", () => {
  it("runs test", () => {
    expect(1).toBe(2);
  });
});
