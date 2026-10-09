import * as fs from "node:fs";
import * as path from "node:path";
import picomatch from "picomatch";
import type { Finding } from "./types.js";

export interface RepoConfig {
  globalRules: Record<string, unknown>;
  fileOverrides: Array<{
    files: string | string[];
    excludedFiles?: string | string[];
    rules: Record<string, unknown>;
  }>;
}

export interface RuleOverride {
  severity: "off" | "warning" | "error";
  options?: unknown[];
}
const ESLINT_NUMERIC_ERROR = 2;
const DEFAULT_OFF_RULES: Record<string, true> = {
  "slop/no-unknown-parameters": true,
  "slop/no-unknown-returns": true,
};



const RULE_ALIASES: Record<string, string[]> = {
  // TypeScript checks
  "no-explicit-any": [
    "@typescript-eslint/no-explicit-any",
    "no-explicit-any",
    "strict-ts/no-explicit-any",
  ],
  "no-non-null-assertion": [
    "@typescript-eslint/no-non-null-assertion",
    "no-non-null-assertion",
    "strict-ts/no-non-null-assertion",
  ],
  "no-unused-locals": [
    "@typescript-eslint/no-unused-vars",
    "no-unused-vars",
    "no-unused-locals",
    "strict-ts/no-unused-locals",
  ],
  "strict-mode": ["strict-mode", "strict-ts/strict-mode"],
  "no-unchecked-indexed-access": [
    "no-unchecked-indexed-access",
    "strict-ts/no-unchecked-indexed-access",
  ],
  "no-implicit-any": [
    "no-implicit-any",
    "strict-ts/no-implicit-any",
  ],
  "strict-null-checks": [
    "strict-null-checks",
    "strict-ts/strict-null-checks",
  ],
  "strict-property-initialization": [
    "strict-property-initialization",
    "strict-ts/strict-property-initialization",
  ],
  "no-implicit-this": [
    "no-implicit-this",
    "strict-ts/no-implicit-this",
  ],
  "exact-optional-property-types": [
    "exact-optional-property-types",
    "strict-ts/exact-optional-property-types",
  ],
  "@typescript-eslint/no-magic-numbers": [
    "@typescript-eslint/no-magic-numbers",
    "no-magic-numbers",
  ],
  // Boundaries checks
  "boundaries/layer-boundary-violation": [
    "boundaries/element-types",
    "boundaries/no-unknown",
    "boundaries/layer-boundary-violation",
  ],
  "boundaries/util-boundary-violation": [
    "boundaries/element-types",
    "boundaries/util-boundary-violation",
  ],
  "boundaries/mock-leakage": ["boundaries/mock-leakage"],

  // Fractal Architecture checks
  "fractal/no-direct-fragment-import": [
    "faf/no-direct-fragment-import",
    "fractal/no-direct-fragment-import",
  ],
  "fractal/no-private-leak": [
    "faf/no-private-category-leak",
    "faf/no-fractal-branch-leak",
    "fractal/no-private-leak",
  ],
  "fractal/no-upward-dependency": [
    "faf/root-node-dependency-direction",
    "fractal/no-upward-dependency",
  ],
  "fractal/peer-isolation": [
    "faf/no-peer-dependency",
    "fractal/peer-isolation",
  ],

  // Scars checks
  "scars/no-service-rounding": ["scars/no-service-rounding"],

  // Hollow tests checks
  "hollow-tests/hollow-call-assertion": [
    "vitest/expect-expect",
    "hollow-tests/hollow-call-assertion",
  ],
  "hollow-tests/hollow-expect-true": ["hollow-tests/hollow-expect-true"],
  "hollow-tests/expect-without-assertion": [
    "vitest/valid-expect",
    "hollow-tests/expect-without-assertion",
  ],
  "hollow-tests/no-assertion-in-test": [
    "vitest/expect-expect",
    "hollow-tests/no-assertion-in-test",
  ],
  "hollow-tests/no-logic-in-test": [
    "vitest/no-conditional-in-test",
    "vitest/no-conditional-expect",
    "hollow-tests/no-conditional-assertion",
    "hollow-tests/no-logic-in-test",
    "no-logic-in-test",
    "no-conditional-assertion",
  ],
  "hollow-tests/no-loop-in-test": [
    "hollow-tests/no-loop-in-test",
    "no-loop-in-test",
  ],
  "hollow-tests/no-conditional-assertion": [
    "vitest/no-conditional-in-test",
    "vitest/no-conditional-expect",
    "hollow-tests/no-conditional-assertion",
    "hollow-tests/no-logic-in-test",
    "no-logic-in-test",
    "no-conditional-assertion",
  ],
  "hollow-tests/no-assertion-calculation": [
    "hollow-tests/no-assertion-calculation",
    "no-assertion-calculation",
  ],

  "hollow-tests/test-title-contract-mismatch": [
    "hollow-tests/test-title-contract-mismatch",
    "test-title-contract-mismatch",
  ],
  "hollow-tests/no-redundant-guard-assertion": [
    "hollow-tests/no-redundant-guard-assertion",
    "no-redundant-guard-assertion",
  ],
  "hollow-tests/duplicate-test-body": [
    "hollow-tests/duplicate-test-body",
    "duplicate-test-body",
    "no-duplicate-test-body",
  ],
  "code-smell/no-leaky-conditional-spread": [
    "code-smell/no-leaky-conditional-spread",
    "no-leaky-conditional-spread",
  ],
  "test-hygiene/no-magic-float-assertions": [
    "test-hygiene/no-magic-float-assertions",
    "no-magic-float-assertions",
  ],
  "test-hygiene/no-raw-timer-literals": [
    "test-hygiene/no-raw-timer-literals",
    "no-raw-timer-literals",
  ],
  "test-hygiene/no-raw-coordinate-literals": [
    "test-hygiene/no-raw-coordinate-literals",
    "no-raw-coordinate-literals",
    "no-magic-coordinate-literals",
  ],
  "slop/no-env-shell-command": [
    "slop/no-env-shell-command",
    "no-env-shell-command",
  ],
  "slop/no-redundant-presence-check": [
    "slop/no-redundant-presence-check",
    "no-redundant-presence-check",
  ],
  "slop/no-unknown-parameters": [
    "slop/no-unknown-parameters",
    "no-unknown-parameters",
  ],
  "slop/no-unknown-returns": [
    "slop/no-unknown-returns",
    "no-unknown-returns",
  ],

  // Stale mocks
  "stale-mocks/stale-mock-export": ["stale-mocks/stale-mock-export"],

  // Dead code
  "dead-code/unused-file": ["dead-code/unused-file"],
  "dead-code/dead-export": ["dead-code/dead-export"],

  // Code duplication
  "jscpd/code-duplication": ["jscpd/code-duplication"],

  // Array callback return
  "array-callback-return": ["array-callback-return"],
};

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}

function parseSeverity(
  setting: unknown,
): { severity: "off" | "warning" | "error"; options?: unknown[] } | null {
  const severityVal = Array.isArray(setting) ? setting[0] : setting;
  const options = Array.isArray(setting) && setting.length > 1 ? setting.slice(1) : undefined;

  let severity: "off" | "warning" | "error" | undefined;
  if (severityVal === "off" || severityVal === 0 || severityVal === false) {
    severity = "off";
  } else if (severityVal === "warn" || severityVal === 1) {
    severity = "warning";
  } else if (severityVal === "error" || severityVal === ESLINT_NUMERIC_ERROR || severityVal === true) {
    severity = "error";
  }

  if (!severity) return null;

  return options !== undefined ? { severity, options } : { severity };
}

function findRuleSetting(repoRules: Record<string, unknown>, ruleId: string): unknown {
  if (ruleId in repoRules) {
    return repoRules[ruleId];
  }
  const prefixed = `strict-ts/${ruleId}`;
  if (prefixed in repoRules) {
    return repoRules[prefixed];
  }
  if (ruleId.startsWith("strict-ts/")) {
    const bare = ruleId.slice("strict-ts/".length);
    if (bare in repoRules) {
      return repoRules[bare];
    }
  }

  for (const [canonical, aliases] of Object.entries(RULE_ALIASES)) {
    if (canonical !== ruleId && !aliases.includes(ruleId)) continue;
    for (const alias of aliases) {
      if (alias in repoRules) {
        return repoRules[alias];
      }
    }
  }

  return undefined;
}


/**
 * Lookup effective override for a rule identifier, resolving canonical aliases.
 *
 * @param repoRules Map of repository rule settings.
 * @param ruleId Rule identifier or alias.
 * @returns Parsed rule override or null if not configured.
 */
export function getRepoOverrideForRule(
  repoRules: Record<string, unknown>,
  ruleId: string,
): RuleOverride | null {
  const setting = findRuleSetting(repoRules, ruleId);
  if (setting === undefined) return null;

  return parseSeverity(setting);
}

function isWithinCustomThreshold(finding: Finding, override: RuleOverride): boolean {
  if (finding.rule !== "sonarjs/cognitive-complexity" || !override.options) {
    return false;
  }

  const customThreshold = typeof override.options[0] === "number" ? override.options[0] : undefined;
  if (customThreshold === undefined) {
    return false;
  }

  const match = finding.message.match(/cognitive complexity of (\d+)/i);
  if (!match) {
    return false;
  }

  const actual = Number(match[1]);

  return actual <= customThreshold;
}

/**
 * Filter and adjust findings based on repository-level rule priority.
 *
 * @param findings Findings emitted by quality checks.
 * @param repoRules Repository rule configuration map.
 * @returns Filtered findings adhering to repository precedence.
 */
export function applyRepoRuleGuard(
  findings: Finding[],
  repoRules: Record<string, unknown>,
): Finding[] {
  const result: Finding[] = [];

  for (const finding of findings) {
    const override = getRepoOverrideForRule(repoRules, finding.rule);
    if (!override) {
      if (DEFAULT_OFF_RULES[finding.rule]) {
        continue;
      }
      result.push(finding);
      continue;
    }

    if (override.severity === "off" || isWithinCustomThreshold(finding, override)) {
      continue;
    }

    result.push({
      ...finding,
      severity: override.severity,
    });
  }

  return result;
}

function overrideMatches(
  override: RepoConfig["fileOverrides"][number],
  relPath: string,
): boolean {
  const patterns = Array.isArray(override.files) ? override.files : [override.files];
  const isMatch = picomatch(patterns);
  if (!isMatch(relPath)) {
    return false;
  }

  if (override.excludedFiles) {
    const excludePatterns = Array.isArray(override.excludedFiles)
      ? override.excludedFiles
      : [override.excludedFiles];
    const isExclude = picomatch(excludePatterns);
    if (isExclude(relPath)) {
      return false;
    }
  }

  return true;
}

/**
 * Resolve effective rules for a specific relative file path.
 *
 * @param repoConfig Loaded repository configuration object.
 * @param relPath Relative file path.
 * @returns Merged rule dictionary applying file-specific overrides.
 */
export function getRepoRulesForFile(
  repoConfig: RepoConfig,
  relPath: string,
): Record<string, unknown> {
  const effectiveRules: Record<string, unknown> = { ...repoConfig.globalRules };

  for (const override of repoConfig.fileOverrides) {
    if (override.files && overrideMatches(override, relPath)) {
      Object.assign(effectiveRules, override.rules);
    }
  }

  return effectiveRules;
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
