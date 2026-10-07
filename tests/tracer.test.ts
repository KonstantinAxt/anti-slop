import { describe, expect, it } from "bun:test";
import * as ts from "typescript";
import { createSourceFile, getImportOrExportSpecifier } from "../src/checks/ast.js";
import { runAntiSlop } from "../src/index.js";

describe("anti-slop tracer bullet", () => {
  it("runs on an empty or clean set of files and returns a passing result", async () => {
    const result = await runAntiSlop({ files: [] });

    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.totalFilesChecked).toBe(0);
    expect(typeof result.durationMs).toBe("number");
  });

  it("extracts specifiers from import and export declarations as well as dynamic imports", () => {
    const source = createSourceFile(
      "test.ts",
      `
      import { a } from "./static-import";
      export { b } from "./static-export";
      const load = () => import("./dynamic-import");
      const invalidCall = someFunction("hello");
      const noArgImport = import();
    `
    );

    const extracted: string[] = [];
    function visit(node: ts.Node): void {
      const specifier = getImportOrExportSpecifier(node);
      if (specifier) extracted.push(specifier);
      ts.forEachChild(node, visit);
    }
    visit(source);

    expect(extracted).toEqual(["./static-import", "./static-export", "./dynamic-import"]);
  });
});
