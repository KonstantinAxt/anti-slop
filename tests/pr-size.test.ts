import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  checkPrSize,
  getDefaultIgnoredPatterns,
  hasLabelOverride,
  hasPrSizeOverride,
  isNamedLabel,
  isPathIgnored,
  normalizeRenamedPath,
  parseNumstat,
} from "../src/checks/pr-size.js";

describe("PR Size Review Gate", () => {
  it("parses git diff --numstat lines accurately and enforces exact regex endings and finding metadata", () => {
    const raw = [
      "50\t10\tsrc/index.ts",
      "20\t5\tsrc/checks/scars.ts",
      "-\t-\tassets/logo.png",
      "100\t0\tbun.lock",
      "100\t0\tbun.lockb",
      "500\t200\tpackage-lock.json",
      "100\t0\tpnpm-lock.yaml",
      "100\t0\tyarn.lock",
      "100\t0\tdist/bundle.min.js",
      "100\t0\tdist/bundle.min.css",
      "100\t0\tdist/bundle.map",
      "0\t50\treports/audit.md",
      "10\t2\te2e-fixtures/sample.ts",
      "15\t5\tsrc/__snapshots__/test.snap",
      // Files that match prefixes but MUST NOT be ignored because of non-matching endings:
      "10\t0\tsrc/bun.lock.ts",
      "10\t0\tsrc/bun.lockb.ts",
      "10\t0\tsrc/package-lock.json.bak",
      "10\t0\tsrc/pnpm-lock.yaml.tmp",
      "10\t0\tsrc/yarn.lock.old",
      "10\t0\tsrc/bundle.min.js.ts",
      "10\t0\tsrc/bundle.min.css.ts",
      "10\t0\tsrc/bundle.map.ts",
      "10\t0\tsrc/snapshots.ts",
      "10\t0\tsrc/my-e2e-fixtures.ts",
      "10\t0\tsrc/my-reports.ts",
      // Renames:
      "10\t0\tsrc/{old => new}/feature.ts",
    ].join("\n");

    const metrics = parseNumstat(raw);

    // Included: src/index.ts, src/checks/scars.ts, assets/logo.png, 11 non-ignored boundary files, and renamed feature.ts
    expect(metrics.totalFiles).toBe(15);
    expect(metrics.totalAdditions).toBe(190);
    expect(metrics.totalDeletions).toBe(15);
    // reviewLines = 60 + 25 + 0 + (11 * 10) + 10 = 205
    expect(metrics.reviewLines).toBe(205);

    // Verify checkPrSize finding metadata
    const findings = checkPrSize("/tmp", { rawNumstat: raw });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe("pr-size");
    expect(findings[0]?.rule).toBe("max-pr-size");
    expect(findings[0]?.severity).toBe("warning");
  });

  it("strictly enforces regex endings for lockfiles and compiled assets", () => {
    const raw = [
      // Should be ignored:
      "10\t0\tbun.lock",
      "10\t0\tbun.lockb",
      "10\t0\tsrc/bun.lock",
      "10\t0\tsrc/bun.lockb",
      "10\t0\tpackage-lock.json",
      "10\t0\tsrc/package-lock.json",
      "10\t0\tpnpm-lock.yaml",
      "10\t0\tsrc/pnpm-lock.yaml",
      "10\t0\tyarn.lock",
      "10\t0\tsrc/yarn.lock",
      "10\t0\tdist/bundle.min.js",
      "10\t0\tdist/bundle.min.css",
      "10\t0\tdist/bundle.map",
      "10\t0\tsrc/__snapshots__/test.snap",
      "10\t0\te2e-fixtures/spec.ts",
      "10\t0\treports/coverage.json",
      // Should NOT be ignored:
      "10\t0\tsrc/bun.lock.ts",
      "10\t0\tsrc/bun.lockb.ts",
      "10\t0\tsrc/package-lock.json.bak",
      "10\t0\tsrc/pnpm-lock.yaml.tmp",
      "10\t0\tsrc/yarn.lock.old",
      "10\t0\tsrc/bundle.min.js.ts",
      "10\t0\tsrc/bundle.min.css.ts",
      "10\t0\tsrc/bundle.map.ts",
      "10\t0\tsrc/snapshots.ts",
      "10\t0\tsrc/my-e2e-fixtures.ts",
      "10\t0\tsrc/my-reports.ts",
    ].join("\n");

    const metrics = parseNumstat(raw);
    const notIgnored = metrics.files.filter((f) => !f.ignored).map((f) => f.path);
    expect(notIgnored).toEqual([
      "src/bun.lock.ts",
      "src/bun.lockb.ts",
      "src/package-lock.json.bak",
      "src/pnpm-lock.yaml.tmp",
      "src/yarn.lock.old",
      "src/bundle.min.js.ts",
      "src/bundle.min.css.ts",
      "src/bundle.map.ts",
      "src/snapshots.ts",
      "src/my-e2e-fixtures.ts",
      "src/my-reports.ts",
    ]);
  });
  it("supports custom ignore patterns as strings and RegExps", () => {
    const raw = [
      "10\t0\tsrc/generated/schema.ts",
      "10\t0\tsrc/models.autogen.ts",
      "10\t0\tsrc/normal.ts",
    ].join("\n");

    const metrics = parseNumstat(raw, {
      ignorePatterns: ["generated/", /\.autogen\./],
    });

    expect(metrics.totalFiles).toBe(1);
    expect(metrics.files.find((f) => !f.ignored)?.path).toBe("src/normal.ts");
  });
  it("handles binary files emitting '-' without NaN corruption for either additions or deletions", () => {
    const raw = [
      "-\t-\tassets/prebuilt-binary.gz",
      "-\t5\tassets/added-binary.png",
      "5\t-\tassets/deleted-binary.png",
      "10\t5\tsrc/app.ts",
    ].join("\n");
    const metrics = parseNumstat(raw);
    const bothDash = metrics.files.find((f) => f.path.includes("prebuilt-binary"));
    expect(bothDash?.additions).toBe(0);
    expect(bothDash?.deletions).toBe(0);

    const addDash = metrics.files.find((f) => f.path.includes("added-binary"));
    expect(addDash?.binary).toBe(true);
    expect(addDash?.additions).toBe(0);
    expect(addDash?.deletions).toBe(0);

    const delDash = metrics.files.find((f) => f.path.includes("deleted-binary"));
    expect(delDash?.binary).toBe(true);
    expect(delDash?.additions).toBe(0);
    expect(delDash?.deletions).toBe(0);

    expect(isNaN(metrics.reviewLines)).toBe(false);
    expect(metrics.reviewLines).toBe(15); // 10 + min(5, 10) = 15
  });

  it("skips malformed lines with fewer than 3 parts and preserves paths containing tabs", () => {
    const raw = "\n  \n\t\nmalformed\n10\t20\n5\t2\tsrc/valid.ts\n3\t1\tpath\twith\ttab.ts\n";
    const metrics = parseNumstat(raw);
    expect(metrics.files).toHaveLength(2);
    expect(metrics.files[0]?.path).toBe("src/valid.ts");
    expect(metrics.files[1]?.path).toBe("path\twith\ttab.ts");
    expect(metrics.reviewLines).toBe(11);
  });

  it("handles git renames in arrow and brace formats and collapses redundant slashes", () => {
    const raw = `
5\t2\tsrc///{old => new}///feature.ts
10\t1\told-name.ts => new-name.ts
2\t1\twhitespace-old.ts =>   trimmed-name.ts
`;
    const metrics = parseNumstat(raw);

    expect(metrics.files[0]?.path).toBe("src/new/feature.ts");
    expect(metrics.files[1]?.path).toBe("new-name.ts");
    expect(metrics.files[2]?.path).toBe("trimmed-name.ts");
  });

  it("does not penalize pure deletions of dead code", () => {
    // 2000 lines deleted, 10 lines added
    const raw = `10\t2000\tsrc/deprecated-module.ts`;
    const metrics = parseNumstat(raw);

    // reviewLines = 10 + min(2000, 10) = 20
    expect(metrics.reviewLines).toBe(20);
    expect(metrics.totalDeletions).toBe(2000);

    const findings = checkPrSize("/tmp", { rawNumstat: raw });

    expect(findings).toHaveLength(0);
  });

  it("evaluates exact boundary conditions for reviewLines and failLines", () => {
    // Exactly 200 review lines should PASS (<= 200 does not warn)
    const raw200 = "200\t0\tsrc/boundary.ts";
    expect(checkPrSize("/tmp", { rawNumstat: raw200 })).toHaveLength(0);

    // Exactly 201 review lines should WARN (> 200 warns)
    const raw201 = "201\t0\tsrc/boundary.ts";
    const findings201 = checkPrSize("/tmp", { rawNumstat: raw201 });
    expect(findings201).toHaveLength(1);
    expect(findings201[0]?.severity).toBe("warning");
    expect(findings201[0]?.check).toBe("pr-size");
    expect(findings201[0]?.rule).toBe("max-pr-size");
    expect(findings201[0]?.file).toBe(path.join("/tmp", "package.json"));
    expect(findings201[0]?.message).toBe(
      "PR size (201 review lines across 1 files) exceeds recommended threshold of 200 lines or 10 files (+201, -0)."
    );
    expect(findings201[0]?.why).toBe("Changes over 200 lines take significantly longer to review and have higher defect escape rates (Google, Cisco).");
    expect(findings201[0]?.suggestion).toBe("Consider splitting this change into smaller pull requests if practical.");
    // Exactly 500 review lines should WARN (<= 500 does not fail)
    const raw500 = "500\t0\tsrc/boundary.ts";
    const findings500 = checkPrSize("/tmp", { rawNumstat: raw500 });
    expect(findings500).toHaveLength(1);
    expect(findings500[0]?.severity).toBe("warning");

    // Exactly 501 review lines should FAIL (> 500 fails)
    const raw501 = "501\t0\tsrc/boundary.ts";
    const findings501 = checkPrSize("/tmp", { rawNumstat: raw501 });
    expect(findings501).toHaveLength(1);
    expect(findings501[0]?.severity).toBe("error");
    expect(findings501[0]?.check).toBe("pr-size");
    expect(findings501[0]?.rule).toBe("max-pr-size");
    expect(findings501[0]?.file).toBe(path.join("/tmp", "package.json"));
    expect(findings501[0]?.message).toBe(
      "PR size (501 review lines across 1 files) exceeds hard limit of 500 lines or 25 files (+501, -0)."
    );
    expect(findings501[0]?.why).toBe("Research shows review quality degrades steeply beyond 200-400 lines of code (SmartBear/Cisco, Google Small CLs). Defects escape review when changes are oversized.");
    expect(findings501[0]?.suggestion).toBe("Split this pull request into smaller, independently reviewable changes, or add a 'size-override' label to waive the limit.");
  });

  it("evaluates exact boundary conditions for file counts", () => {
    // Exactly 10 files should PASS (<= 10 does not warn)
    const files10 = Array.from({ length: 10 }, (_, i) => `1\t0\tsrc/file${i}.ts`).join("\n");
    expect(checkPrSize("/tmp", { rawNumstat: files10 })).toHaveLength(0);

    // Exactly 11 files should WARN (> 10 warns)
    const files11 = Array.from({ length: 11 }, (_, i) => `1\t0\tsrc/file${i}.ts`).join("\n");
    const findings11 = checkPrSize("/tmp", { rawNumstat: files11 });
    expect(findings11).toHaveLength(1);
    expect(findings11[0]?.severity).toBe("warning");

    // Exactly 25 files should WARN (<= 25 does not fail)
    const files25 = Array.from({ length: 25 }, (_, i) => `1\t0\tsrc/file${i}.ts`).join("\n");
    const findings25 = checkPrSize("/tmp", { rawNumstat: files25 });
    expect(findings25).toHaveLength(1);
    expect(findings25[0]?.severity).toBe("warning");

    // Exactly 26 files should FAIL (> 25 fails)
    const files26 = Array.from({ length: 26 }, (_, i) => `1\t0\tsrc/file${i}.ts`).join("\n");
    const findings26 = checkPrSize("/tmp", { rawNumstat: files26 });
    expect(findings26).toHaveLength(1);
    expect(findings26[0]?.severity).toBe("error");
  });

  it("emits warning/error when file count exceeds thresholds", () => {
    // 12 small files (exceeds warnFiles 10, but lines < 200)
    const files = Array.from({ length: 12 }, (_, i) => `5\t0\tsrc/file${i}.ts`).join("\n");
    const warnFindings = checkPrSize("/tmp", { rawNumstat: files });

    expect(warnFindings).toHaveLength(1);
    expect(warnFindings[0]?.severity).toBe("warning");
    expect(warnFindings[0]?.message).toContain("10 files");

    // 26 small files (exceeds failFiles 25)
    const heavyFiles = Array.from({ length: 26 }, (_, i) => `5\t0\tsrc/file${i}.ts`).join("\n");
    const failFindings = checkPrSize("/tmp", { rawNumstat: heavyFiles });

    expect(failFindings).toHaveLength(1);
    expect(failFindings[0]?.severity).toBe("error");
    expect(failFindings[0]?.message).toContain("25 files");
  });

  it("respects custom options and thresholds", () => {
    const raw = `60\t0\tsrc/custom.ts`;
    const findings = checkPrSize("/tmp", {
      rawNumstat: raw,
      warnLines: 50,
      failLines: 100,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
  });

  it("downgrades error to warning when override is active with exact finding metadata", () => {
    const raw = `600\t0\tsrc/massive.ts`;
    const findings = checkPrSize("/tmp", { rawNumstat: raw, override: true });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toBe(
      "PR size (600 review lines across 1 files) exceeds hard limit of 500 lines or 25 files (+600, -0) [waived by size-override label]."
    );
    expect(findings[0]?.why).toBe("Hard limit waived by 'size-override' pull request label.");
    expect(findings[0]?.suggestion).toBe("Ensure large changes undergo extra thorough manual review.");
  });

  it("detects size-override and large-pr labels correctly and handles malformed inputs", () => {
    expect(hasLabelOverride([{ name: "size-override" }])).toBe(true);
    expect(hasLabelOverride([{ name: "large-pr" }])).toBe(true);
    expect(hasLabelOverride([{ name: "bug" }])).toBe(false);
    expect(hasLabelOverride([])).toBe(false);
    expect(hasLabelOverride(undefined)).toBe(false);
    expect(hasLabelOverride(null)).toBe(false);
    expect(hasLabelOverride("invalid")).toBe(false);
    expect(hasLabelOverride([123, null, {}])).toBe(false);
    expect(hasLabelOverride([{ name: 123 }])).toBe(false);
  });

  it("activates override from ANTI_SLOP_SIZE_OVERRIDE environment variable", () => {
    const prev = process.env.ANTI_SLOP_SIZE_OVERRIDE;
    const prevEventPath = process.env.GITHUB_EVENT_PATH;
    try {
      delete process.env.GITHUB_EVENT_PATH;
      process.env.ANTI_SLOP_SIZE_OVERRIDE = "true";
      expect(hasPrSizeOverride()).toBe(true);

      process.env.ANTI_SLOP_SIZE_OVERRIDE = "1";
      expect(hasPrSizeOverride()).toBe(true);

      process.env.ANTI_SLOP_SIZE_OVERRIDE = "false";
      expect(hasPrSizeOverride()).toBe(false);

      delete process.env.ANTI_SLOP_SIZE_OVERRIDE;
      expect(hasPrSizeOverride()).toBe(false);
    } finally {
      if (prevEventPath !== undefined) {
        process.env.GITHUB_EVENT_PATH = prevEventPath;
      } else {
        delete process.env.GITHUB_EVENT_PATH;
      }
      if (prev !== undefined) {
        process.env.ANTI_SLOP_SIZE_OVERRIDE = prev;
      } else {
        delete process.env.ANTI_SLOP_SIZE_OVERRIDE;
      }
    }
  });
  it("reads from GITHUB_EVENT_PATH environment variable when eventPath argument is omitted", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-event-env-"));
    const prev = process.env.GITHUB_EVENT_PATH;
    try {
      const validEvent = path.join(tempDir, "event.json");
      fs.writeFileSync(
        validEvent,
        JSON.stringify({ pull_request: { labels: [{ name: "size-override" }] } })
      );
      process.env.GITHUB_EVENT_PATH = validEvent;
      expect(hasPrSizeOverride()).toBe(true);

      delete process.env.GITHUB_EVENT_PATH;
      expect(hasPrSizeOverride()).toBe(false);
    } finally {
      if (prev !== undefined) process.env.GITHUB_EVENT_PATH = prev;
      else delete process.env.GITHUB_EVENT_PATH;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back through 2-dot diff and returns empty array on invalid since reference", () => {
    // An impossible ref causes 3-dot diff to throw, then 2-dot diff to throw, returning []
    const findings = checkPrSize(process.cwd(), { since: "definitely-nonexistent-ref-12345" });
    expect(findings).toEqual([]);

    // Omitted since tests the default "origin/main" fallback branch in try/catch
    const defaultFindings = checkPrSize(process.cwd());
    expect(Array.isArray(defaultFindings)).toBe(true);
  });

  it("handles primitive JSON root and primitive pull_request fields in event file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-json-primitives-"));
    try {
      const stringJson = path.join(tempDir, "string.json");
      fs.writeFileSync(stringJson, JSON.stringify("just a string"));
      expect(hasPrSizeOverride(stringJson)).toBe(false);

      const numberJson = path.join(tempDir, "number.json");
      fs.writeFileSync(numberJson, JSON.stringify(42));
      expect(hasPrSizeOverride(numberJson)).toBe(false);

      const arrayJson = path.join(tempDir, "array.json");
      fs.writeFileSync(arrayJson, JSON.stringify([1, 2, 3]));
      expect(hasPrSizeOverride(arrayJson)).toBe(false);

      const primPrJson = path.join(tempDir, "prim-pr.json");
      fs.writeFileSync(primPrJson, JSON.stringify({ pull_request: "not an object" }));
      expect(hasPrSizeOverride(primPrJson)).toBe(false);

      const numPrJson = path.join(tempDir, "num-pr.json");
      fs.writeFileSync(numPrJson, JSON.stringify({ pull_request: 99 }));
      expect(hasPrSizeOverride(numPrJson)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("executes real git diff against git repository when rawNumstat is omitted", () => {
    // Run against current repo with since="HEAD" (diff should be empty or small)
    const findings = checkPrSize(process.cwd(), { since: "HEAD" });
    expect(Array.isArray(findings)).toBe(true);
  });

  it("handles non-git directory gracefully when rawNumstat is omitted", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "no-git-"));
    try {
      const findings = checkPrSize(tempDir);
      expect(findings).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("evaluates hasPrSizeOverride across event files and missing paths", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "override-test-"));
    try {
      const validEvent = path.join(tempDir, "valid-event.json");
      fs.writeFileSync(
        validEvent,
        JSON.stringify({ pull_request: { labels: [{ name: "size-override" }] } })
      );
      expect(hasPrSizeOverride(validEvent)).toBe(true);

      const largePrEvent = path.join(tempDir, "large-pr-event.json");
      fs.writeFileSync(
        largePrEvent,
        JSON.stringify({ pull_request: { labels: [{ name: "large-pr" }] } })
      );
      expect(hasPrSizeOverride(largePrEvent)).toBe(true);

      const noOverrideEvent = path.join(tempDir, "no-override.json");
      fs.writeFileSync(
        noOverrideEvent,
        JSON.stringify({ pull_request: { labels: [{ name: "bug" }] } })
      );
      expect(hasPrSizeOverride(noOverrideEvent)).toBe(false);

      const emptyEvent = path.join(tempDir, "empty.json");
      fs.writeFileSync(emptyEvent, JSON.stringify({}));
      expect(hasPrSizeOverride(emptyEvent)).toBe(false);

      const nullPrEvent = path.join(tempDir, "null-pr.json");
      fs.writeFileSync(nullPrEvent, JSON.stringify({ pull_request: null }));
      expect(hasPrSizeOverride(nullPrEvent)).toBe(false);

      const primitiveEvent = path.join(tempDir, "primitive.json");
      fs.writeFileSync(primitiveEvent, JSON.stringify(42));
      expect(hasPrSizeOverride(primitiveEvent)).toBe(false);

      const stringEvent = path.join(tempDir, "string.json");
      fs.writeFileSync(stringEvent, JSON.stringify("hello"));
      expect(hasPrSizeOverride(stringEvent)).toBe(false);

      const noPrKey = path.join(tempDir, "no-pr.json");
      fs.writeFileSync(noPrKey, JSON.stringify({ other: true }));
      expect(hasPrSizeOverride(noPrKey)).toBe(false);

      const stringPrEvent = path.join(tempDir, "string-pr.json");
      fs.writeFileSync(stringPrEvent, JSON.stringify({ pull_request: "not an object" }));
      expect(hasPrSizeOverride(stringPrEvent)).toBe(false);

      const noLabelsEvent = path.join(tempDir, "no-labels.json");
      fs.writeFileSync(noLabelsEvent, JSON.stringify({ pull_request: {} }));
      expect(hasPrSizeOverride(noLabelsEvent)).toBe(false);

      const nullLabelsEvent = path.join(tempDir, "null-labels.json");
      fs.writeFileSync(nullLabelsEvent, JSON.stringify({ pull_request: { labels: null } }));
      expect(hasPrSizeOverride(nullLabelsEvent)).toBe(false);

      const invalidEvent = path.join(tempDir, "invalid-event.json");
      fs.writeFileSync(invalidEvent, "{ not json");
      expect(hasPrSizeOverride(invalidEvent)).toBe(false);

      const missingEvent = path.join(tempDir, "missing.json");
      expect(hasPrSizeOverride(missingEvent)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("tests normalizeRenamedPath with various git diff rename formats", () => {
    expect(normalizeRenamedPath("src/{old => new}/file.ts")).toBe("src/new/file.ts");
    expect(normalizeRenamedPath("{old => new}/file.ts")).toBe("new/file.ts");
    expect(normalizeRenamedPath("src/{old => new}")).toBe("src/new");
    expect(normalizeRenamedPath("src/{ => new}/file.ts")).toBe("src/new/file.ts");
    expect(normalizeRenamedPath("src/{old => }/file.ts")).toBe("src/file.ts");
    expect(normalizeRenamedPath("old.ts => new.ts")).toBe("new.ts");
    expect(normalizeRenamedPath("old.ts => new.ts ")).toBe("new.ts");
    expect(normalizeRenamedPath("plain/path.ts")).toBe("plain/path.ts");
    expect(normalizeRenamedPath("old=>new")).toBe("old=>new");
  });

  it("tests isNamedLabel helper directly", () => {
    expect(isNamedLabel(null)).toBe(false);
    expect(isNamedLabel(undefined)).toBe(false);
    expect(isNamedLabel(42)).toBe(false);
    expect(isNamedLabel("label")).toBe(false);
    expect(isNamedLabel({})).toBe(false);
    expect(isNamedLabel({ name: 123 })).toBe(false);
    expect(isNamedLabel({ name: "size-override" })).toBe(true);
    expect(isNamedLabel({ name: "large-pr" })).toBe(true);
  });
  it("tests isPathIgnored against all default patterns and their boundaries", () => {
    const defaultPatterns = getDefaultIgnoredPatterns();
    expect(defaultPatterns.length).toBeGreaterThan(0);
    // bun.lock / bun.lockb
    expect(isPathIgnored("bun.lock")).toBe(true);
    expect(isPathIgnored("sub/bun.lock")).toBe(true);
    expect(isPathIgnored("bun.lockb")).toBe(true);
    expect(isPathIgnored("sub/bun.lockb")).toBe(true);
    expect(isPathIgnored("bun.lock.ts")).toBe(false);
    expect(isPathIgnored("bun.lockb.ts")).toBe(false);

    // package-lock.json
    expect(isPathIgnored("package-lock.json")).toBe(true);
    expect(isPathIgnored("pkg/package-lock.json")).toBe(true);
    expect(isPathIgnored("package-lock.json.bak")).toBe(false);

    // pnpm-lock.yaml
    expect(isPathIgnored("pnpm-lock.yaml")).toBe(true);
    expect(isPathIgnored("dir/pnpm-lock.yaml")).toBe(true);
    expect(isPathIgnored("pnpm-lock.yaml.txt")).toBe(false);

    // yarn.lock
    expect(isPathIgnored("yarn.lock")).toBe(true);
    expect(isPathIgnored("deep/yarn.lock")).toBe(true);
    expect(isPathIgnored("yarn.lock.backup")).toBe(false);

    // min.js / min.css / map
    expect(isPathIgnored("dist/app.min.js")).toBe(true);
    expect(isPathIgnored("dist/style.min.css")).toBe(true);
    expect(isPathIgnored("dist/app.min.ts")).toBe(false);
    expect(isPathIgnored("dist/app.js.map")).toBe(true);
    expect(isPathIgnored("dist/map.ts")).toBe(false);

    // __snapshots__
    expect(isPathIgnored("__snapshots__")).toBe(true);
    expect(isPathIgnored("tests/__snapshots__/file.snap")).toBe(true);
    expect(isPathIgnored("tests/__snapshots__")).toBe(true);
    expect(isPathIgnored("tests/__snapshots_extra__/file.snap")).toBe(false);

    // e2e-fixtures
    expect(isPathIgnored("e2e-fixtures")).toBe(true);
    expect(isPathIgnored("e2e-fixtures/sample.ts")).toBe(true);
    expect(isPathIgnored("sub/e2e-fixtures/sample.ts")).toBe(true);
    expect(isPathIgnored("e2e-fixtures-extra/file.ts")).toBe(false);

    // reports
    expect(isPathIgnored("reports")).toBe(true);
    expect(isPathIgnored("reports/mutation.json")).toBe(true);
    expect(isPathIgnored("deep/reports/mutation.json")).toBe(true);
    expect(isPathIgnored("reports-archive/mutation.json")).toBe(false);
  });

  it("invokes git diff when rawNumstat is not supplied and handles git failures gracefully", () => {
    const tempNonGit = fs.mkdtempSync(path.join(os.tmpdir(), "non-git-"));
    try {
      // In a non-git directory, execSync will fail and checkPrSize returns []
      const findings = checkPrSize(tempNonGit);
      expect(findings).toEqual([]);
    } finally {
      fs.rmSync(tempNonGit, { recursive: true, force: true });
    }

    // In current repo directory with since "HEAD"
    const repoFindings = checkPrSize(process.cwd(), { since: "HEAD" });
    expect(Array.isArray(repoFindings)).toBe(true);
  });
});
