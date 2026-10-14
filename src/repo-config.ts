import * as fs from "node:fs";
import * as path from "node:path";

export interface RepoConfig {
  globalRules: Record<string, unknown>;
  fileOverrides: Array<{
    files: string | string[];
    excludedFiles?: string | string[];
    rules: Record<string, unknown>;
  }>;
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}

function parseStringOrStringArray(val: unknown): string | string[] | undefined {
  if (typeof val === "string") {
    return val;
  }
  if (Array.isArray(val)) {
    const arr: string[] = [];
    for (const item of val) {
      if (typeof item === "string") {
        arr.push(item);
      }
    }

    return arr;
  }

  return undefined;
}

function parseFileOverride(ov: unknown): RepoConfig["fileOverrides"][number] | null {
  if (!isObject(ov) || !isObject(ov.rules) || !ov.files) return null;
  const files = parseStringOrStringArray(ov.files);
  if (!files) return null;
  const excluded = parseStringOrStringArray(ov.excludedFiles) ?? parseStringOrStringArray(ov.ignores);

  return {
    files,
    ...(excluded ? { excludedFiles: excluded } : {}),
    rules: ov.rules,
  };
}

function mergeRulesAndOverrides(target: RepoConfig, source: unknown): void {
  if (!isObject(source)) return;

  if (isObject(source.rules)) {
    Object.assign(target.globalRules, source.rules);
  }

  if (Array.isArray(source.overrides)) {
    for (const ov of source.overrides) {
      const parsed = parseFileOverride(ov);
      if (parsed) {
        target.fileOverrides.push(parsed);
      }
    }
  }
}

function mergeFlatConfigItem(target: RepoConfig, item: unknown): void {
  if (!isObject(item) || !isObject(item.rules)) return;

  const files = parseStringOrStringArray(item.files);
  if (!files) {
    Object.assign(target.globalRules, item.rules);

    return;
  }

  const excluded = parseStringOrStringArray(item.ignores);

  target.fileOverrides.push({
    files,
    ...(excluded ? { excludedFiles: excluded } : {}),
    rules: item.rules,
  });
}

function loadJsonConfig(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");

    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function loadJsConfig(filePath: string): Promise<unknown> {
  try {
    // Dynamic import of runtime workspace configuration outside anti-slop build graph
    const mod: unknown = await import(filePath);
    if (isObject(mod) && "default" in mod) {
      return mod.default;
    }

    return mod;
  } catch {
    return undefined;
  }
}

function loadAntiSlopJson(cwd: string, result: RepoConfig): boolean {
  for (const configFile of ["anti-slop.json", ".anti-slop.json"]) {
    const full = path.join(cwd, configFile);
    if (fs.existsSync(full)) {
      const data = loadJsonConfig(full);
      mergeRulesAndOverrides(result, data);

      return true;
    }
  }

  return false;
}

async function loadFlatConfigs(cwd: string, result: RepoConfig): Promise<boolean> {
  const flatConfigs = [
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
    "eslint.config.mts",
    "eslint.config.cts",
  ];

  for (const configFile of flatConfigs) {
    const full = path.join(cwd, configFile);
    if (fs.existsSync(full)) {
      const data = await loadJsConfig(full);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        mergeFlatConfigItem(result, item);
      }

      return true;
    }
  }

  return false;
}

async function loadLegacyConfigs(cwd: string, result: RepoConfig): Promise<boolean> {
  const legacyFiles = [
    ".eslintrc.json",
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.yaml",
    ".eslintrc.yml",
  ];

  for (const configFile of legacyFiles) {
    const full = path.join(cwd, configFile);
    if (fs.existsSync(full)) {
      const isJs = configFile.endsWith(".js") || configFile.endsWith(".cjs");
      const data = isJs ? await loadJsConfig(full) : loadJsonConfig(full);
      mergeRulesAndOverrides(result, data);

      return true;
    }
  }

  return false;
}

function loadPackageJson(cwd: string, result: RepoConfig): void {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  const pkg = loadJsonConfig(pkgPath);
  if (!isObject(pkg)) return;

  mergeRulesAndOverrides(result, pkg["anti-slop"] || pkg.antiSlop);
  mergeRulesAndOverrides(result, pkg.eslintConfig);
}

/**
 * Load workspace ESLint and anti-slop configuration files.
 *
 * @param cwd Target workspace directory.
 * @param explicitRules Optional runtime rules dictionary.
 * @returns Aggregated repository configuration with global rules and overrides.
 */
export async function loadRepoConfig(
  cwd: string,
  explicitRules?: Record<string, unknown>,
): Promise<RepoConfig> {
  const result: RepoConfig = {
    globalRules: {},
    fileOverrides: [],
  };

  loadAntiSlopJson(cwd, result);
  const foundFlat = await loadFlatConfigs(cwd, result);
  if (!foundFlat) {
    await loadLegacyConfigs(cwd, result);
  }
  loadPackageJson(cwd, result);

  if (explicitRules && typeof explicitRules === "object") {
    Object.assign(result.globalRules, explicitRules);
  }

  return result;
}
