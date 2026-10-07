import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildUserPrompt,
  JUDGE_SCHEMA_VERSION,
  SCHEMA_SHA256,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_SHA256,
  USER_TEMPLATE_SHA256,
} from "./prompt.js";
import { JudgeProviderError } from "./provider.js";
import { redactJudgeInput } from "./redaction.js";
import type {
  JudgeAbstainReason,
  JudgeInput,
  JudgeProvenance,
  JudgeResult,
  ReviewOptions,
} from "./types.js";
import { validateJudgeOutput } from "./validator.js";

const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_INPUT_TOKEN_CEILING = 12000;
const CHARS_PER_TOKEN = 4;

// The anti-slop checkout's own commit, not the caller's repository; null for installs without git metadata.
function resolveEngineCommit(): string | null {
  try {
    const [topLevel = "", commit = ""] = execFileSync("git", ["-C", dirname(fileURLToPath(import.meta.url)), "rev-parse", "--show-toplevel", "HEAD"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n");
    const packageJson: unknown = JSON.parse(readFileSync(join(topLevel, "package.json"), "utf-8"));

    return typeof packageJson === "object" && packageJson !== null && "name" in packageJson && packageJson.name === "anti-slop" && commit.length > 0 ? commit : null;
  } catch {
    return null;
  }
}

const ENGINE_COMMIT = resolveEngineCommit();

export async function reviewWithJudge(input: JudgeInput, opts: ReviewOptions): Promise<JudgeResult> {
  const startTime = performance.now();
  const timestamp = new Date().toISOString();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const inputTokenCeiling = opts.inputTokenCeiling ?? DEFAULT_INPUT_TOKEN_CEILING;

  const redacted = redactJudgeInput(input);
  const userPrompt = buildUserPrompt(redacted.diff, redacted.files);

  const base = {
    provider: opts.provider.name,
    endpoint: opts.provider.endpoint,
    model: opts.provider.model,
    systemPromptSha256: SYSTEM_PROMPT_SHA256,
    userTemplateSha256: USER_TEMPLATE_SHA256,
    schemaVersion: JUDGE_SCHEMA_VERSION,
    schemaSha256: SCHEMA_SHA256,
    params: { temperature: 0, maxTokens, timeoutMs, inputTokenCeiling },
    engineCommit: ENGINE_COMMIT,
    timestamp,
    redactions: redacted.redactions,
    droppedFiles: redacted.droppedFiles,
  };

  const estimatedTokens = Math.ceil(userPrompt.length / CHARS_PER_TOKEN);

  if (estimatedTokens > inputTokenCeiling) {
    const latencyMs = Math.round(performance.now() - startTime);

    return { disposition: "ABSTAIN", abstainReason: "TOKEN_CEILING", findings: [], provenance: { ...base, latencyMs } };
  }

  let completion: { text: string; usage?: { inputTokens: number; outputTokens: number } };

  try {
    completion = await opts.provider.complete({ system: SYSTEM_PROMPT, user: userPrompt, maxTokens, temperature: 0, timeoutMs });
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startTime);
    let reason: JudgeAbstainReason = "PROVIDER_ERROR";

    if (error instanceof JudgeProviderError) {
      reason = error.reason;
    } else if (typeof error === "object" && error !== null && "name" in error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      reason = "TIMEOUT";
    }

    return { disposition: "ABSTAIN", abstainReason: reason, findings: [], provenance: { ...base, latencyMs } };
  }

  const latencyMs = Math.round(performance.now() - startTime);
  const provenance: JudgeProvenance = { ...base, latencyMs, ...(completion.usage != null ? { usage: completion.usage } : {}) };
  const validation = validateJudgeOutput(completion.text, redacted.files);

  if (!validation.ok) {
    return { disposition: "ABSTAIN", abstainReason: "MALFORMED_OUTPUT", findings: [], provenance };
  }

  const { verdict, findings, notes } = validation.data;

  if (verdict === "NEEDS_HUMAN_ATTENTION") {
    return { disposition: "ABSTAIN", abstainReason: "NEEDS_HUMAN_ATTENTION", findings: [], provenance, ...(notes ? { notes } : {}) };
  }

  return { disposition: verdict, findings, provenance, ...(notes ? { notes } : {}) };
}
