import { describe, expect, it, vi } from "vitest";

describe("Clean Test Suite", () => {
  it("verifies expected output with proper assertion", () => {
    const mockHandler = vi.fn();
    mockHandler("user-id-42");

    expect(mockHandler).toHaveBeenCalledWith("user-id-42");
  });

  it("calculates values without inline assertions", () => {
    const expectedValue = 42;
    const actualValue = 42;

    expect(actualValue).toBe(expectedValue);
  });
});
