# CI/CD & Automated Release Architecture

This document describes the continuous integration, verification gates, and automated release pipeline for `anti-slop`.

---

## 1. Core Principles & Architecture

`anti-slop` uses a **PR-gated, trunk-based workflow with automated semantic releases**:

1. **Trunk Protection**: Direct commits and force pushes to `main` are blocked. All changes land via Pull Requests that satisfy automated verification gates.
2. **Unified Reusable Gates**: All checks are defined once in `.github/workflows/_gates.yml` and reused by PR CI and release workflows.
3. **Single Required Status Check (`Gates Pass`)**: An aggregator job evaluates all required gate outcomes with `if: always()`. This avoids the GitHub Actions issue where conditionally skipped jobs stay "Pending" forever.
4. **Conventional Commits & Semantic Releases**: Pull request titles must follow the Conventional Commits standard. When merged via squash-and-merge, `release-please` calculates the semantic version bump and creates or updates a Release PR with a formatted changelog.
5. **PR Size Enforcement**: A native review-burden check (`max-pr-size`) prevents oversized PRs, keeping changes within empirically proven review limits.
6. **Distribution via GitHub Releases**: Release workflows package a verified source tarball with SHA-256 checksums, installable via a one-line `curl -fsSL ... | bash` installer.

---

## 2. Gate Pipeline Topology

```
                   ┌──────────────────────────────────────────────┐
                   │ Pull Request / Push to main / Merge Queue    │
                   └──────────────────────┬───────────────────────┘
                                        │
                          Calls: .github/workflows/_gates.yml
                                        │
        ┌───────────────┬───────────────┼───────────────┬────────────────┬───────────────┬────────────────┬───────────────┐
        ▼               ▼               ▼               ▼                ▼               ▼                ▼               ▼
 ┌──────────────┐┌──────────────┐┌──────────────┐┌──────────────┐ ┌──────────────┐┌──────────────┐ ┌──────────────┐┌──────────────┐
 │  typecheck   ││  unit-test   ││   e2e-test   ││  self-gate   │ │   pr-size    ││installer-gate│ │  crap-gate   ││mutation-gate │
 │(pnpm exec    ││(pnpm run     ││(pnpm run     ││ (anti-slop)  │ │(diff numstat ││(Ubuntu +     │ │(anti-slop    ││(diff Stryker │
 │ tsc --noEmit)││ test:coverage││ test:e2e)    ││              │ │ + check:size)││ macOS matrix)│ │ --crap via   ││ concurrency 2│
 │              ││ -> lcov)     ││              ││              │ │              ││              │ │ artifact)    ││ max-files 8) │
 └──────┬───────┘└──────┬───────┘└──────┬───────┘└──────┬───────┘ └──────┬───────┘└──────┬───────┘ └──────┬───────┘└──────┬───────┘
        │               │               │               │                │               │
               │
        └───────────────┴───────────────┼───────────────┴────────────────┴───────────────┘
                                        ▼
                        ┌────────────────────────────────┐
                        │      Job: Gates Pass           │
                        │    (Required Status Check)     │
                        └───────────────┬────────────────┘
                                        ▼
                                Merge to `main`
                                        │
                                        ▼
                        ┌────────────────────────────────┐
                        │ .github/workflows/release.yml  │
                        │ - release-please               │
                        │ - Tarball packaging            │
                        │ - Checksums & GitHub Release   │
                        └────────────────────────────────┘
```
---

## 3. Workflow Inventory

| Workflow | Path | Triggers | Description |
|---|---|---|---|
| **CI** | `.github/workflows/ci.yml` | `pull_request` -> `main`<br>`push` -> `main`<br>`merge_group` | Entrypoint for CI runs; calls `_gates.yml` with `run_heavy_gates: true` on PRs and merge queue checks. |
| **Gates** | `.github/workflows/_gates.yml` | `workflow_call` | Reusable workflow containing all validation jobs and the `Gates Pass` aggregator. |
| **Lint PR Title** | `.github/workflows/lint-pr-title.yml` | `pull_request` (open, edit, sync) | Validates PR titles against Conventional Commits using `action-semantic-pull-request`. |
| **Release** | `.github/workflows/release.yml` | `push` -> `main` | Runs `release-please`; packages `anti-slop.tgz` and uploads checksums to GitHub Releases. |

---

## 4. Verification Gates Breakdown

### 4.1 Core Gates (Code-Changing PRs and Unverified Pushes to `main`)

1. **TypeScript Typecheck (`typecheck`)**:
   - Command: `pnpm exec tsc --noEmit`
   - Validates that code satisfies strict compiler options (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
2. **Unit & Integration Test Suite (`unit-test`)**:
   - Command: `pnpm run test:coverage`
   - Runs all 25 unit/integration test files (~25s) in parallel with E2E tests, generating LCOV coverage uploaded as an artifact for `crap-gate`.

3. **E2E Subprocess Tests (`e2e-test`)**:
   - Command: `pnpm run test:e2e` (pre-builds CLI via `pnpm run build` and runs Vitest E2E tests)

4. **Anti-Slop Self Gate (`self-gate`)**:
   - Command: `node bin/anti-slop`

5. **PR Size & Bundle Size Budget Gate (`pr-size`)**:
   - Command: `node bin/anti-slop --since origin/main --checks pr-size` & `pnpm run check:size`
     $$\text{Review Lines} = \text{Additions} + \min(\text{Deletions}, \text{Additions})$$
   - Pure deletions of dead code do not penalize review burden.
   - **Warning threshold**: > 200 review lines or > 10 files.
   - **Hard failure threshold**: > 500 review lines or > 25 files.
   - **Bundle Size Budget**: Verifies `dist/cli.js` does not exceed raw budget (350 KB) or gzip budget (85 KB).

6. **Cross-Platform Installer Gate (`installer-gate`)**:
   - Command: `pnpm run test:installer`
   - Runs on a matrix of `[ubuntu-latest, macos-latest]`.
   - Runs `shellcheck install.sh`, creates local mock distribution tarball, executes clean install, verifies executable `--help`, and verifies tampered checksum triggers exit code 1.
### 4.2 Heavy Gates (Code-Changing PRs Only)

`crap-gate` runs on ordinary code-changing PRs when `inputs.run_heavy_gates` is enabled. Metadata-only Release Please PRs skip it (see §5.5). `mutation-gate` is temporarily disabled (see issue #4):

1. **CRAP (Change Risk Anti-Pattern) Metric Gate (`crap-gate`)**:
   - Reuses coverage artifact generated by `unit-test` (`reports/coverage/lcov.info`), eliminating redundant test suite execution.
   - Command: `node bin/anti-slop --since origin/main --checks crap`
     $$\text{CRAP}(m) = \text{CC}(m)^2 \times (1 - \text{cov}(m))^3 + \text{CC}(m)$$
   - Functions exceeding threshold **30.0** trigger hard errors.

2. **Mutation Testing Gate (`mutation-gate`, currently disabled)**:
   - Command: `node bin/anti-slop --since origin/main --checks mutation --min-mutation-score 80 --mutation-concurrency 2 --max-mutation-files 8`
   - **Vitest Runner with Per-Test Coverage**: Uses `@stryker-mutator/vitest-runner` with `coverageAnalysis: "perTest"` to map each mutant directly to the specific unit tests that exercise it.
   - **Scope Guard (`--max-mutation-files 8`)**: Configurable threshold preventing CPU/memory exhaustion when PRs touch broad scopes.
   - **Incremental Mode**: Caches previous mutant execution states in `reports/mutation/stryker-incremental.json` using GitHub Actions cache to skip unchanged mutants.
   - **Lean Sandboxes**: Configures `ignorePatterns` for build, reports, and documentation to minimize sandbox I/O overhead.
   - Requires a minimum mutation score of **80.0%**:
     $$\text{Score} = \frac{\text{Killed} + \text{Timeout}}{\text{Killed} + \text{Timeout} + \text{Survived} + \text{NoCoverage}} \times 100$$
   - Eliminates hollow tests and ensures assertions verify real code paths.
### 4.3 Aggregator (`Gates Pass`)

The aggregator job runs with `if: always()` and evaluates the status of the gates in its `needs` list (`changes`, `typecheck`, `unit-test`, `e2e-test`, `self-gate`, `pr-size`, `installer-gate`, `crap-gate`):
- **Packaging sanity gates** (`typecheck`, `pr-size`, `installer-gate`): Must return `success` (or `'skipped'` only when code did not change or the tree was already verified). These gates execute on metadata-only Release PRs.
- **Code & behavioral test gates** (`unit-test`, `e2e-test`, `self-gate`): Must return `success` (or `'skipped'` when code did not change or the tree was already verified). On an eligible metadata-only Release PR, `Gates Pass` permits intentional `'skipped'` statuses for these three jobs.
- **Heavy gate** (`crap-gate`): Must return `success` on ordinary code-changing PRs when `run_heavy_gates` is enabled. It is skipped on fast-tracked Release PRs. `mutation-gate` is currently disabled (`if: false`) and is not a `Gates Pass` dependency.
- If any required check fails, is cancelled, or is unexpectedly skipped, `Gates Pass` exits with code 1.
---

## 5. Pipeline Optimizations & Caching Mechanisms

To keep developer feedback fast and avoid redundant runner minutes, `.github/workflows/_gates.yml` implements a layered optimization strategy:

### 5.1 Git Tree SHA Verification Cache (Post-Merge on `main`)
When a pull request is squash-merged into `main`:
1. **PR Verification Marker**: Upon successful completion of all gates in a PR, `Gates Pass` computes the Git Tree SHA (`git rev-parse HEAD^{tree}`) and saves a verification marker in GitHub Actions cache under the key:
   ```yaml
   ci-tree-verified-${{ tree_sha }}
   ```
2. **GitHub Actions Cache Branch Isolation & REST API Check**:
   Under standard GitHub Actions cache access rules, workflows running on the default branch (`main`) cannot restore caches created under PR merge refs (`refs/pull/*/merge`) via the `@actions/cache` runner client (designed to prevent unprivileged PRs from poisoning `main`'s cache).
   To cross this branch boundary safely without pulling arbitrary cache files, the `changes` job:
   - Runs with `permissions: actions: read`.
   - Queries the repository-wide GitHub Actions Cache REST API via GitHub CLI (`gh api`):
     ```bash
     gh api "/repos/${{ github.repository }}/actions/caches?key=ci-tree-verified-${TREE_SHA}" --jq '.total_count'
     ```
3. **Post-Merge Execution Behavior**:
   - **Cache Hit (`total_count > 0`)**: The exact repository tree was already validated prior to merge. Downstream test gates (`typecheck`, `unit-test`, `e2e-test`, `self-gate`, `pr-size`, `installer-gate`, `crap-gate`) are skipped. `Gates Pass` logs:
     `✔ Git tree <SHA> was already verified in PR CI; skipping redundant test execution on main.`
     Pipeline duration on `main` drops from ~4 minutes to ~15 seconds.
   - **Cache Miss (`total_count == 0` or API failure)**: If a direct push occurred or non-trivial merge conflict resolution altered the tree, all test gates run in full to protect trunk integrity.

### 5.2 Path-Based Change Filtering (`dorny/paths-filter`)
Instead of fragile top-level `paths-ignore` (which leaves required branch protection status checks pending forever), `_gates.yml` runs a lightweight `Detect File Changes` job:
- Categorizes changes into `code`, `core`, and `docs`.
- **Documentation PRs**: Pull requests touching only `**.md`, `documentation/**`, or `.github/ISSUE_TEMPLATE/**` skip heavy test gates. `Gates Pass` recognizes that `code == 'false'` and accepts the skipped status cleanly, satisfying GitHub Rulesets in ~8 seconds.

### 5.3 Selective Unit Test Execution in PRs (`vitest --changed`)
In `unit-test`:
- When running in a PR and no core files (`package.json`, `tsconfig*.json`, `vitest*.config.ts`, `src/types.ts`, `src/index.ts`) were modified, tests run selectively:
  ```bash
  pnpm run test:coverage --changed "$SINCE_REF" --passWithNoTests
  ```
- Vitest inspects the module dependency graph and only executes tests transitively impacted by changed files.
- When core configuration files change or on `main` push, the full unit test suite executes automatically.

### 5.4 Stryker Incremental Mutation Cache
- Mutation testing results are stored in `reports/mutation/stryker-incremental.json`.
- Restores cached mutant test results across commits, allowing Stryker to mutate only changed AST lines rather than cold-starting the full codebase.


### 5.5 Metadata-Only Release PR Fast-Track (Issue #36)
To eliminate redundant, resource-intensive test execution on automated release version bumps while guarding against unexpected payload tampering:
1. **Threat Guard & Metadata Qualification**:
   During the `changes` job (`Detect File Changes`), a pull request qualifies for fast-tracking **only** if all of the following criteria are met:
   - Triggered on `pull_request` event.
   - Head branch matches `release-please--*`.
   - Git diff between the base commit and checked-out PR merge commit (`HEAD^1 HEAD`) contains **exactly** three files with no renames:
     - `.release-please-manifest.json`
     - `CHANGELOG.md`
     - `package.json`
   - `package.json` diff contains **only** a valid non-empty string `version` property change, with all other keys strictly identical (`del(.version)` equality).
   - `.release-please-manifest.json` diff contains **only** a valid non-empty string root `"."` version property change, with all other keys strictly identical (`del(.["."])` equality).
   - The new version string in `package.json` matches the root version in `.release-please-manifest.json` exactly.
2. **Fallback to Full Gates**:
   If a Release PR touches any dependency, script, config, source file, or extra manifest entry—or if the branch was pushed to manually with non-version changes—it fails qualification (`release_pr: false`) and falls back to the ordinary code-changing PR gates (`unit-test`, `e2e-test`, `self-gate`, and `crap-gate`). `mutation-gate` remains disabled for all PRs.
3. **Job Execution Policy**:
   - **Executed**: Packaging sanity gates (`typecheck`, `pr-size`, `installer-gate` matrix across Ubuntu and macOS) run in full to check typings, bundle sizes, and cross-platform installation, including the installed CLI version.
   - **Skipped**: Redundant behavioral suites (`unit-test`, `e2e-test`, `self-gate`, and heavy gate `crap-gate`) are skipped.
4. **Ordinary PRs, Push to Main, & Merge Queue**:
   - Fast-track qualification is strictly limited to `pull_request` events on `release-please--*` branches.
   - Ordinary feature/bugfix PRs, `push` to `main`, and `merge_group` workflows never qualify and continue to use standard change detection, tree verification, and applicable gates.
5. **Cache Note**:
   Eligible fast-track Release PRs intentionally skip creating and saving the `ci-tree-verified-${tree_sha}` cache marker. Because behavioral test suites were skipped in the PR, trunk integrity requires that any subsequent post-merge run on `main` or downstream workflow executes tests without assuming prior full verification.
6. **Aggregator Acceptance**:
   The `Gates Pass` aggregator evaluates `needs.changes.outputs.release_pr == 'true'` and accepts only intentional skips for `unit-test`, `e2e-test`, `self-gate`, and `crap-gate`, while strictly requiring `typecheck`, `pr-size`, and `installer-gate` to succeed.

## 6. Conventional Commits & Automated Versioning

### 6.1 Commit Convention

All pull requests must follow the [Conventional Commits v1.0.0](https://www.conventionalcommits.org/) specification:

```
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

Supported types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

### 6.2 Pre-1.0 Semantic Versioning Policy

Configured via `release-please-config.json`:
- `bump-minor-pre-major: true`: Breaking changes (`feat!:` or `BREAKING CHANGE:`) bump the **minor** version (e.g. `0.1.0` -> `0.2.0`).
- `bump-patch-for-minor-pre-major: true`: Features (`feat:`) and bug fixes (`fix:`) bump the **patch** version (e.g. `0.1.0` -> `0.1.1`).
- Upgrading to `1.0.0` is done explicitly via a commit with the footer `Release-As: 1.0.0`.

### 6.3 Reviewing & Editing Release Notes

1. **PR Titles**: Under squash-merge, the PR title becomes the commit message on `main`. Ensure the PR title accurately describes the change.
2. **Commit Overrides**: For multi-line release notes, include an override block in the PR description:
   ```markdown
   BEGIN_COMMIT_OVERRIDE
   feat(parser): add support for nested template expressions in AST visitor
   END_COMMIT_OVERRIDE
   ```
3. **Release PR Review**: `release-please` maintains an open Release PR. Maintainers can edit `CHANGELOG.md` directly on that PR branch before merging.

### 6.4 Local Git Hooks (Advisory)

Local commit messages are checked with `commitlint` and `lefthook`:
- Config: `commitlint.config.mjs` and `lefthook.yml`.
- To install Git hooks locally: `pnpm exec lefthook install`.

## 7. Distribution & Installation

### 7.1 Release Distribution Tarball

`anti-slop` is distributed as a source package tarball (`anti-slop.tgz`) with cryptographic SHA-256 checksums attached to GitHub Releases:
- Payload size: ~500 KB (excluding tests, fixtures, and artifacts).
- Production install: `pnpm install --prod --frozen-lockfile` (or `npm install --omit=dev`).
- Build: `pnpm run build` generates pre-bundled `dist/cli.js` via esbuild in <10ms.

### 7.2 One-Line Installer (`install.sh`)

Users install `anti-slop` with:

```bash
curl -fsSL https://raw.githubusercontent.com/KonstantinAxt/anti-slop/main/install.sh | bash
```

The script:
1. Detects OS (Linux, macOS) and architecture (x86_64, arm64).
2. Verifies that Node.js (v20+) or Bun is installed.
3. Downloads `anti-slop.tgz` and `checksums.txt` for the requested or latest version.
4. Verifies the SHA-256 checksum.
5. Unpacks into `~/.anti-slop/app`.
6. Runs `pnpm install --prod --frozen-lockfile` (or `npm install --omit=dev`).
7. Links an executable shim to `~/.local/bin/anti-slop`.

---

## 8. Recommended GitHub Repository Settings
To enforce this architecture on GitHub:

1. **Pull Requests**:
   - Settings -> General -> Pull Requests -> Allow squash merging.
   - Default squash commit message: **"Pull request title"**.
2. **Branch Ruleset on `main` (`protect-main`)**:
   - On private personal repositories, GitHub legacy branch protection returns HTTP 403/404, but GitHub Rulesets (`/repos/:owner/:repo/rulesets`) are fully supported.
   - **Conditions**: Target branch `~DEFAULT_BRANCH` (`main`).
   - **Rules**:
     - `deletion`: Restrict branch deletion.
     - `non_fast_forward`: Prevent force pushes.
     - `pull_request`: Require a pull request before merging (disallowing direct pushes).
       - `required_approving_review_count: 0`: Allows solo maintainers and automated bot PRs (release-please, Renovate) to squash-merge without requiring a second human reviewer.
       - `dismiss_stale_reviews_on_push: false`, `require_code_owner_review: false`, `require_last_push_approval: false`, `required_review_thread_resolution: false`.
   - **CI Gating**: PR squash merges are validated through the reusable `.github/workflows/_gates.yml` pipeline (`Gates Pass`), and automated PR merges are gated by the `auto-merge` job in `.github/workflows/ci.yml`. Direct pushes to `main` are rejected by GitHub's pre-receive hook (`GH013`).
   - **Provisioning Script**: Run `./scripts/setup-github-ruleset.sh` to synchronize or verify this ruleset configuration via GitHub CLI (`gh`).
   - **Optional Merge Queue**: When concurrency scaling is required, GitHub Merge Queue can be enabled to serialize and speculatively test PR merges against the latest queued base.
3. **Actions Permissions**:
   - Settings -> Actions -> General -> Workflow permissions: Read and write permissions.
   - Check **"Allow GitHub Actions to create and approve pull requests"** (required for `release-please`).
   - For `release-please` to trigger CI on the Release PR, configure a fine-grained Personal Access Token or GitHub App as `RELEASE_TOKEN` in repository secrets.
