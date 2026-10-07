import { describe, expect, it } from "vitest";
import { reviewWithJudge } from "../src/index.js";

describe("LLM Judge Secret Redaction", () => {
  it("redaction: a secret in input never reaches provider request and .env is dropped", async () => {
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
          { path: ".env", content: "DATABASE_PASSWORD=supersecretpassword12345678\n" },
          { path: "src/auth.ts", content: `export const aws = "${secretAWSKey}";\nexport const gh = "${secretGitHubToken}";\n` },
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
});
