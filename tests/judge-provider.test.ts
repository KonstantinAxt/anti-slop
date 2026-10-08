import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createOpenAICompatibleProvider, reviewWithJudge } from "../src/index.js";

const HTTP_INTERNAL_ERROR = 500;
const SHORT_TIMEOUT_MS = 20;

describe("OpenAI Compatible Provider Integration", () => {
  it("connects to local node:http server and maps request, usage, errors, and timeouts", async () => {
    // Synthetic fixture: local HTTP server testing OpenAI wire format and error mappings
    let capturedAuth = "";
    let capturedBody: Record<string, unknown> = {};
    let serverMode: "success" | "server_error" | "slow" = "success";

    const server = http.createServer((req, res) => {
      capturedAuth = req.headers.authorization ?? "";

      if (serverMode === "server_error") {
        res.writeHead(HTTP_INTERNAL_ERROR, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");

        return;
      }

      if (serverMode === "slow") {
        return;
      }

      let rawData = "";

      req.on("data", (chunk: Buffer) => {
        rawData += chunk.toString("utf8");
      });

      req.on("end", () => {
        try {
          capturedBody = JSON.parse(rawData);
        } catch {
          capturedBody = {};
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: JSON.stringify({ verdict: "ALLOW", findings: [] }) } }],
            usage: { prompt_tokens: 42, completion_tokens: 18 },
          })
        );
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const apiKey = "mock-api-key-xyz";

    const provider = createOpenAICompatibleProvider({ baseUrl, apiKey, model: "custom-llm" });

    // 1. Request shape and usage parsing
    const resSuccess = await reviewWithJudge(
      { diff: "+const a = 1;", files: [{ path: "src/a.ts", content: "const a = 1;\n" }] },
      { provider }
    );

    expect(resSuccess.disposition).toBe("ALLOW");

    expect(capturedAuth).toBe(`Bearer ${apiKey}`);

    expect(capturedBody.model).toBe("custom-llm");

    expect(capturedBody.temperature).toBe(0);

    expect(Array.isArray(capturedBody.messages)).toBe(true);

    expect(resSuccess.provenance.usage?.inputTokens).toBe(42);

    expect(resSuccess.provenance.usage?.outputTokens).toBe(18);

    expect("reasoning_effort" in capturedBody).toBe(false);

    expect(resSuccess.provenance.params.reasoningEffort).toBeUndefined();

    // 1b. Reasoning effort is sent on the wire and recorded in provenance
    const resEffort = await reviewWithJudge(
      { diff: "+const a = 1;", files: [{ path: "src/a.ts", content: "const a = 1;\n" }] },
      { provider, reasoningEffort: "medium" }
    );

    expect(capturedBody.reasoning_effort).toBe("medium");

    expect(resEffort.provenance.params.reasoningEffort).toBe("medium");

    // 2. HTTP 5xx -> PROVIDER_ERROR
    serverMode = "server_error";

    const res5xx = await reviewWithJudge(
      { diff: "+const a = 1;", files: [{ path: "src/a.ts", content: "const a = 1;\n" }] },
      { provider }
    );

    expect(res5xx.disposition).toBe("ABSTAIN");

    expect(res5xx.abstainReason).toBe("PROVIDER_ERROR");

    // 3. Slow server with small timeoutMs -> TIMEOUT
    serverMode = "slow";

    const resTimeout = await reviewWithJudge(
      { diff: "+const a = 1;", files: [{ path: "src/a.ts", content: "const a = 1;\n" }] },
      { provider, timeoutMs: SHORT_TIMEOUT_MS }
    );

    expect(resTimeout.disposition).toBe("ABSTAIN");

    expect(resTimeout.abstainReason).toBe("TIMEOUT");

    server.closeAllConnections();

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

    // 4. Network refused -> NETWORK_ERROR
    const resRefused = await reviewWithJudge(
      { diff: "+const a = 1;", files: [{ path: "src/a.ts", content: "const a = 1;\n" }] },
      { provider }
    );

    expect(resRefused.disposition).toBe("ABSTAIN");

    expect(resRefused.abstainReason).toBe("NETWORK_ERROR");
  });
});
