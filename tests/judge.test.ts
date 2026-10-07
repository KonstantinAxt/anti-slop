import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  createOpenAICompatibleProvider,
  createStaticProvider,
  reviewWithJudge,
  runAntiSlop,
} from "../src/index.js";

const TEST_MODEL = "test-judge-model";
const HTTP_INTERNAL_ERROR = 500;
const SHORT_TIMEOUT_MS = 20;
const LOW_TOKEN_CEILING = 5;
const EXPECTED_CONFIDENCE = 0.95;

describe("LLM Judge Public API", () => {
  it("observed violation -> FLAG with expected file and lines", async () => {
    // Synthetic fixture: observed violation under visible invariant
    // The type signature explicitly guarantees non-null User, making the null check redundant.
    const syntheticDiff = `@@ -10,3 +10,5 @@
 function processUser(user: User): string {
+  if (user === null || user === undefined) {
+    return "anonymous";
+  }`;

    const syntheticFileContent = `interface User {
  id: string;
  name: string;
}

function processUser(user: User): string {
  if (user === null || user === undefined) {
    return "anonymous";
  }
  return user.name;
}`;

    const providerResponse = JSON.stringify({
      verdict: "FLAG",
      findings: [
        {
          file: "src/user-service.ts",
          line_range: { start: 9, end: 11 },
          problem_category: "unnecessary_under_invariant",
          reason: "Defensive null guard is unnecessary because user is typed as non-nullable User.",
          confidence: EXPECTED_CONFIDENCE,
          suggested_fix: "Remove redundant null check.",
        },
      ],
      notes: "Visible invariant in TypeScript type signature.",
    });

    const provider = createStaticProvider([providerResponse], TEST_MODEL);

    const result = await reviewWithJudge(
      {
        diff: syntheticDiff,
        files: [{ path: "src/user-service.ts", content: syntheticFileContent }],
      },
      { provider }
    );

    expect(result.disposition).toBe("FLAG");

    expect(result.abstainReason).toBeUndefined();

    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];

    expect(finding?.file).toBe("src/user-service.ts");

    expect(finding?.line_range).toEqual({ start: 9, end: 11 });

    expect(finding?.problem_category).toBe("unnecessary_under_invariant");

    expect(finding?.confidence).toBe(EXPECTED_CONFIDENCE);

    expect(finding?.reason).toBe(
      "Defensive null guard is unnecessary because user is typed as non-nullable User."
    );

    expect(finding?.suggested_fix).toBe("Remove redundant null check.");

    expect(result.notes).toBe("Visible invariant in TypeScript type signature.");
  });

  it("benign lookalike -> ALLOW", async () => {
    // Synthetic fixture: benign lookalike at trust boundary
    // Parsing untrusted external JSON input at an external boundary is a valid defensive guard.
    const syntheticDiff = `@@ -5,3 +5,5 @@
 function parseWebhook(payload: unknown): WebhookEvent {
+  if (typeof payload !== "object" || payload === null) {
+    throw new Error("Invalid payload");
+  }`;

    const syntheticFileContent = `interface WebhookEvent {
  event: string;
}

function parseWebhook(payload: unknown): WebhookEvent {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid payload");
  }
  return payload as WebhookEvent;
}`;

    const providerResponse = JSON.stringify({
      verdict: "ALLOW",
      findings: [],
      notes: "Valid trust boundary check on unknown payload.",
    });

    const provider = createStaticProvider([providerResponse], TEST_MODEL);

    const result = await reviewWithJudge(
      {
        diff: syntheticDiff,
        files: [{ path: "src/webhook.ts", content: syntheticFileContent }],
      },
      { provider }
    );

    expect(result.disposition).toBe("ALLOW");

    expect(result.abstainReason).toBeUndefined();

    expect(result.findings).toHaveLength(0);

    expect(result.notes).toBe("Valid trust boundary check on unknown payload.");
  });

  it("insufficient context -> ABSTAIN NEEDS_HUMAN_ATTENTION", async () => {
    // Synthetic fixture: insufficient context outside provided files
    // The invariant ruling out null resides in an external library or unseen caller.
    const syntheticDiff = `@@ -1,3 +1,5 @@
 export function handleRequest(ctx: Context): void {
+  if (ctx.session) {
+    ctx.session.touch();
+  }`;

    const syntheticFileContent = `export function handleRequest(ctx: Context): void {
  if (ctx.session) {
    ctx.session.touch();
  }
}`;

    const providerResponse = JSON.stringify({
      verdict: "NEEDS_HUMAN_ATTENTION",
      findings: [],
      notes: "Context interface definition is not in the provided files.",
    });

    const provider = createStaticProvider([providerResponse], TEST_MODEL);

    const result = await reviewWithJudge(
      {
        diff: syntheticDiff,
        files: [{ path: "src/handler.ts", content: syntheticFileContent }],
      },
      { provider }
    );

    expect(result.disposition).toBe("ABSTAIN");

    expect(result.abstainReason).toBe("NEEDS_HUMAN_ATTENTION");

    expect(result.findings).toHaveLength(0);

    expect(result.notes).toBe("Context interface definition is not in the provided files.");
  });

  it("malformed output -> ABSTAIN MALFORMED_OUTPUT for multiple invalid shapes", async () => {
    // Synthetic fixture: invalid model outputs
    const sampleFiles = [{ path: "src/file.ts", content: "const a = 1;\nconst b = 2;\n" }];

    // 1. Extra key at top level
    const extraKeyJson = JSON.stringify({
      verdict: "ALLOW",
      findings: [],
      unexpectedField: true,
    });

    const res1 = await reviewWithJudge(
      { diff: "+const b = 2;", files: sampleFiles },
      { provider: createStaticProvider([extraKeyJson]) }
    );

    expect(res1.disposition).toBe("ABSTAIN");

    expect(res1.abstainReason).toBe("MALFORMED_OUTPUT");

    expect(res1.findings).toHaveLength(0);

    // 2. FLAG with zero findings
    const flagEmptyJson = JSON.stringify({
      verdict: "FLAG",
      findings: [],
    });

    const res2 = await reviewWithJudge(
      { diff: "+const b = 2;", files: sampleFiles },
      { provider: createStaticProvider([flagEmptyJson]) }
    );

    expect(res2.disposition).toBe("ABSTAIN");

    expect(res2.abstainReason).toBe("MALFORMED_OUTPUT");

    // 3. Finding referencing an unknown file
    const unknownFileJson = JSON.stringify({
      verdict: "FLAG",
      findings: [
        {
          file: "src/unseen.ts",
          line_range: { start: 1, end: 1 },
          problem_category: "unnecessary_under_invariant",
          reason: "Redundant defensive check.",
          confidence: 0.9,
        },
      ],
    });

    const res3 = await reviewWithJudge(
      { diff: "+const b = 2;", files: sampleFiles },
      { provider: createStaticProvider([unknownFileJson]) }
    );

    expect(res3.disposition).toBe("ABSTAIN");

    expect(res3.abstainReason).toBe("MALFORMED_OUTPUT");

    // 4. Inverted line range start > end
    const invertedRangeJson = JSON.stringify({
      verdict: "FLAG",
      findings: [
        {
          file: "src/file.ts",
          line_range: { start: 2, end: 1 },
          problem_category: "unnecessary_under_invariant",
          reason: "Invalid range start > end.",
          confidence: 0.8,
        },
      ],
    });

    const res4 = await reviewWithJudge(
      { diff: "+const b = 2;", files: sampleFiles },
      { provider: createStaticProvider([invertedRangeJson]) }
    );

    expect(res4.disposition).toBe("ABSTAIN");

    expect(res4.abstainReason).toBe("MALFORMED_OUTPUT");

    // 5. Line range outside file bounds
    const outOfBoundsJson = JSON.stringify({
      verdict: "FLAG",
      findings: [
        {
          file: "src/file.ts",
          line_range: { start: 10, end: 15 },
          problem_category: "unnecessary_under_invariant",
          reason: "Lines outside file bounds.",
          confidence: 0.8,
        },
      ],
    });

    const res5 = await reviewWithJudge(
      { diff: "+const b = 2;", files: sampleFiles },
      { provider: createStaticProvider([outOfBoundsJson]) }
    );

    expect(res5.disposition).toBe("ABSTAIN");

    expect(res5.abstainReason).toBe("MALFORMED_OUTPUT");

    // 6. Non-JSON prose response
    const res6 = await reviewWithJudge(
      { diff: "+const b = 2;", files: sampleFiles },
      { provider: createStaticProvider(["I believe this code is fine!"]) }
    );

    expect(res6.disposition).toBe("ABSTAIN");

    expect(res6.abstainReason).toBe("MALFORMED_OUTPUT");
  });

  it("provider Error -> ABSTAIN PROVIDER_ERROR", async () => {
    // Synthetic fixture: provider throwing network or operational error
    const failingProvider = createStaticProvider([new Error("Simulated remote failure")]);

    const result = await reviewWithJudge(
      {
        diff: "+const x = 1;",
        files: [{ path: "src/x.ts", content: "const x = 1;\n" }],
      },
      { provider: failingProvider }
    );

    expect(result.disposition).toBe("ABSTAIN");

    expect(result.abstainReason).toBe("PROVIDER_ERROR");

    expect(result.findings).toHaveLength(0);
  });

  it("token ceiling -> ABSTAIN TOKEN_CEILING and provider not called", async () => {
    // Synthetic fixture: input exceeding the token ceiling
    let providerWasCalled = false;

    const recordingProvider = {
      name: "recording-provider",
      model: "test-model",
      endpoint: "test://mock",
      async complete(): Promise<{ text: string }> {
        providerWasCalled = true;

        return { text: JSON.stringify({ verdict: "ALLOW", findings: [] }) };
      },
    };

    const result = await reviewWithJudge(
      {
        diff: "+const largeDiffPayload = true;",
        files: [{ path: "src/large.ts", content: "const sampleLine = 'content';\n".repeat(50) }],
      },
      {
        provider: recordingProvider,
        inputTokenCeiling: LOW_TOKEN_CEILING,
      }
    );

    expect(result.disposition).toBe("ABSTAIN");

    expect(result.abstainReason).toBe("TOKEN_CEILING");

    expect(result.findings).toHaveLength(0);

    expect(providerWasCalled).toBe(false);
  });

  it("redaction: a secret in input never reaches the provider's received request and .env is dropped", async () => {
    // Synthetic fixture: secret tokens and sensitive configuration files in input
    let receivedUserPrompt = "";

    const secretAWSKey = "AKIAIOSFODNN7EXAMPLE";
    const secretGitHubToken = "ghp_0123456789abcdef0123456789abcdef0123";
    const secretHighEntropyKey = "d8f3a9e2c1b74820a6e5b4c3d2e1f0";

    const inspectingProvider = {
      name: "inspecting-provider",
      model: "test-model",
      endpoint: "test://mock",
      async complete(req: { user: string }): Promise<{ text: string }> {
        receivedUserPrompt = req.user;

        return { text: JSON.stringify({ verdict: "ALLOW", findings: [] }) };
      },
    };

    const result = await reviewWithJudge(
      {
        diff: `+const key = "${secretAWSKey}";\n+const token = "${secretGitHubToken}";\n+const apiKey = "${secretHighEntropyKey}";`,
        files: [
          {
            path: ".env",
            content: "DATABASE_PASSWORD=supersecretpassword12345678\n",
          },
          {
            path: "src/auth.ts",
            content: `export const aws = "${secretAWSKey}";\nexport const gh = "${secretGitHubToken}";\n`,
          },
        ],
      },
      { provider: inspectingProvider }
    );

    expect(result.disposition).toBe("ALLOW");

    expect(result.provenance.droppedFiles).toContain(".env");

    expect(result.provenance.redactions).toBeGreaterThan(0);

    expect(receivedUserPrompt.includes(secretAWSKey)).toBe(false);

    expect(receivedUserPrompt.includes(secretGitHubToken)).toBe(false);

    expect(receivedUserPrompt.includes(secretHighEntropyKey)).toBe(false);

    expect(receivedUserPrompt.includes(".env")).toBe(false);

    expect(receivedUserPrompt.includes("[REDACTED]")).toBe(true);
  });

  it("createOpenAICompatibleProvider tested against local node:http server", async () => {
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
        // Never reply to exercise client-side timeout without wall-clock sleep
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
            choices: [
              {
                message: {
                  role: "assistant",
                  content: JSON.stringify({ verdict: "ALLOW", findings: [] }),
                },
              },
            ],
            usage: {
              prompt_tokens: 42,
              completion_tokens: 18,
            },
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

    const provider = createOpenAICompatibleProvider({
      baseUrl,
      apiKey,
      model: "custom-llm",
    });

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

    // Close server
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

  it("provenance records deterministic hashes, model, and provider", async () => {
    // Synthetic fixture: verifying provenance determinism
    const responseJson = JSON.stringify({ verdict: "ALLOW", findings: [] });
    const provider1 = createStaticProvider([responseJson], "model-alpha");
    const provider2 = createStaticProvider([responseJson], "model-alpha");

    const input = {
      diff: "+const token = 1;",
      files: [{ path: "src/tokens.ts", content: "const token = 1;\n" }],
    };

    const res1 = await reviewWithJudge(input, { provider: provider1 });
    const res2 = await reviewWithJudge(input, { provider: provider2 });

    expect(res1.provenance.systemPromptSha256).toBe(res2.provenance.systemPromptSha256);

    expect(res1.provenance.userTemplateSha256).toBe(res2.provenance.userTemplateSha256);

    expect(res1.provenance.schemaSha256).toBe(res2.provenance.schemaSha256);

    expect(res1.provenance.schemaVersion).toBe("2026-10-01");

    expect(res1.provenance.provider).toBe("static");

    expect(res1.provenance.model).toBe("model-alpha");
  });

  it("runAntiSlop yields identical findings whether failing judge ran or not", async () => {
    // Baseline deterministic findings without judge
    const beforeResult = await runAntiSlop({
      cwd: process.cwd(),
      files: ["src/checks/boundaries.ts"],
    });

    // Run a failing judge
    const failingProvider = createStaticProvider([new Error("Failing judge")]);

    await reviewWithJudge(
      { diff: "+const x = 1;", files: [{ path: "src/checks/boundaries.ts", content: "export {};\n" }] },
      { provider: failingProvider }
    );

    // Re-run deterministic review gate
    const afterResult = await runAntiSlop({
      cwd: process.cwd(),
      files: ["src/checks/boundaries.ts"],
    });

    expect(afterResult.findings).toEqual(beforeResult.findings);

    expect(afterResult.passed).toBe(beforeResult.passed);
  });
});
