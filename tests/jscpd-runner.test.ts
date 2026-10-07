import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Finding } from "../src/types.js";
import { buildJscpdCommand, checkDuplicationWithJscpd } from "../src/checks/jscpd-runner.js";

const FILE_A_NAME = "fileA.ts";
const FILE_B_NAME = "fileB.ts";
const CHECK_NAME = "jscpd";
const RULE_NAME = "duplicate-code";
const SEVERITY_WARNING = "warning";
const REPORT_FILE_NAME = "jscpd-report.json";

const SHARED_DUPLICATE_CODE = `
function calculateComplexMetrics(items: number[]) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item > 100) {
      total += item * 1.5;
    } else {
      total += item * 0.9;
    }
  }
  return total;
}
`;

function createDuplicateFixture(
  prefix: string,
  content: string
): { tempDir: string; fileA: string; fileB: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const fileA = path.join(tempDir, FILE_A_NAME);
  const fileB = path.join(tempDir, FILE_B_NAME);
  fs.writeFileSync(fileA, content);
  fs.writeFileSync(fileB, content);

  return { tempDir, fileA, fileB };
}

function mockReportAndCheck(
  reportData: unknown,
  fixturePrefix: string
): Finding[] {
  const { tempDir, fileA, fileB } = createDuplicateFixture(
    fixturePrefix,
    "export const a = 1;\n"
  );
  const realRead = fs.readFileSync;
  const realExists = fs.existsSync;
  fs.existsSync = ((p: fs.PathLike) => {
    if (typeof p === "string" && p.endsWith(REPORT_FILE_NAME)) return true;
    return realExists(p);
  }) as never;
  fs.readFileSync = ((
    targetPath: unknown,
    ...args: unknown[]
  ) => {
    if (typeof targetPath === "string" && targetPath.endsWith(REPORT_FILE_NAME)) {
      return JSON.stringify(reportData);
    }

    return realRead(targetPath as fs.PathOrFileDescriptor, ...(args as [never]));
  }) as never;

  try {
    return checkDuplicationWithJscpd([fileA, fileB], tempDir);
  } finally {
    fs.readFileSync = realRead;
    fs.existsSync = realExists;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("jscpd Duplication Detector Runner (Move #9)", () => {
  it("returns empty findings immediately if pathsToCheck is empty without creating tempDir", () => {
    const mkdtempSpy = vi.spyOn(fs, "mkdtempSync");
    try {
      const findings = checkDuplicationWithJscpd([]);
      expect(findings).toEqual([]);
      expect(mkdtempSpy).not.toHaveBeenCalled();
    } finally {
      mkdtempSpy.mockRestore();
    }
  });

  it("cleans up temporary directory with recursive and force options", () => {
    const rmSpy = vi.spyOn(fs, "rmSync");
    const { tempDir, fileA, fileB } = createDuplicateFixture(
      "jscpd-cleanup-test-",
      SHARED_DUPLICATE_CODE
    );
    try {
      checkDuplicationWithJscpd([fileA, fileB], tempDir);
      expect(rmSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true, force: true })
      );
    } finally {
      rmSpy.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  it("returns empty findings if all paths are non-existent", () => {
    const findings = checkDuplicationWithJscpd([
      "nonexistent/path/fileA.ts",
      "nonexistent/path/fileB.ts",
    ]);

    expect(findings).toEqual([]);
  });

  it("filters out non-existent paths and detects duplicates across remaining valid paths", () => {
    const { tempDir, fileA, fileB } = createDuplicateFixture(
      "jscpd-test-mixed-",
      SHARED_DUPLICATE_CODE
    );
    try {
      const findings = checkDuplicationWithJscpd(
        [fileA, path.join(tempDir, "nonexistent.ts"), fileB],
        tempDir
      );

      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0]?.rule).toBe("duplicate-code");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns empty findings when files contain distinct, non-duplicate code", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jscpd-test-distinct-"));
    try {
      const fileA = path.join(tempDir, "fileA.ts");
      const fileB = path.join(tempDir, "fileB.ts");
      fs.writeFileSync(fileA, "export const alpha = 42;\nexport function getAlpha() { return alpha * 2; }\n");
      fs.writeFileSync(fileB, "export const beta = 'unique';\nexport function getBeta() { return beta.toLowerCase(); }\n");

      const findings = checkDuplicationWithJscpd([fileA, fileB], tempDir);

      expect(findings).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects copy-pasted blocks and constructs the exact finding structure", () => {
    const { tempDir, fileA, fileB } = createDuplicateFixture(
      "jscpd-test-finding-",
      SHARED_DUPLICATE_CODE
    );
    try {
      const findings = checkDuplicationWithJscpd([fileA, fileB], tempDir, {
        minTokens: 20,
        minLines: 5,
      });
      const finding = findings[0];

      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(finding?.check).toBe("jscpd");
      expect(finding?.rule).toBe("duplicate-code");
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toBe("Duplicated block (12 lines, 68 tokens) duplicated in fileB.ts:2.");
      expect(finding?.file).toBe("fileA.ts");
      expect(finding?.line).toBe(2);
      expect(finding?.column).toBe(1);
      expect(typeof finding?.excerpt).toBe("string");
      expect(finding?.why).toBe(
        "Duplication risk: Repeated business logic creates maintenance divergence when parallel copies drift."
      );
      expect(finding?.suggestion).toBe(
        "Extract the duplicate logic into a shared helper or service."
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("respects default options (minTokens: 50, minLines: 5) when options parameter is omitted", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jscpd-test-defaults-"));
    try {
      // 1. Block with ~26 tokens (< 50 default minTokens) across 5 lines:
      const subTokensBlock = `
function shortHelper(x: number) {
  const a = x + 1;
  const b = a * 2;
  return b;
}
`;
      const fileA = path.join(tempDir, "subTokensA.ts");
      const fileB = path.join(tempDir, "subTokensB.ts");
      fs.writeFileSync(fileA, subTokensBlock);
      fs.writeFileSync(fileB, subTokensBlock);

      // Default options should ignore it (< 50 tokens)
      const defaultTokenFindings = checkDuplicationWithJscpd([fileA, fileB], tempDir);

      expect(defaultTokenFindings).toEqual([]);

      // Explicit low minTokens should detect it
      const customTokenFindings = checkDuplicationWithJscpd([fileA, fileB], tempDir, {
        minTokens: 10,
        minLines: 3,
      });

      expect(customTokenFindings.length).toBeGreaterThanOrEqual(1);

      // 2. Block with high tokens (144 tokens) but only 3 lines (< 5 default minLines):
      const subLinesBlock = `
const a = { x: 1, y: 2, z: 3, w: 4, a1: "test", b1: "hello", c1: "world", d1: 123, e1: 456, f1: 789, g1: 999 };
const b = [a.x + a.y, a.z + a.w, a.a1 + a.b1, a.c1 + a.d1, a.e1 + a.f1, a.g1 * 2, 1, 2, 3, 4, 5, 6, 7];
export const result = b.reduce((acc, v) => (typeof v === "number" ? acc + v : acc), 0);
`;
      const fileC = path.join(tempDir, "subLinesA.ts");
      const fileD = path.join(tempDir, "subLinesB.ts");
      fs.writeFileSync(fileC, subLinesBlock);
      fs.writeFileSync(fileD, subLinesBlock);

      // Default options should ignore it (< 5 lines)
      const defaultLineFindings = checkDuplicationWithJscpd([fileC, fileD], tempDir);

      expect(defaultLineFindings).toEqual([]);

      // Explicit low minLines should detect it
      const customLineFindings = checkDuplicationWithJscpd([fileC, fileD], tempDir, {
        minTokens: 20,
        minLines: 2,
      });

      expect(customLineFindings.length).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("truncates excerpt to at most EXCERPT_LINE_LIMIT (5 lines)", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jscpd-test-truncation-"));
    try {
      const multiLineBlock = `
function longDuplicateBlock() {
  const line1 = "first line";
  const line2 = "second line";
  const line3 = "third line";
  const line4 = "fourth line";
  const line5 = "fifth line";
  const line6 = "sixth line that should be truncated";
  const line7 = "seventh line";
  return [line1, line2, line3, line4, line5, line6, line7].join(" ");
}
`;
      const fileA = path.join(tempDir, "multiLineA.ts");
      const fileB = path.join(tempDir, "multiLineB.ts");
      fs.writeFileSync(fileA, multiLineBlock);
      fs.writeFileSync(fileB, multiLineBlock);

      const findings = checkDuplicationWithJscpd([fileA, fileB], tempDir, {
        minTokens: 20,
        minLines: 5,
      });
      const excerpt = findings[0]?.excerpt;
      const excerptLines = excerpt?.split("\n") ?? [];

      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(typeof excerpt).toBe("string");
      expect(excerptLines.length).toBe(5);
      expect(excerpt).not.toContain("seventh line");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("surfaces execution failures explicitly instead of returning empty findings", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jscpd-test-error-"));
    try {
      const fileA = path.join(tempDir, "fileA.ts");
      fs.writeFileSync(fileA, "export const x = 1;\n");

      // An invalid working directory triggers execSync error inside checkDuplicationWithJscpd
      expect(() =>
        checkDuplicationWithJscpd([fileA], "/invalid/path/does/not/exist/anti-slop-cwd")
      ).toThrow(/jscpd failed/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("filters non-existent paths until none remain and avoids scanning cwd", () => {
    const { tempDir } = createDuplicateFixture(
      "jscpd-test-cwd-leak-",
      SHARED_DUPLICATE_CODE
    );
    try {
      const findings = checkDuplicationWithJscpd(
        [path.join(tempDir, "nonexistent1.ts"), path.join(tempDir, "nonexistent2.ts")],
        tempDir,
        { minTokens: 20, minLines: 5 }
      );

      expect(findings).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects intra-file duplicate blocks and non-default column coordinates when one valid path remains", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jscpd-single-file-"));
    const singleFile = path.join(tempDir, "singleFile.ts");
    const duplicateInSingleFile = `
function blockAlpha(items: number[]) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item > 100) {
      total += item * 1.5;
    } else {
      total += item * 0.9;
    }
  }
  return total;
}

function blockBeta(items: number[]) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item > 100) {
      total += item * 1.5;
    } else {
      total += item * 0.9;
    }
  }
  return total;
}
`;
    fs.writeFileSync(singleFile, duplicateInSingleFile);
    try {
      const findings = checkDuplicationWithJscpd(
        [singleFile, path.join(tempDir, "nonexistent.ts")],
        tempDir,
        { minTokens: 20, minLines: 5 }
      );
      const finding = findings[0];

      expect(findings.length).toBeGreaterThanOrEqual(1);

      expect(finding?.check).toBe(CHECK_NAME);

      expect(finding?.rule).toBe(RULE_NAME);

      expect(finding?.severity).toBe(SEVERITY_WARNING);

      expect(finding?.file).toBe("singleFile.ts");

      expect(finding?.line).toBe(2);

      expect(finding?.column).toBe(19);

      expect(finding?.message).toBe("Duplicated block (12 lines, 66 tokens) duplicated in singleFile.ts:15.");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("prioritizes startLoc line and column coordinates over start offset", () => {
    const findings = mockReportAndCheck(
      {
        duplicates: [
          {
            lines: 10,
            tokens: 45,
            firstFile: {
              name: "sourceA.ts",
              start: 5,
              startLoc: { line: 25, column: 7, position: 200 },
            },
            secondFile: {
              name: "sourceB.ts",
              start: 8,
              startLoc: { line: 60, column: 12, position: 500 },
            },
            fragment: "code_line_1\ncode_line_2\ncode_line_3",
          },
        ],
      },
      "jscpd-test-startloc-"
    );
    const finding = findings[0];

    expect(findings.length).toBe(1);
    expect(finding?.line).toBe(25);
    expect(finding?.column).toBe(7);
    expect(finding?.file).toBe("sourceA.ts");
    expect(finding?.message).toBe("Duplicated block (10 lines, 45 tokens) duplicated in sourceB.ts:60.");
    expect(finding?.excerpt).toBe("code_line_1\ncode_line_2\ncode_line_3");
  });

  it("falls back to start offset and default column 1 when startLoc is omitted", () => {
    const findings = mockReportAndCheck(
      {
        duplicates: [
          {
            lines: 8,
            tokens: 30,
            firstFile: {
              name: "fallbackA.ts",
              start: 42,
            },
            secondFile: {
              name: "fallbackB.ts",
              start: 88,
            },
          },
        ],
      },
      "jscpd-test-fallback-"
    );
    const finding = findings[0];

    expect(findings.length).toBe(1);
    expect(finding?.line).toBe(42);
    expect(finding?.column).toBe(1);
    expect(finding?.file).toBe("fallbackA.ts");
    expect(finding?.message).toBe("Duplicated block (8 lines, 30 tokens) duplicated in fallbackB.ts:88.");
    expect(finding?.excerpt).toBeUndefined();
  });

  it("falls back to line 1 and column 1 when both startLoc and start are absent", () => {
    const findings = mockReportAndCheck(
      {
        duplicates: [
          {
            lines: 6,
            tokens: 22,
            firstFile: {
              name: "emptyA.ts",
            },
            secondFile: {
              name: "emptyB.ts",
            },
          },
        ],
      },
      "jscpd-test-absent-"
    );
    const finding = findings[0];

    expect(findings.length).toBe(1);
    expect(finding?.line).toBe(1);
    expect(finding?.column).toBe(1);
    expect(finding?.file).toBe("emptyA.ts");
    expect(finding?.message).toBe("Duplicated block (6 lines, 22 tokens) duplicated in emptyB.ts:undefined.");
  });

  it("returns empty findings when report data has no duplicates array", () => {
    const findings = mockReportAndCheck({}, "jscpd-test-no-dups-");

    expect(findings).toEqual([]);
  });

  it("quotes paths with spaces properly when invoking jscpd", () => {
    const { tempDir, fileA, fileB } = createDuplicateFixture(
      "jscpd test space-",
      SHARED_DUPLICATE_CODE
    );
    try {
      const findings = checkDuplicationWithJscpd([fileA, fileB], tempDir, {
        minTokens: 20,
        minLines: 5,
      });

      expect(findings.length).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("properly forms command with quoted paths, silent flag, and options", () => {
    const cmd = buildJscpdCommand(["/path/a.ts", "/path with spaces/b.ts"], "/tmp/out", 30, 7);
    expect(cmd).toContain('"/path/a.ts"');
    expect(cmd).toContain('"/path with spaces/b.ts"');
    expect(cmd).toContain("--silent");
    expect(cmd).toContain("--min-tokens 30");
    expect(cmd).toContain("--min-lines 7");
    expect(cmd).toContain('--output "/tmp/out"');
    expect(cmd).toContain("--reporters json");
  });
});
