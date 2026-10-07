---
name: anti-slop
description: Deterministic code review gate. Use when running anti-slop or a review gate before finishing a code change, fixing anti-slop findings, or running mutation, CRAP, or PR-size checks.
---

The gate is *green* when the scoped run reports 0 errors and the warning count on the scoped files is no higher than before your change. Exit code 0 alone is not *green*: warnings exit 0 too.

## Steps

### 1. Baseline and scope

Pick the narrowest scope that covers your change: `--staged`, `--since <base>` (for example `origin/main`), or explicit paths. Before editing, or by stashing your change, record the warning count on that scope from the summary line `Found N error(s), M warning(s)`.

Done when the scope matches the files you changed and you have the baseline warning count.

### 2. Run

```bash
anti-slop <scope> --format llm
```

Use `--json` instead when a script consumes the result. Exit codes: `0` no errors, `1` errors found, `2` system or read failure. On `2`, fix the environment or file access and rerun.

Done when the run exits `0` or `1` and you have read every finding.

### 3. Fix in code

Fix every error, and every warning your change introduced, in the code the finding points at. The repository's rule config (`anti-slop.json`, ESLint config) and its suppressions belong to the repo owner; leave them as they are.

Done when each of those findings has a matching code edit.

### 4. Loop

Rerun step 2 on the same scope.

Done when the run is *green*.

### 5. Heavy checks

Run these only when the user asks or the repository's CI runs them:
- **Mutation**: `anti-slop --mutation-preflight <scope>` first, then `anti-slop --mutation <scope>` on 8 files or fewer.
- **CRAP**: `anti-slop --crap <scope>`; needs coverage data from a test run.
- **PR size**: `anti-slop --checks pr-size --since <base>`.

Done when each requested check passes the repository's threshold.

## Reference

- Flags and defaults: `anti-slop --help`.
- What a rule means and how to fix it: [Rules](https://github.com/KonstantinAxt/anti-slop#rules).
- Mutation and CRAP detail: [mutation-testing.md](https://github.com/KonstantinAxt/anti-slop/blob/main/documentation/mutation-testing.md), [crap-metric.md](https://github.com/KonstantinAxt/anti-slop/blob/main/documentation/crap-metric.md).
