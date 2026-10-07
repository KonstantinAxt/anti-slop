import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkStaleMocks, defaultFsExportResolver } from "../src/checks/stale-mocks.js";

describe("Stale vi.mock Resolver (Move #8)", () => {
  it("flags mock factory keys that are not exported by the real module", () => {
    const testCode = `
      import { describe, it } from "vitest";

      vi.mock("./user.service", () => ({
        fetchUserProfile: vi.fn(),
        legacyDeletedMethod: vi.fn(),
      }));

      describe("user test", () => {});
    `;

    // Real module exports only fetchUserProfile
    const mockResolver = (specifier: string, _fromFile: string): string[] | null => {
      if (specifier === "./user.service") {
        return ["fetchUserProfile"];
      }

      return null;
    };

    const findings = checkStaleMocks("src/user.test.ts", testCode, mockResolver);

    expect(findings.length).toBe(1);
    expect(findings[0]?.rule).toBe("stale-mock-export");
    expect(findings[0]?.message).toContain("legacyDeletedMethod");
    expect(findings[0]?.why).toContain("Contract drift");
  });

  it("passes when all mocked keys exist in real module exports", () => {
    const testCode = `
      vi.mock("./user.service", () => ({
        fetchUserProfile: vi.fn(),
      }));
    `;

    const mockResolver = (specifier: string): string[] | null => {
      if (specifier === "./user.service") {
        return ["fetchUserProfile", "saveUserProfile"];
      }

      return null;
    };

    const findings = checkStaleMocks("src/user.test.ts", testCode, mockResolver);

    expect(findings).toEqual([]);
  });

  it("resolves mock factories with block return statements and parenthesized objects", () => {
    const testCode = `
      vi.mock("./block-service", () => {
        return {
          validMethod: vi.fn(),
          missingMethod: vi.fn(),
        };
      });

      vi.mock("./paren-service", () => {
        return ({
          validParen: vi.fn(),
          missingParen: vi.fn(),
        });
      });
    `;

    const mockResolver = (specifier: string): string[] | null => {
      if (specifier === "./block-service") {
        return ["validMethod"];
      }
      if (specifier === "./paren-service") {
        return ["validParen"];
      }

      return null;
    };

    const findings = checkStaleMocks("src/block.test.ts", testCode, mockResolver);

    expect(findings.length).toBe(2);
    expect(findings.some((f) => f.message.includes("missingMethod"))).toBe(true);
    expect(findings.some((f) => f.message.includes("missingParen"))).toBe(true);
  });

  it("resolves module exports using defaultFsExportResolver", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stale-mocks-"));
    try {
      const modulePath = path.join(tmp, "service.ts");
      fs.writeFileSync(
        modulePath,
        `
        export const configValue = 42;
        export function calculateTotal(): number { return 100; }
        export class PaymentProcessor {}
        export interface IPaymentConfig {}
        export type Currency = "USD" | "EUR";
        const localHelper = "secret";
        export { localHelper };
      `
      );

      const testFilePath = path.join(tmp, "service.test.ts");
      const resolved = defaultFsExportResolver("./service", testFilePath);

      expect(resolved).not.toBeNull();
      expect(resolved).toContain("configValue");
      expect(resolved).toContain("calculateTotal");
      expect(resolved).toContain("PaymentProcessor");
      expect(resolved).toContain("IPaymentConfig");
      expect(resolved).toContain("Currency");
      expect(resolved).toContain("localHelper");

      // Non-relative specifiers should return null
      expect(defaultFsExportResolver("lodash", testFilePath)).toBeNull();

      // Missing files should return null
      expect(defaultFsExportResolver("./non-existent", testFilePath)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it("resolves directory index files with defaultFsExportResolver", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stale-mocks-index-"));
    try {
      const subDir = path.join(tmp, "widgets");
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(
        path.join(subDir, "index.ts"),
        `export const WidgetComponent = () => null;`
      );

      const testFilePath = path.join(tmp, "app.test.ts");
      const resolved = defaultFsExportResolver("./widgets", testFilePath);

      expect(resolved).toEqual(["WidgetComponent"]);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});
