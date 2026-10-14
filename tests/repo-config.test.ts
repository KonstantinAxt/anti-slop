import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadRepoConfig } from "../src/repo-config.js";

async function loadFrom(files: Record<string, unknown>, explicitRules?: Record<string, unknown>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-config-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
    }

    return await loadRepoConfig(dir, explicitRules);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}

describe("loadRepoConfig", () => {
  it("returns an empty config when the workspace has no config files", async () => {
    expect(await loadFrom({})).toEqual({ globalRules: {}, fileOverrides: [] });
  });

  it("reads anti-slop.json overrides, keeping string patterns and mapping ignores to excludedFiles", async () => {
    const loaded = await loadFrom({
      "anti-slop.json": {
        rules: { a: "off" },
        overrides: [
          { files: "src/**", ignores: ["**/*.test.ts", 3], rules: { b: "warn" } },
          { files: ["lib/**"], excludedFiles: "lib/gen/**", ignores: "ignored", rules: { c: "error" } },
          { files: ["x/**"], rules: { d: "off" } },
          { files: 7, rules: { e: "off" } },
          { rules: { f: "off" } },
          { files: "y/**" },
          "not-an-object",
        ],
      },
    });

    expect(loaded).toEqual({
      globalRules: { a: "off" },
      fileOverrides: [
        { files: "src/**", excludedFiles: ["**/*.test.ts"], rules: { b: "warn" } },
        { files: ["lib/**"], excludedFiles: "lib/gen/**", rules: { c: "error" } },
        { files: ["x/**"], rules: { d: "off" } },
      ],
    });
  });

  it("prefers anti-slop.json over .anti-slop.json", async () => {
    const loaded = await loadFrom({
      "anti-slop.json": { rules: { a: "off" } },
      ".anti-slop.json": { rules: { b: "off" } },
    });

    expect(loaded.globalRules).toEqual({ a: "off" });
  });

  it("reads .anti-slop.json when anti-slop.json is absent", async () => {
    expect((await loadFrom({ ".anti-slop.json": { rules: { b: "off" } } })).globalRules).toEqual({ b: "off" });
  });

  it("ignores a config file that is not valid JSON", async () => {
    expect(await loadFrom({ "anti-slop.json": "{ nope" })).toEqual({ globalRules: {}, fileOverrides: [] });
  });

  it("uses the first flat config found and skips legacy configs", async () => {
    const loaded = await loadFrom({
      "eslint.config.mjs": `export default { rules: { flat: "off" } };`,
      "eslint.config.cjs": `module.exports = [{ rules: { second: "off" } }];`,
      ".eslintrc.json": { rules: { legacy: "off" } },
    });

    expect(loaded.globalRules).toEqual({ flat: "off" });
  });

  it("reads flat config items without a default export and drops items without rules", async () => {
    const loaded = await loadFrom({
      "eslint.config.cjs": `module.exports = [null, { files: ["a/**"] }, { files: "b/**", ignores: "b/x/**", rules: { b: "warn" } }, { files: ["c/**"], rules: { c: "off" } }];`,
    });

    expect(loaded.fileOverrides).toEqual([
      { files: "b/**", excludedFiles: "b/x/**", rules: { b: "warn" } },
      { files: ["c/**"], rules: { c: "off" } },
    ]);
  });

  it("ignores a flat config that fails to import", async () => {
    expect(await loadFrom({ "eslint.config.mjs": `throw new Error("boom");` })).toEqual({ globalRules: {}, fileOverrides: [] });
  });

  it.each([
    [".eslintrc.json", JSON.stringify({ rules: { r: "off" } })],
    [".eslintrc", JSON.stringify({ rules: { r: "off" } })],
    [".eslintrc.js", `module.exports = { rules: { r: "off" } };`],
    [".eslintrc.cjs", `module.exports = { rules: { r: "off" } };`],
  ])("reads legacy config %s when no flat config exists", async (name, content) => {
    expect((await loadFrom({ [name]: content })).globalRules).toEqual({ r: "off" });
  });

  it("uses only the first legacy config found", async () => {
    const loaded = await loadFrom({
      ".eslintrc.json": { rules: { first: "off" } },
      ".eslintrc": { rules: { second: "off" } },
    });

    expect(loaded.globalRules).toEqual({ first: "off" });
  });

  it("layers sources: anti-slop.json, then ESLint config, then package.json, then explicit rules", async () => {
    const loaded = await loadFrom(
      {
        "anti-slop.json": { rules: { r: "a", onlyJson: 1 } },
        ".eslintrc.json": { rules: { r: "b", onlyLegacy: 1 } },
        "package.json": { antiSlop: { rules: { r: "c" } }, eslintConfig: { rules: { r: "d", onlyPkg: 1 } } },
      },
      { r: "e" },
    );

    expect(loaded.globalRules).toEqual({ r: "e", onlyJson: 1, onlyLegacy: 1, onlyPkg: 1 });
  });

  it("prefers the anti-slop key over antiSlop in package.json", async () => {
    const loaded = await loadFrom({
      "package.json": { "anti-slop": { rules: { a: "off" } }, antiSlop: { rules: { b: "off" } } },
    });

    expect(loaded.globalRules).toEqual({ a: "off" });
  });

  it("ignores a package.json that is not an object", async () => {
    expect(await loadFrom({ "package.json": "1" })).toEqual({ globalRules: {}, fileOverrides: [] });
    expect(await loadFrom({ "package.json": "null" })).toEqual({ globalRules: {}, fileOverrides: [] });
  });

  it("ignores a rules value that is not an object", async () => {
    expect((await loadFrom({ "anti-slop.json": { rules: "ab" } })).globalRules).toEqual({});
  });

  it.each([".eslintrc.yaml", ".eslintrc.yml"])("reads JSON content from legacy config %s", async (name) => {
    expect((await loadFrom({ [name]: { rules: { r: "off" } } })).globalRules).toEqual({ r: "off" });
  });

  it("reads named exports from a flat config without a default export", async () => {
    expect((await loadFrom({ "eslint.config.mjs": `export const rules = { named: "off" };` })).globalRules).toEqual({ named: "off" });
  });
});
