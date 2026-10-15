import { execFileSync } from "node:child_process";
import * as path from "node:path";
import type { ReviewSource } from "./types.js";

export interface ReviewDiffSource {
  args: string[];
  contentPrefix: "HEAD:" | ":";
}

export function resolveReviewDiffSource(source: ReviewSource): ReviewDiffSource {
  switch (source.kind) {
    case "since": return { args: [`${source.ref}...HEAD`], contentPrefix: "HEAD:" };
    case "staged": return { args: ["--cached"], contentPrefix: ":" };
  }
}

export function readReviewFile(cwd: string, filePath: string, source: ReviewDiffSource): string {
  const relativePath = path.relative(cwd, filePath);

  return execFileSync("git", ["show", `${source.contentPrefix}./${relativePath}`], { cwd, encoding: "utf-8", maxBuffer: Infinity });
}
