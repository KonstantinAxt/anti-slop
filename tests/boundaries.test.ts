import { describe, expect, it } from "bun:test";
import { checkBoundaries } from "../src/checks/boundaries.js";
const UI_FREE_SERVICE_RULE = "ui-free-service";
const MOCK_LEAK_RULE = "mock-leak";
const ISOLATED_UTILS_RULE = "isolated-utils";

describe("Layer Boundaries Checker (Move #4)", () => {
  it("flags a service importing a UI component or hook", () => {
    const serviceCode = `
      import { Button } from "../components/Button";
      import { useUserModal } from "../hooks/useUserModal";

      export class UserService {
        renderButton() { return Button; }
      }
    `;

    const findings = checkBoundaries("src/services/user.service.ts", serviceCode);

    expect(findings.length).toBe(2);
    expect(findings[0]).toEqual({
      check: "boundaries",
      rule: UI_FREE_SERVICE_RULE,
      severity: "error",
      message: "Business layer (src/services/user.service.ts) imports UI component or hook from '../components/Button'.",
      file: "src/services/user.service.ts",
      line: 2,
      column: 7,
      excerpt: 'import { Button } from "../components/Button";',
      why: "Architecture invariant: Business layers stay UI-free. A service, store, lib or type file must not import components, pages or hooks. Shared types belong in src/types or next to the service.",
      suggestion: "Extract shared types or business logic so UI depends on services, not vice versa.",
    });
    expect(findings[1]?.rule).toBe(UI_FREE_SERVICE_RULE);
  });

  it("flags test mocks imported into production source files", () => {
    const prodCode = `
      import { fakeUser } from "../__mocks__/user.mock";
      import { http } from "msw";

      export function getInitialUser() {
        return fakeUser;
      }
    `;

    const findings = checkBoundaries("src/services/auth.ts", prodCode);

    expect(findings.length).toBe(2);
    expect(findings[0]).toEqual({
      check: "boundaries",
      rule: MOCK_LEAK_RULE,
      severity: "error",
      message: "Production file (src/services/auth.ts) imports mock or test dependency '../__mocks__/user.mock'.",
      file: "src/services/auth.ts",
      line: 2,
      column: 7,
      excerpt: 'import { fakeUser } from "../__mocks__/user.mock";',
      why: "Architecture invariant: Test mocks and fixtures must stay out of production builds.",
      suggestion: "Move mock data into test files or separate development fixtures.",
    });
    expect(findings[1]?.rule).toBe(MOCK_LEAK_RULE);
  });

  it("allows test mocks in test files", () => {
    const testCode = `
      import { fakeUser } from "../__mocks__/user.mock";
      import { http } from "msw";
      import { describe, it } from "vitest";

      describe("auth", () => {});
    `;

    const findings = checkBoundaries("src/services/auth.test.ts", testCode);

    expect(findings).toEqual([]);
  });

  it("flags utility files importing business services", () => {
    const utilCode = `
      import { orderService } from "../services/order.service";

      export function formatOrderDate(date: Date) {
        return orderService.format(date);
      }
    `;

    const findings = checkBoundaries("src/utils/date.ts", utilCode);

    expect(findings.length).toBe(1);
    expect(findings[0]).toEqual({
      check: "boundaries",
      rule: ISOLATED_UTILS_RULE,
      severity: "error",
      message: "Utility or config file (src/utils/date.ts) imports domain service or store from '../services/order.service'.",
      file: "src/utils/date.ts",
      line: 2,
      column: 7,
      excerpt: 'import { orderService } from "../services/order.service";',
      why: "Architecture invariant: Utilities, types, and configuration stay free of domain logic.",
      suggestion: "Move business logic into the service layer, keeping utilities pure and generic.",
    });
  });

  it("flags dynamic imports and re-exports violating layer boundaries", () => {
    const dynamicCode = `
      export async function loadUI() {
        const modal = await import("../components/UserModal");
        return modal;
      }
      export { UserList } from "../components/UserList";
    `;

    const findings = checkBoundaries("src/services/user.service.ts", dynamicCode);

    expect(findings.length).toBe(2);
    expect(findings.every((f) => f.rule === UI_FREE_SERVICE_RULE)).toBe(true);
  });

  it("allows UI components or views to import domain services without triggering isolated-utils", () => {
    const viewCode = `
      import { orderService } from "../services/order.service";
      export function OrderView() { return orderService.get(); }
    `;

    const findings = checkBoundaries("src/views/order.tsx", viewCode);

    expect(findings.filter((f) => f.rule === ISOLATED_UTILS_RULE)).toEqual([]);
  });

  it("flags root-level services importing root-level UI components", () => {
    const code = 'import { Button } from "components/Button";';
    const findings = checkBoundaries("services/user.ts", code);

    expect(findings.length).toBe(1);
    expect(findings[0]?.rule).toBe(UI_FREE_SERVICE_RULE);
  });

  it("flags root-level utils importing root-level domain stores", () => {
    const code = 'import { store } from "stores/user";';
    const findings = checkBoundaries("utils/format.ts", code);

    expect(findings.length).toBe(1);
    expect(findings[0]?.rule).toBe(ISOLATED_UTILS_RULE);
  });

  it("flags imports ending in .mock without __mocks__ in path", () => {
    const code = 'import { mockAuth } from "./auth.mock";';
    const findings = checkBoundaries("src/lib/api.ts", code);

    expect(findings.length).toBe(1);
    expect(findings[0]?.rule).toBe(MOCK_LEAK_RULE);
  });

  it("allows test mocks in setup.ts and setup.js test files", () => {
    const code = 'import { mockAuth } from "./auth.mock";';

    expect(checkBoundaries("src/setup.ts", code)).toEqual([]);
    expect(checkBoundaries("setup.js", code)).toEqual([]);
  });
});
