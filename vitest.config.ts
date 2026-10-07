import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  define: {
    "import.meta.dir": "__dirname",
  },
  test: {
    pool: "threads",
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 60000,
    alias: {
      "bun:test": path.resolve(__dirname, "tests/setup.ts"),
    },
    include: ["tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/e2e-fixtures/**",
      "**/dist/**",
      "tests/e2e-*.test.ts",
      "tests/cli.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "reports/coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/types.ts"],
    },
  },
});
