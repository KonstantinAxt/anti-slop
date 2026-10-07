import { execSync } from "node:child_process";
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

const DEFAULT_TEMPERATURE = 0;
const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_INPUT_TOKEN_CEILING = 12000;
const CHARS_PER_TOKEN = 4;

let cachedEngineCommit: string | null | undefined;

function resolveEngineCommit(): string | null {
  if (cachedEngineCommit !== undefined) {
    return cachedEngineCommit;
  }

  try {
    const commit = execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    cachedEngineCommit = commit.length > 0 ? commit : null;
  } catch {
    cachedEngineCommit = null;
  }

  return cachedEngineCommit;
}

export async function reviewWithJudge(
  input: JudgeInput,
  opts: ReviewOptions
): Promise<JudgeResult> {
  const startTime = performance.now();
  const timestamp = new Date().toISOString();

  const temperature = DEFAULT_TEMPERATURE;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const inputTokenCeiling = opts.inputTokenCeiling ?? DEFAULT_INPUT_TOKEN_CEILING;

  const redacted = redactJudgeInput(input);
  const userPrompt = buildUserPrompt(redacted.diff, redacted.files);
  const engineCommit = resolveEngineCommit();

  const provenanceBase = {
    provider: opts.provider.name,
    endpoint: opts.provider.endpoint,
    model: opts.provider.model,
    systemPromptSha256: SYSTEM_PROMPT_SHA256,
    userTemplateSha256: USER_TEMPLATE_SHA256,
    schemaVersion: JUDGE_SCHEMA_VERSION,
    schemaSha256: SCHEMA_SHA256,
    params: {
      temperature,
      maxTokens,
      timeoutMs,
      inputTokenCeiling,
    },
    engineCommit,
    timestamp,
    redactions: redacted.redactions,
    droppedFiles: redacted.droppedFiles,
  };

  const estimatedTokens = Math.ceil(userPrompt.length / CHARS_PER_TOKEN);

  if (estimatedTokens > inputTokenCeiling) {
    const latencyMs = Math.round(performance.now() - startTime);

    return {
      disposition: "ABSTAIN",
      abstainReason: "TOKEN_CEILING",
      findings: [],
      provenance: {
        ...provenanceBase,
        latencyMs,
      },
    };
  }

  let completionResult: {
    text: string;
    usage?: { inputTokens: number; outputTokens: number };
  };

  try {
    completionResult = await opts.provider.complete({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens,
      temperature,
      timeoutMs,
    });
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startTime);
    let abstainReason: JudgeAbstainReason = "PROVIDER_ERROR";

    if (error instanceof JudgeProviderError) {
      abstainReason = error.reason;
    } else if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      abstainReason = "TIMEOUT";
    }

    return {
      disposition: "ABSTAIN",
      abstainReason,
      findings: [],
      provenance: {
        ...provenanceBase,
        latencyMs,
      },
    };
  }

  const latencyMs = Math.round(performance.now() - startTime);
  const provenance: JudgeProvenance = {
    ...provenanceBase,
    latencyMs,
    ...(completionResult.usage != null ? { usage: completionResult.usage } : {}),
  };

  const validation = validateJudgeOutput(completionResult.text, redacted.files);

  if (!validation.ok) {
    return {
      disposition: "ABSTAIN",
      abstainReason: "MALFORMED_OUTPUT",
      findings: [],
      provenance,
    };
  }

  const { verdict, findings, notes } = validation.data;

  if (verdict === "NEEDS_HUMAN_ATTENTION") {
    const result: JudgeResult = {
      disposition: "ABSTAIN",
      abstainReason: "NEEDS_HUMAN_ATTENTION",
      findings: [],
      provenance,
    };

    if (notes !== undefined) {
      result.notes = notes;
    }

    return result;
  }

  const result: JudgeResult = {
    disposition: verdict,
    findings,
    provenance,
  };

  if (notes !== undefined) {
    result.notes = notes;
  }

  return result;
}
