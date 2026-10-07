Default to using pnpm and Node.js with Vitest.

- Use `pnpm <script>` instead of `npm <script>` or `yarn <script>`
- Use `pnpm test` (or `vitest run`) instead of `jest` or `bun test`
- Use `pnpm install` instead of `npm install`, `yarn install`, or `bun install`
- Use `pnpm dlx <package> <command>` or `pnpm exec <command>` instead of `npx` or `bunx`
- Use `node --import tsx <file>` or `tsx <file>` to run TypeScript files directly without an upfront compilation step

## Testing

Use `pnpm test` or `pnpm run test:unit` to run tests via Vitest.

```ts#index.test.ts
import { test, expect, describe, it } from "vitest";

describe("example", () => {
  it("verifies behavior", () => {
    expect(1).toBe(1);
  });
});
```

Mutation testing uses Stryker with `@stryker-mutator/vitest-runner` (`coverageAnalysis: "perTest"`).

## Git Workflows

When implementing new features, always create a new branch and use git worktrees to keep work isolated and avoid colliding with other sessions.

## Documentation

If you add a new rule to anti-slop, you must document that rule in `README.md`.

## Verification

After you change code, make sure that the project passes TypeScript checks, the linter, and anti-slop.
You must correct all reported errors and warnings before you finish your work.

## Directory Layout & Isolation

### `e2e-fixtures/` (Must Remain at Repository Root)
Do NOT move `e2e-fixtures/` into `tests/`. This separation is deliberate:
- **TypeScript Isolation (`tsconfig.json`)**: Contains intentional syntax errors, missing properties, invalid types, and broken project configs. The root `tsconfig.json` explicitly excludes `e2e-fixtures` so `pnpm exec tsc --noEmit` checks real codebase files without failing on fixture code.
- **Test Runner Discovery Isolation (`vitest run`)**: Contains intentionally flawed test files (e.g., test suites with no assertions, focused tests, and stale mocks) used by CLI rule tests. If placed in `tests/`, test runners would auto-discover and execute them, failing the test suite.
- **Dogfooding Self-Gate Isolation**: `src/index.ts` excludes `e2e-fixtures` via `IGNORED_DIRS` so `anti-slop` can scan itself without triggering on negative test fixtures.

## Community, Issues & Feature Intake

When proposing new rules, filing issues, planning roadmap items, or contributing discussions, follow the 3-tier intake funnel and templates:

- **Guidance & Governance**: See `documentation/github-governance-and-intake.md` for discussion categories, project board layout, and triage rituals.
- **Issue Templates**: Check `.github/ISSUE_TEMPLATE/` for structured forms:
  - `rule_proposal.yml`: Required for AST detector proposals (needs valid/invalid code examples and rationale).
  - `feature_request.yml`: For CLI capabilities, new flags, and engine features.
  - `bug_report.yml`: For crashes and false-positive reports.
- **Contributing Guidelines**: See `CONTRIBUTING.md` for zero-false-positive acceptance criteria and PR guidelines.
- **Roadmap**: See `ROADMAP.md` for current Now / Next / Later horizons before proposing large initiatives.
- **Discussions vs. Issues**: Use GitHub Discussions for brainstorming, ideas, and RFCs. Use GitHub Issues only for concrete, actionable bugs, accepted feature specs, or structured rule proposals.
- **Label Automation**: Run `scripts/setup-github-labels.sh` to synchronize or inspect the repository's `kind/*`, `status/*`, and `area/*` labels.
