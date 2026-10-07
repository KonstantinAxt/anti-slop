import * as path from "node:path";

const MIN_SECRET_LENGTH = 16;
const MIN_SHANNON_ENTROPY = 3.0;
const REDACTED_PLACEHOLDER = "[REDACTED]";

const DROPPED_EXTENSIONS: Record<string, true> = {
  ".pem": true,
  ".key": true,
  ".p12": true,
  ".pfx": true,
  ".pkcs12": true,
  ".keystore": true,
  ".jks": true,
};

const SSH_KEY_PREFIXES = ["id_rsa", "id_dsa", "id_ed25519", "id_ecdsa"] as const;

function isDroppedFilePath(filePath: string): boolean {
  const baseName = path.basename(filePath);

  if (baseName.startsWith(".env")) {
    return true;
  }

  for (const prefix of SSH_KEY_PREFIXES) {
    if (baseName.startsWith(prefix)) {
      return true;
    }
  }

  const extension = path.extname(baseName).toLowerCase();

  return Boolean(DROPPED_EXTENSIONS[extension]);
}

function computeShannonEntropy(text: string): number {
  const length = text.length;

  if (length === 0) {
    return 0;
  }

  const frequencies = new Map<string, number>();

  for (let index = 0; index < length; index++) {
    const character = text.charAt(index);
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }

  let entropy = 0;

  for (const count of frequencies.values()) {
    const probability = count / length;
    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}

interface MaskResult {
  text: string;
  count: number;
}

function maskPattern(
  text: string,
  regex: RegExp,
  replacement: (match: string, ...args: string[]) => string | null
): MaskResult {
  let count = 0;

  const result = text.replace(regex, (match, ...args) => {
    const replaced = replacement(match, ...args);

    if (replaced !== null) {
      count++;

      return replaced;
    }

    return match;
  });

  return { text: result, count };
}

function maskSecretsInText(input: string): MaskResult {
  let text = input;
  let totalRedactions = 0;

  // 1. PEM blocks
  const pemRegex = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g;
  const pemResult = maskPattern(text, pemRegex, () => REDACTED_PLACEHOLDER);
  text = pemResult.text;
  totalRedactions += pemResult.count;

  // 2. AWS keys (AKIA/ASIA)
  const awsRegex = /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g;
  const awsResult = maskPattern(text, awsRegex, () => REDACTED_PLACEHOLDER);
  text = awsResult.text;
  totalRedactions += awsResult.count;

  // 3. GitHub tokens
  const githubRegex = /\b(?:gh[pousr]_[A-Za-z0-9_]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g;
  const githubResult = maskPattern(text, githubRegex, () => REDACTED_PLACEHOLDER);
  text = githubResult.text;
  totalRedactions += githubResult.count;

  // 4. OpenAI and standard API keys (sk-...)
  const skRegex = /\bsk-[A-Za-z0-9_-]{20,}\b/g;
  const skResult = maskPattern(text, skRegex, () => REDACTED_PLACEHOLDER);
  text = skResult.text;
  totalRedactions += skResult.count;

  // 5. JWT tokens (eyJ...)
  const jwtRegex = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
  const jwtResult = maskPattern(text, jwtRegex, () => REDACTED_PLACEHOLDER);
  text = jwtResult.text;
  totalRedactions += jwtResult.count;

  // 6. Bearer tokens in headers
  const bearerRegex = /\b(Bearer\s+)[A-Za-z0-9_.\-~+/]{20,}=*\b/gi;
  const bearerResult = maskPattern(text, bearerRegex, (_match, prefix) => `${prefix}${REDACTED_PLACEHOLDER}`);
  text = bearerResult.text;
  totalRedactions += bearerResult.count;

  // 7. High-entropy string assignments to names containing key/secret/token/password
  const assignmentRegex =
    /((?:["'`]?[\w]*(?:key|secret|token|password)[\w]*["'`]?\s*[:=]\s*["']))([^"'\r\n]{16,})(["'])/gi;

  const assignmentResult = maskPattern(
    text,
    assignmentRegex,
    (_match, prefix, value, quote) => {
      if (value === REDACTED_PLACEHOLDER) {
        return null;
      }

      const entropy = computeShannonEntropy(value);

      if (value.length >= MIN_SECRET_LENGTH && entropy >= MIN_SHANNON_ENTROPY) {
        return `${prefix}${REDACTED_PLACEHOLDER}${quote}`;
      }

      return null;
    }
  );

  text = assignmentResult.text;
  totalRedactions += assignmentResult.count;

  return { text, count: totalRedactions };
}

export interface RedactedInput {
  diff: string;
  files: { path: string; content: string }[];
  droppedFiles: string[];
  redactions: number;
}

export function redactJudgeInput(input: {
  diff: string;
  files: { path: string; content: string }[];
}): RedactedInput {
  const droppedFiles: string[] = [];
  const keptFiles: { path: string; content: string }[] = [];
  let totalRedactions = 0;

  for (const file of input.files) {
    if (isDroppedFilePath(file.path)) {
      droppedFiles.push(file.path);
    } else {
      const maskedContent = maskSecretsInText(file.content);
      totalRedactions += maskedContent.count;
      keptFiles.push({
        path: file.path,
        content: maskedContent.text,
      });
    }
  }

  const maskedDiff = maskSecretsInText(input.diff);
  totalRedactions += maskedDiff.count;

  return {
    diff: maskedDiff.text,
    files: keptFiles,
    droppedFiles,
    redactions: totalRedactions,
  };
}
