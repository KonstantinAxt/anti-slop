#!/usr/bin/env node
import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const DEFAULT_FILE = "dist/cli.js";
const MAX_RAW_BYTES = 350 * 1024; // 350 KB budget
const MAX_GZIP_BYTES = 85 * 1024; // 85 KB budget

const targetFile = process.argv[2] ?? DEFAULT_FILE;
const resolvedPath = path.resolve(process.cwd(), targetFile);

if (!fs.existsSync(resolvedPath)) {
  console.log(`Target file "${targetFile}" not found, building CLI first...`);
  child_process.execSync("pnpm run build", { stdio: "inherit" });
}

const content = fs.readFileSync(resolvedPath);
const rawBytes = content.length;
const gzipBytes = zlib.gzipSync(content).length;

const rawKb = (rawBytes / 1024).toFixed(2);
const gzipKb = (gzipBytes / 1024).toFixed(2);
const maxRawKb = (MAX_RAW_BYTES / 1024).toFixed(2);
const maxGzipKb = (MAX_GZIP_BYTES / 1024).toFixed(2);

console.log("📦 CLI Bundle Size Budget Check");
console.log(`Target: ${targetFile}`);
console.log(`- Raw Size:  ${rawKb} KB / limit ${maxRawKb} KB`);
console.log(`- Gzip Size: ${gzipKb} KB / limit ${maxGzipKb} KB`);

let failed = false;

if (rawBytes > MAX_RAW_BYTES) {
  console.error(`❌ FAILURE: Raw bundle size (${rawKb} KB) exceeds budget of ${maxRawKb} KB.`);
  failed = true;
}

if (gzipBytes > MAX_GZIP_BYTES) {
  console.error(`❌ FAILURE: Gzipped bundle size (${gzipKb} KB) exceeds budget of ${maxGzipKb} KB.`);
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log("✔ Bundle size is within budget.");
