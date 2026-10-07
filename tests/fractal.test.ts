import { describe, expect, it } from "bun:test";
import { createSourceFile } from "../src/checks/ast.js";
import type { Finding } from "../src/types.js";
import { checkFractalArchitecture } from "../src/checks/fractal.js";

const CHECK_FRACTAL = "fractal";
const RULE_NO_DIRECT = "no-direct-fragment-import";
const RULE_NO_PRIVATE = "no-private-leak";
const RULE_NO_UPWARD = "no-upward-dependency";
const RULE_PEER_ISOLATION = "peer-isolation";
const SEV_ERROR = "error";

const WHY_ACCESS_NODE =
  "Fractal Architecture Invariant: Access Node Encapsulation. An external module must only interact with a Fragment's public interface, never its internal implementation details.";
const WHY_PRIVATE_BRANCH =
  "Fractal Architecture Invariant: Private Branch Encapsulation. Private fractal branches (@Scope, __scope) exist solely to decompose a parent component and must not leak outside their owning scope.";
const WHY_UNIDIRECTIONAL =
  "Fractal Architecture Invariant: Unidirectional Dependency Flow. Higher-level components compose lower-level sub-components. Sub-components must not import their parent containers.";
const WHY_PEER_SEPARATION =
  "Fractal Architecture Invariant: Law of Separation Between Peers. Sibling modules at the same fractal hierarchy level must not form lateral coupling.";

const SUGGEST_PRIVATE =
  "Promote shared functionality to an ancestor shared branch (e.g. __shared) or import through the parent component's public interface.";
const SUGGEST_UPWARD =
  "Pass required data down via props, context, or hoist common state to a shared model/store.";
const SUGGEST_PEER =
  "Extract shared logic into a shared module under '__shared' or pass it through the parent component.";

const SUGGEST_BUTTON_ROOT =
  "Import through the Fragment's root access node (e.g. 'src/components/button') instead of referencing internal files directly.";
const SUGGEST_CARD_ROOT =
  "Import through the Fragment's root access node (e.g. 'src/components/card') instead of referencing internal files directly.";

const HOME_PAGE = "src/pages/Home.tsx";
const DASHBOARD_PAGE = "src/pages/dashboard/Dashboard.tsx";
const SIDEBAR_SUB_PATH =
  "src/widgets/navigation-panel/@NavigationPanel/tree-view/TreeView.tsx";
const TESTING_PAGE = "src/pages/TestingPage.tsx";
const CARD_INTERNAL_BASE = "src/components/card";

const IMPORT_BUTTON_INTERNAL =
  'import { Button } from "../components/button/button.component";';
function expectedButtonFragmentFinding(excerpt: string): Finding {
  return {
    check: CHECK_FRACTAL,
    rule: RULE_NO_DIRECT,
    severity: SEV_ERROR,
    message: `External module (${HOME_PAGE}) imports internal fragment file '../components/button/button.component'. Cross-fragment imports must consume through the public access node (index).`,
    file: HOME_PAGE,
    line: 1,
    column: 1,
    excerpt,
    why: WHY_ACCESS_NODE,
    suggestion: SUGGEST_BUTTON_ROOT,
  };
}


describe("Fractal Architecture Checker (FAF & DFRA)", () => {
  describe("Rule: no-direct-fragment-import", () => {
    it("flags an external module directly importing an internal fragment component with exact finding coordinates", () => {
      const code = IMPORT_BUTTON_INTERNAL;
      const findings = checkFractalArchitecture(HOME_PAGE, code);

      expect(findings).toEqual([expectedButtonFragmentFinding(IMPORT_BUTTON_INTERNAL)]);
    });

    it("flags external module importing internal hook or model with alias and relative paths", () => {
      const code = [
        'import { useButtonState } from "@/components/button/button.hook";',
        'import { sidebarReducer } from "../../widgets/sidebar/model/sidebar-slice";',
      ].join("\n");
      const findings = checkFractalArchitecture(DASHBOARD_PAGE, code);

      expect(findings).toEqual([
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_DIRECT,
          severity: SEV_ERROR,
          message:
            `External module (${DASHBOARD_PAGE}) imports internal fragment file '@/components/button/button.hook'. Cross-fragment imports must consume through the public access node (index).`,
          file: DASHBOARD_PAGE,
          line: 1,
          column: 1,
          excerpt: 'import { useButtonState } from "@/components/button/button.hook";',
          why: WHY_ACCESS_NODE,
          suggestion: SUGGEST_BUTTON_ROOT,
        },
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_DIRECT,
          severity: SEV_ERROR,
          message:
            `External module (${DASHBOARD_PAGE}) imports internal fragment file '../../widgets/sidebar/model/sidebar-slice'. Cross-fragment imports must consume through the public access node (index).`,
          file: DASHBOARD_PAGE,
          line: 2,
          column: 1,
          excerpt: 'import { sidebarReducer } from "../../widgets/sidebar/model/sidebar-slice";',
          why: WHY_ACCESS_NODE,
          suggestion:
            "Import through the Fragment's root access node (e.g. 'src/widgets/sidebar') instead of referencing internal files directly.",
        },
      ]);
    });

    it.each([
      "component.tsx",
      "hook.ts",
      "model.ts",
      "style.ts",
      "util.ts",
      "view.jsx",
      "controller.ts",
      "slice.ts",
      "service.ts",
      "store.ts",
      "schema.ts",
      "boundary.tsx",
    ])("flags role suffix %s", (suffix) => {
      const specifier = `../components/user/user.${suffix}`;
      const code = `import { item } from "${specifier}";`;
      const findings = checkFractalArchitecture(HOME_PAGE, code);

      expect(findings).toEqual([
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_DIRECT,
          severity: SEV_ERROR,
          message: `External module (${HOME_PAGE}) imports internal fragment file '${specifier}'. Cross-fragment imports must consume through the public access node (index).`,
          file: HOME_PAGE,
          line: 1,
          column: 1,
          excerpt: `import { item } from "${specifier}";`,
          why: WHY_ACCESS_NODE,
          suggestion:
            "Import through the Fragment's root access node (e.g. 'src/components/user') instead of referencing internal files directly.",
        },
      ]);
    });

    it.each([
      {
        target: "src/features/auth/apis/login",
        expectedRoot: "src/features/auth",
      },
      {
        target: "src/domains/billing/state/cart",
        expectedRoot: "src/domains/billing",
      },
      {
        target: "src/modules/profile/views/avatar",
        expectedRoot: "src/modules/profile",
      },
      {
        target: "src/app/navigation/controllers/router",
        expectedRoot: "src/app/navigation",
      },
      {
        target: "src/widgets/media-viewer/presenters/playback",
        expectedRoot: "src/widgets/media-viewer",
      },
      {
        target: "src/pages/checkout/slices/order",
        expectedRoot: "src/pages/checkout",
      },
      {
        target: `${CARD_INTERNAL_BASE}/internal/helpers`,
        expectedRoot: CARD_INTERNAL_BASE,
      },
      {
        target: `${CARD_INTERNAL_BASE}/utils/format`,
        expectedRoot: CARD_INTERNAL_BASE,
      },
      {
        target: `${CARD_INTERNAL_BASE}/styles/theme`,
        expectedRoot: CARD_INTERNAL_BASE,
      },
      {
        target: `${CARD_INTERNAL_BASE}/stores/card-store`,
        expectedRoot: CARD_INTERNAL_BASE,
      },
    ])("flags internal folder target $target", ({ target, expectedRoot }) => {
      const code = `import { sub } from "${target}";`;
      const findings = checkFractalArchitecture(HOME_PAGE, code);

      expect(findings).toEqual([
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_DIRECT,
          severity: SEV_ERROR,
          message: `External module (${HOME_PAGE}) imports internal fragment file '${target}'. Cross-fragment imports must consume through the public access node (index).`,
          file: HOME_PAGE,
          line: 1,
          column: 1,
          excerpt: `import { sub } from "${target}";`,
          why: WHY_ACCESS_NODE,
          suggestion: `Import through the Fragment's root access node (e.g. '${expectedRoot}') instead of referencing internal files directly.`,
        },
      ]);
    });

    it("allows importing through public access node barrels (index, index.ts, index.tsx, index.js, index.jsx)", () => {
      const code = [
        'import { Button } from "../components/button";',
        'import { A } from "../widgets/sidebar/index";',
        'import { B } from "../widgets/sidebar/index.ts";',
        'import { C } from "../widgets/sidebar/index.tsx";',
        'import { D } from "../widgets/sidebar/index.js";',
        'import { E } from "../widgets/sidebar/index.jsx";',
      ].join("\n");
      const findings = checkFractalArchitecture(HOME_PAGE, code);

      expect(findings).toEqual([]);
    });

    it("allows internal files inside the same fragment to import sibling units", () => {
      const code = [
        'import { useButtonState } from "./button.hook";',
        'import { buttonStyles } from "./button.style";',
        'import { ButtonProps } from "./model/button.model";',
      ].join("\n");
      const findings = checkFractalArchitecture(
        "src/components/button/button.component.tsx",
        code,
      );

      expect(findings).toEqual([]);
    });

    it("flags negative prefix match where importing file is not inside the target fragment", () => {
      const code = 'import { Button } from "../button/button.component";';
      const findings = checkFractalArchitecture(
        "src/components/button-extra/ButtonExtra.tsx",
        code,
      );

      expect(findings).toEqual([
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_DIRECT,
          severity: SEV_ERROR,
          message:
            "External module (src/components/button-extra/ButtonExtra.tsx) imports internal fragment file '../button/button.component'. Cross-fragment imports must consume through the public access node (index).",
          file: "src/components/button-extra/ButtonExtra.tsx",
          line: 1,
          column: 1,
          excerpt: 'import { Button } from "../button/button.component";',
          why: WHY_ACCESS_NODE,
          suggestion: SUGGEST_BUTTON_ROOT,
        },
      ]);
    });

    it("detects dynamic imports and re-exports targeting internal files", () => {
      const code = [
        'export { Button } from "../components/button/button.component";',
        'export * from "../components/button/button.hook";',
        'const load = () => { return import("../components/card/card.component"); };',
      ].join("\n");
      const findings = checkFractalArchitecture(HOME_PAGE, code);

      expect(findings).toEqual([
        expectedButtonFragmentFinding('export { Button } from "../components/button/button.component";'),
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_DIRECT,
          severity: SEV_ERROR,
          message:
            `External module (${HOME_PAGE}) imports internal fragment file '../components/button/button.hook'. Cross-fragment imports must consume through the public access node (index).`,
          file: HOME_PAGE,
          line: 2,
          column: 1,
          excerpt: 'export * from "../components/button/button.hook";',
          why: WHY_ACCESS_NODE,
          suggestion: SUGGEST_BUTTON_ROOT,
        },
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_DIRECT,
          severity: SEV_ERROR,
          message:
            `External module (${HOME_PAGE}) imports internal fragment file '../components/card/card.component'. Cross-fragment imports must consume through the public access node (index).`,
          file: HOME_PAGE,
          line: 3,
          column: 29,
          excerpt: 'import("../components/card/card.component")',
          why: WHY_ACCESS_NODE,
          suggestion: SUGGEST_CARD_ROOT,
        },
      ]);
    });

    it("supports ~/ workspace path alias", () => {
      const code = 'import { Button } from "~/components/button/button.component";';
      const findings = checkFractalArchitecture(HOME_PAGE, code);

      expect(findings).toEqual([
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_DIRECT,
          severity: SEV_ERROR,
          message:
            `External module (${HOME_PAGE}) imports internal fragment file '~/components/button/button.component'. Cross-fragment imports must consume through the public access node (index).`,
          file: HOME_PAGE,
          line: 1,
          column: 1,
          excerpt: 'import { Button } from "~/components/button/button.component";',
          why: WHY_ACCESS_NODE,
          suggestion: SUGGEST_BUTTON_ROOT,
        },
      ]);
    });
  });

  describe("Rule: no-private-leak", () => {
    it("flags an external file importing from a private @Scope branch with exact fields", () => {
      const code = 'import { TreeView } from "../navigation-panel/@NavigationPanel/tree-view";';
      const findings = checkFractalArchitecture("src/widgets/media-viewer/MediaViewer.tsx", code);

      expect(findings).toEqual([
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_PRIVATE,
          severity: SEV_ERROR,
          message:
            "File (src/widgets/media-viewer/MediaViewer.tsx) leaks private fractal branch '@NavigationPanel' from '../navigation-panel/@NavigationPanel/tree-view'. Private branches are encapsulated within their parent scope.",
          file: "src/widgets/media-viewer/MediaViewer.tsx",
          line: 1,
          column: 1,
          excerpt: 'import { TreeView } from "../navigation-panel/@NavigationPanel/tree-view";',
          why: WHY_PRIVATE_BRANCH,
          suggestion: SUGGEST_PRIVATE,
        },
      ]);
    });

    it("flags an external file importing from a private __scope branch with exact fields", () => {
      const code = 'import { AboutHeader } from "../about/__about.page/header";';
      const findings = checkFractalArchitecture(HOME_PAGE, code);

      expect(findings).toEqual([
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_PRIVATE,
          severity: SEV_ERROR,
          message:
            `File (${HOME_PAGE}) leaks private fractal branch '__about.page' from '../about/__about.page/header'. Private branches are encapsulated within their parent scope.`,
          file: HOME_PAGE,
          line: 1,
          column: 1,
          excerpt: 'import { AboutHeader } from "../about/__about.page/header";',
          why: WHY_PRIVATE_BRANCH,
          suggestion: SUGGEST_PRIVATE,
        },
      ]);
    });

    it("allows the owning parent component to import from its private branch", () => {
      const code = 'import { TreeView } from "./@NavigationPanel/tree-view";';
      const findings = checkFractalArchitecture(
        "src/widgets/navigation-panel/NavigationPanel.tsx",
        code,
      );

      expect(findings).toEqual([]);
    });

    it("flags leak when importer path shares prefix with scope dir but is not inside it", () => {
      const code = 'import { Sub } from "../navigation-panel/@NavigationPanel/lib";';
      const findings = checkFractalArchitecture(
        "src/widgets/navigation-panel-extra/Extra.tsx",
        code,
      );

      expect(findings).toEqual([
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_PRIVATE,
          severity: SEV_ERROR,
          message:
            "File (src/widgets/navigation-panel-extra/Extra.tsx) leaks private fractal branch '@NavigationPanel' from '../navigation-panel/@NavigationPanel/lib'. Private branches are encapsulated within their parent scope.",
          file: "src/widgets/navigation-panel-extra/Extra.tsx",
          line: 1,
          column: 1,
          excerpt: 'import { Sub } from "../navigation-panel/@NavigationPanel/lib";',
          why: WHY_PRIVATE_BRANCH,
          suggestion: SUGGEST_PRIVATE,
        },
      ]);
    });
  });

  describe("Rule: no-upward-dependency", () => {
    it("flags a nested sub-component importing its parent container with exact fields", () => {
      const code = 'import { DesktopSidebar } from "../../DesktopSidebar";';
      const findings = checkFractalArchitecture(SIDEBAR_SUB_PATH, code);

      expect(findings).toEqual([
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_UPWARD,
          severity: SEV_ERROR,
          message:
            `Sub-component (${SIDEBAR_SUB_PATH}) imports ancestor component '../../DesktopSidebar'. Dependencies in fractal architecture must flow downward.`,
          file: SIDEBAR_SUB_PATH,
          line: 1,
          column: 1,
          excerpt: 'import { DesktopSidebar } from "../../DesktopSidebar";',
          why: WHY_UNIDIRECTIONAL,
          suggestion: SUGGEST_UPWARD,
        },
      ]);
    });

    it("flags a sub-component importing root scope directory directly", () => {
      const code = 'import { Sidebar } from "../..";';
      const findings = checkFractalArchitecture(SIDEBAR_SUB_PATH, code);

      expect(findings).toEqual([
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_UPWARD,
          severity: SEV_ERROR,
          message:
            `Sub-component (${SIDEBAR_SUB_PATH}) imports ancestor component '../..'. Dependencies in fractal architecture must flow downward.`,
          file: SIDEBAR_SUB_PATH,
          line: 1,
          column: 1,
          excerpt: 'import { Sidebar } from "../..";',
          why: WHY_UNIDIRECTIONAL,
          suggestion: SUGGEST_UPWARD,
        },
      ]);
    });

    it("allows a sub-component to import standard external libraries and peer modules in same branch", () => {
      const code = [
        'import React from "react";',
        'import { useState } from "react";',
        'import { helper } from "./helper";',
      ].join("\n");
      const findings = checkFractalArchitecture(SIDEBAR_SUB_PATH, code);

      expect(findings).toEqual([]);
    });
  });

  describe("Rule: peer-isolation", () => {
    it("flags direct cross-peer dependency between sibling sub-components with exact fields", () => {
      const code = 'import { NavigationList } from "../navigation-list/NavigationList";';
      const findings = checkFractalArchitecture(SIDEBAR_SUB_PATH, code);

      expect(findings).toEqual([
        {
          check: CHECK_FRACTAL,
          rule: RULE_PEER_ISOLATION,
          severity: SEV_ERROR,
          message:
            `Peer sub-component (${SIDEBAR_SUB_PATH}) directly imports sibling peer '../navigation-list/NavigationList'. Sibling sub-components must remain isolated.`,
          file: SIDEBAR_SUB_PATH,
          line: 1,
          column: 1,
          excerpt: 'import { NavigationList } from "../navigation-list/NavigationList";',
          why: WHY_PEER_SEPARATION,
          suggestion: SUGGEST_PEER,
        },
      ]);
    });

    it("allows files within the same sub-component peer directory to import each other", () => {
      const code = 'import { SubWidget } from "./SubWidget";';
      const findings = checkFractalArchitecture(SIDEBAR_SUB_PATH, code);

      expect(findings).toEqual([]);
    });
  });

  describe("Test and config file exemptions", () => {
    it.each([
      "src/components/button/button.test.ts",
      "src/components/button/button.test.tsx",
      "src/components/button/button.test.js",
      "src/components/button/button.test.jsx",
      "src/components/button/button.spec.ts",
      "src/components/button/button.spec.tsx",
      "src/components/button/button.spec.js",
      "src/components/button/button.spec.jsx",
      "src/components/button/button.stories.ts",
      "src/components/button/button.stories.tsx",
      "src/components/button/button.stories.js",
      "src/components/button/button.stories.jsx",
    ])("exempts test and story file %s", (exemptPath) => {
      const code = IMPORT_BUTTON_INTERNAL;
      const findings = checkFractalArchitecture(exemptPath, code);

      expect(findings).toEqual([]);
    });

    it.each([
      "src/components/button/__tests__/button.tsx",
      "src/components/button/__mocks__/button.ts",
      "src/components/button/__fixtures__/button.ts",
      ".storybook/main.ts",
      "src/.storybook/preview.tsx",
      "vite.config.ts",
      "eslint.config.js",
      "test/setup.ts",
      "src/setup.js",
    ])("exempts test directory, storybook, config, and setup file %s", (exemptPath) => {
      const code = IMPORT_BUTTON_INTERNAL;
      const findings = checkFractalArchitecture(exemptPath, code);

      expect(findings).toEqual([]);
    });

    it("does not exempt production files that contain test-like substrings in file name", () => {
      const code = IMPORT_BUTTON_INTERNAL;
      const findings = checkFractalArchitecture(TESTING_PAGE, code);

      expect(findings).toEqual([
        {
          check: CHECK_FRACTAL,
          rule: RULE_NO_DIRECT,
          severity: SEV_ERROR,
          message:
            `External module (${TESTING_PAGE}) imports internal fragment file '../components/button/button.component'. Cross-fragment imports must consume through the public access node (index).`,
          file: TESTING_PAGE,
          line: 1,
          column: 1,
          excerpt: IMPORT_BUTTON_INTERNAL,
          why: WHY_ACCESS_NODE,
          suggestion: SUGGEST_BUTTON_ROOT,
        },
      ]);
    });
  });

  describe("ParsedSourceFile reuse", () => {
    it("accepts a pre-parsed ts.SourceFile instance", () => {
      const code = 'import { Button } from "../components/button";';
      const sourceFile = createSourceFile(HOME_PAGE, code);
      const findings = checkFractalArchitecture(HOME_PAGE, code, sourceFile);

      expect(findings).toEqual([]);
    });
  });
});
