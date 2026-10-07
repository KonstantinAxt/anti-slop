export type Severity = "error" | "warning";

export interface Finding {
  check: string;
  rule: string;
  severity: Severity;
  message: string;
  file: string;
  line: number;
  column: number;
  excerpt?: string | undefined;
  suggestion?: string | undefined;
  why?: string | undefined;
}

export interface CrapEntry {
  functionName: string;
  file: string;
  line: number;
  complexity: number;
  coverage: number;
  crap: number;
}
export interface MutationScoreMetrics {
  total: number;
  killed: number;
  survived: number;
  noCoverage: number;
  timeout: number;
  compileErrors: number;
  runtimeErrors: number;
  score: number;
}

export type CheckStatus = "completed" | "failed" | "skipped";

export interface CheckExecution {
  check: string;
  status: CheckStatus;
  error?: string;
  reason?: string;
  findingsCount?: number;
  durationMs?: number;
}


export interface AntiSlopResult {
  targetDir: string;
  totalFilesChecked: number;
  findings: Finding[];
  passed: boolean;
  durationMs: number;
  crapEntries?: CrapEntry[];
  mutationScore?: number;
  mutationMetrics?: MutationScoreMetrics;
  checks?: Record<string, CheckExecution>;
  completed?: boolean;
  completedAllChecks?: boolean;
  status?: "completed" | "incomplete";
}

export interface AntiSlopOptions {
  cwd?: string | undefined;
  files?: string[] | undefined;
  staged?: boolean | undefined;
  since?: string | undefined;
  checks?: string[] | undefined;
  mutation?: boolean | undefined;
  minMutationScore?: number | undefined;
  mutationConcurrency?: number | undefined;
  maxMutationFiles?: number | undefined;
  crap?: boolean | undefined;
  crapThreshold?: number | undefined;
  prSize?: boolean | undefined;
  prSizeWarnLines?: number | undefined;
  prSizeFailLines?: number | undefined;
  prSizeWarnFiles?: number | undefined;
  prSizeFailFiles?: number | undefined;
  allowLooseTsConfig?: boolean | undefined;
  rules?: Record<string, unknown> | undefined;
}

