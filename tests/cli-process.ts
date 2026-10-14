import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/anti-slop");

export interface CliProcessResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

export function runCliProcess(args: string[], cwd: string, signal: AbortSignal): Promise<CliProcessResult> {
  const { promise, resolve, reject } = Promise.withResolvers<CliProcessResult>();
  const child = spawn(process.execPath, [CLI_PATH, ...args], { cwd, detached: true });
  let stdout = "";
  let stderr = "";

  const onAbort = () => {
    if (child.pid === undefined) return;

    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error: unknown) {
      const isAlreadyGone = error instanceof Error && "code" in error && error.code === "ESRCH";
      if (!isAlreadyGone) {
        reject(new Error(`Failed to kill CLI process with args ${JSON.stringify(args)}: ${String(error)}`));
      }
    }
  };

  signal.addEventListener("abort", onAbort, { once: true });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });

  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  child.on("error", (error: Error) => {
    signal.removeEventListener("abort", onAbort);
    reject(new Error(`Failed to run CLI with args ${JSON.stringify(args)}: ${error.message}`, { cause: error }));
  });

  child.on("close", (code: number | null) => {
    signal.removeEventListener("abort", onAbort);

    if (signal.aborted) {
      reject(new Error(`CLI process aborted with args ${JSON.stringify(args)}`));

      return;
    }

    resolve({ stdout, stderr, status: code });
  });

  return promise;
}
