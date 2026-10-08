import type { JudgeCompletionRequest, JudgeProvider } from "./types.js";

const DEFAULT_TEMPERATURE = 0;
const DEFAULT_TIMEOUT_MS = 25000;
const HTTP_STATUS_OK = 200;
const ERR_MISSING_CHOICE_CONTENT = "Provider response missing choices or message content";

export class JudgeProviderError extends Error {
  readonly reason: "TIMEOUT" | "NETWORK_ERROR" | "PROVIDER_ERROR";

  constructor(
    message: string,
    reason: "TIMEOUT" | "NETWORK_ERROR" | "PROVIDER_ERROR",
    cause?: unknown
  ) {
    super(message);
    this.name = "JudgeProviderError";
    this.reason = reason;

    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function extractChoiceContent(data: unknown): string {
  if (typeof data !== "object" || data === null || !("choices" in data)) {
    throw new JudgeProviderError(ERR_MISSING_CHOICE_CONTENT, "PROVIDER_ERROR");
  }

  const choices = data.choices;

  if (!Array.isArray(choices) || choices.length === 0) {
    throw new JudgeProviderError(ERR_MISSING_CHOICE_CONTENT, "PROVIDER_ERROR");
  }

  const firstChoice = choices[0];

  if (typeof firstChoice !== "object" || firstChoice === null || !("message" in firstChoice)) {
    throw new JudgeProviderError(ERR_MISSING_CHOICE_CONTENT, "PROVIDER_ERROR");
  }

  const message = firstChoice.message;

  if (typeof message !== "object" || message === null || !("content" in message)) {
    throw new JudgeProviderError(ERR_MISSING_CHOICE_CONTENT, "PROVIDER_ERROR");
  }

  const content = message.content;

  if (typeof content !== "string") {
    throw new JudgeProviderError(ERR_MISSING_CHOICE_CONTENT, "PROVIDER_ERROR");
  }

  return content;
}

function extractUsage(data: unknown): { inputTokens: number; outputTokens: number } | undefined {
  if (typeof data !== "object" || data === null || !("usage" in data)) {
    return undefined;
  }

  const usage = data.usage;

  if (typeof usage !== "object" || usage === null) {
    return undefined;
  }

  if (!("prompt_tokens" in usage) || !("completion_tokens" in usage)) {
    return undefined;
  }

  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;

  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") {
    return undefined;
  }

  return { inputTokens, outputTokens };
}

const NETWORK_ERROR_CODES: Record<string, true> = {
  ECONNREFUSED: true,
  ENOTFOUND: true,
};

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const cause =
    "cause" in error && typeof error.cause === "object" && error.cause !== null
      ? error.cause
      : null;
  const causeCode =
    cause !== null && "code" in cause && typeof cause.code === "string" ? cause.code : "";

  return Boolean(NETWORK_ERROR_CODES[code] || NETWORK_ERROR_CODES[causeCode]);
}

function classifyProviderError(error: unknown): JudgeProviderError {
  if (error instanceof JudgeProviderError) {
    return error;
  }

  if (typeof error === "object" && error !== null) {
    if ("name" in error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return new JudgeProviderError("Provider request timed out", "TIMEOUT", error);
    }

    if (isNetworkError(error)) {
      return new JudgeProviderError(`Network error: ${String(error)}`, "NETWORK_ERROR", error);
    }
  }

  return new JudgeProviderError(`Provider error: ${String(error)}`, "PROVIDER_ERROR", error);
}

export function createStaticProvider(
  responses: (string | Error)[],
  model = "static-model"
): JudgeProvider {
  let currentIndex = 0;

  return {
    name: "static",
    model,
    endpoint: "static://in-memory",
    async complete(): Promise<{
      text: string;
      usage?: { inputTokens: number; outputTokens: number };
    }> {
      if (currentIndex >= responses.length) {
        throw new JudgeProviderError(
          "Static provider ran out of configured responses",
          "PROVIDER_ERROR"
        );
      }

      const nextResponse = responses[currentIndex];
      currentIndex++;

      if (nextResponse instanceof Error) {
        throw nextResponse;
      }

      return {
        text: nextResponse ?? "",
      };
    },
  };
}

export function createOpenAICompatibleProvider(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): JudgeProvider {
  const normalizedBase = opts.baseUrl.replace(/\/+$/, "");
  const endpoint = normalizedBase.endsWith("/chat/completions")
    ? normalizedBase
    : `${normalizedBase}/chat/completions`;

  return {
    name: "openai-compatible",
    model: opts.model,
    endpoint,
    async complete(req: JudgeCompletionRequest): Promise<{
      text: string;
      usage?: { inputTokens: number; outputTokens: number };
    }> {
      const payload = {
        model: opts.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
      };

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(req.timeoutMs),
        });

        if (!response.ok) {
          throw new JudgeProviderError(
            `Provider returned HTTP error status ${response.status}`,
            "PROVIDER_ERROR"
          );
        }

        const rawJson: unknown = await response.json();
        const text = extractChoiceContent(rawJson);
        const usage = extractUsage(rawJson);

        const result: {
          text: string;
          usage?: { inputTokens: number; outputTokens: number };
        } = {
          text,
        };

        if (usage !== undefined) {
          result.usage = usage;
        }

        return result;
      } catch (error) {
        throw classifyProviderError(error);
      }
    },
  };
}

export { DEFAULT_TEMPERATURE, DEFAULT_TIMEOUT_MS, HTTP_STATUS_OK };
