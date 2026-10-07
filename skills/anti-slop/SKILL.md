---
name: anti-slop
description: Deterministic code review gate. Use when running anti-slop or a review gate before finishing a code change, fixing anti-slop findings, or running mutation, CRAP, or PR-size checks.
---

Deterministic code review gate that catches structural defects before review.

Point to `anti-slop --help` for available CLI options and documentation in the target repository for full reference:
- CLI options and flags: run `anti-slop --help`
- Rule definitions and checks: see README `## Rules`
- Mutation testing guidance: see `documentation/mutation-testing.md`
- CRAP metric guidance: see `documentation/crap-metric.md`

## Gate target: *green*

The review gate is *green* when the run reports 0 errors and no new warnings on the scoped files. Keep repository rule configuration (`anti-slop.json`, ESLint config) intact; fix findings directly in source code.

## Steps

### 1. Scope

Pick the narrowest target that covers the modified code:
- Staged changes before commit: `--staged`
- Branch changes against a base branch: `--since <base>` (such as `origin/main`)
- Explicit files or folders: provide explicit paths (for example `src/services/`)

Done when the scope matches the files changed in the current task.

### 2. Run

Run anti-slop on the selected scope with LLM-oriented formatting:

```bash
anti-slop <scope> --format llm
```

For scripts or programmatic pipelines, use `--json`:

```bash
anti-slop <scope> --json
```

Exit code meanings:
- `0`: All checks passed (*green*).
- `1`: Code defects or boundary errors found. Read every reported finding and proceed to step 3.
- `2`: System error or read failure. Resolve the environment or file access failure, then rerun.

Done when the command exits `0`, `1`, or `2` and all findings have been inspected.

### 3. Fix in code

Fix each reported finding directly in the code location it identifies:
- Address defects, type boundaries, hollow tests, and smells in source files.
- Preserve repository rule configuration and existing suppressions untouched.

Done when every finding reported in step 2 has an edit in application code or tests.

### 4. Loop

Rerun anti-slop on the exact same scope:

```bash
anti-slop <scope> --format llm
```

Done when the run is *green*: 0 errors and warning counts on scoped files have not grown.

### 5. Heavy checks

Run heavy checks only when requested by the user or required by repository CI:
- **Mutation testing**: Run `--mutation-preflight` first to estimate mutants and safe concurrency. Limit mutation runs to 8 files or fewer (`--max-mutation-files 8`):
  ```bash
  anti-slop --preflight <scope>
  anti-slop --mutation <scope>
  ```
  See `documentation/mutation-testing.md` for mutation score targets and runner options.
- **CRAP metric**: Requires test coverage data (e.g. `reports/coverage/lcov.info` generated from test runs):
  ```bash
  anti-slop --crap <scope>
  ```
  See `documentation/crap-metric.md` for cyclomatic complexity and risk thresholds.
- **PR size**: Requires a git base reference:
  ```bash
  anti-slop --checks pr-size --since <base>
  ```

Done when the requested heavy check executes and satisfies the repository threshold.
