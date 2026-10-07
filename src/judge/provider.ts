import type { JudgeProvider } from "./types.js";

export class JudgeProviderError extends Error {
  readonly reason: "TIMEOUT" | "NETWORK_ERROR" | "PROVIDER_ERROR";

  constructor(message: string, reason: "TIMEOUT" | "NETWORK_ERROR" | "PROVIDER_ERROR", cause?: unknown) {
    super(message);
    this.name = "JudgeProviderError";
    this.reason = reason;

    if (cause !== undefined) {
      this.cause = cause;
    }
  }
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
    async complete(): Promise<{ text: string }> {
      if (currentIndex >= responses.length) {
        throw new JudgeProviderError("Static provider ran out of responses", "PROVIDER_ERROR");
      }

      const next = responses[currentIndex++];

      if (next instanceof Error) {
        throw next;
      }

      return { text: next ?? "" };
    },
  };
}
