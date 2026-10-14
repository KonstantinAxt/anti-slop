import { runCli } from "./cli.js";

function writeStream(stream: NodeJS.WriteStream, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const chunk = data.endsWith("\n") ? data : data + "\n";
    let settled = false;
    const onDone = (err?: Error | null) => {
      if (settled) return;
      settled = true;
      if (err && (!("code" in err) || err.code !== "EPIPE")) {
        reject(err);
      } else {
        resolve();
      }
    };

    const ok = stream.write(chunk, onDone);
    if (!ok) {
      stream.once("drain", () => onDone());
      stream.once("error", onDone);
    }
  });
}

const outcome = await runCli(process.argv.slice(2), process.cwd());
if (outcome.stdout) await writeStream(process.stdout, outcome.stdout);
if (outcome.stderr) await writeStream(process.stderr, outcome.stderr);
process.exitCode = outcome.exitCode;
