export interface JudgeInput { diff: string; files: { path: string; content: string }[]; }

export interface JudgeProvider {
  name: string; model: string; endpoint: string;
  complete(req: { system: string; user: string; maxTokens: number; temperature: number; timeoutMs: number }): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }>;
}

export interface JudgeFinding {
  file: string; line_range: { start: number; end: number };
  problem_category: "unnecessary_under_invariant"; reason: string; confidence: number; suggested_fix?: string;
}

export type JudgeAbstainReason = "NEEDS_HUMAN_ATTENTION" | "TIMEOUT" | "NETWORK_ERROR" | "PROVIDER_ERROR" | "MALFORMED_OUTPUT" | "TOKEN_CEILING";

export interface JudgeProvenance {
  provider: string; endpoint: string; model: string;
  systemPromptSha256: string; userTemplateSha256: string; schemaVersion: string; schemaSha256: string;
  params: { temperature: number; maxTokens: number; timeoutMs: number; inputTokenCeiling: number };
  engineCommit: string | null; timestamp: string; latencyMs: number;
  usage?: { inputTokens: number; outputTokens: number }; redactions: number; droppedFiles: string[];
}

export interface JudgeResult {
  disposition: "FLAG" | "ALLOW" | "ABSTAIN"; abstainReason?: JudgeAbstainReason;
  findings: JudgeFinding[]; notes?: string; provenance: JudgeProvenance;
}

export interface ReviewOptions {
  provider: JudgeProvider; inputTokenCeiling?: number; maxTokens?: number; timeoutMs?: number;
}
