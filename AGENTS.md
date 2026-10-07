pnpm project (Node + Vitest). Run TypeScript directly with `tsx <file>` or `node --import tsx <file>`; no build step needed.

## Workflow

Start every change on a new branch in its own git worktree (`git worktree add -b <branch> <path>`, then `pnpm install --frozen-lockfile`), so parallel sessions never share a checkout. PR titles follow Conventional Commits; release-please builds `CHANGELOG.md` from them.

## Done means green gates

Your work is done when every `run:` step in `.github/workflows/_gates.yml` passes locally, with `${{ inputs.since_ref }}` set to `origin/main`. anti-slop is the linter: `node bin/anti-slop` reports 0 errors, and files you touched gain no new warnings (the repo carries a known warning baseline). Fix findings in code and keep suppressions out.

## Rules

A new rule ships with its `README.md` entry in the same PR.

## `e2e-fixtures/` stays at the repo root

It holds deliberately broken code: type errors, assertion-free tests, focused tests. `tsconfig.json`, `vitest.config.ts` and `IGNORED_DIRS` in `src/index.ts` all exclude it by path, so new broken fixtures go here, beside `tests/`.

## Issues and ideas

Ideas and RFCs go to GitHub Discussions. Issues are for concrete bugs, accepted specs and rule proposals. Templates, labels and triage: `documentation/github-governance-and-intake.md`.
