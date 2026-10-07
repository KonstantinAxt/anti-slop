# Contributing to anti-slop

Thank you for your interest in contributing to **anti-slop**!

anti-slop is a CLI tool and gatekeeper designed to catch objective defects, AI-generated slop, hollow tests, and architectural traps in source code before code review, without modifying the target repository's dependencies or build scripts.

---

## 1. How to Share Ideas and Propose Features

We use a 3-tier intake process to keep community discussions open while keeping our issue tracker actionable:

```
[ Tier 1: Discussions (Ideas) ] ──> [ Tier 2: Issue Forms ] ──> [ Tier 3: Roadmap & PRs ]
   (Brainstorm & Community Vote)       (Formal Specification)        (Implementation)
```

### Tier 1: Ideas & Brainstorming
- **Where**: [GitHub Discussions — Ideas](https://github.com/KonstantinAxt/anti-slop/discussions/categories/ideas)
- **When to use**:
  - You have an unformed idea or general improvement concept.
  - You want to gauge interest from other users or maintainers.
  - You want feedback on an experimental detection pattern before writing AST logic.
- Community members can upvote and discuss ideas. Highly upvoted or maintainer-endorsed ideas advance to Tier 2.

### Tier 2: Formal Issue Forms
- **Where**: [GitHub Issues](https://github.com/KonstantinAxt/anti-slop/issues/new/choose)
- **Templates available**:
  - **🎯 New Rule / Detector Proposal**: For AST rules catching defects, slop, or bad practices.
  - **🚀 Feature / Improvement Request**: For CLI flags, reporting formats, coverage/CRAP calculation, or Stryker mutation engine.
  - **🐛 Bug Report / False Positive**: For crashes, false negatives, or valid code flagged incorrectly.
- *Note*: Blank issues are disabled to ensure all proposals provide minimal reproducible examples and unambiguous motivation.

### Tier 3: Request for Comments (RFC)
- For broad architectural changes (e.g., adding multi-language support beyond TypeScript, introducing a plugin ecosystem, or overhauling the reporting pipeline), submit an RFC proposal in [GitHub Discussions — Architecture & RFCs](https://github.com/KonstantinAxt/anti-slop/discussions).

---

## 2. Rule Proposal & Acceptance Criteria

`anti-slop` has a strict bar for adding new rules or defect checks:

1. **Zero False Positives**:
   A rule that flags legitimate, well-written code will frustrate developers and be disabled. If an edge case cannot be safely distinguished at the AST or type level, the rule will not be accepted as an `error`.
2. **Defect or LLM Slop Specificity**:
   Rules must address concrete failure modes (e.g. unasserted mocks, hollow test assertions, untyped function boundaries, high-CRAP complexity) rather than stylistic preferences.
3. **Reproducible Counter-Examples**:
   Every proposed rule must provide:
   - **Invalid snippet(s)**: Code patterns that must trigger the rule.
   - **Valid snippet(s)**: Semantically similar patterns that must pass without warning.
4. **Performance & AST Efficiency**:
   AST queries run across large codebases in milliseconds. Detectors must avoid unindexed full-tree walks or redundant computations.

---

## 3. Local Development Setup
`anti-slop` is built with Node.js, TypeScript, and **pnpm**.

### Prerequisites
- Node.js (v20+ recommended)
- [pnpm](https://pnpm.io/) (v10+ recommended)
- Git (configured with worktrees)

### Getting Started
```bash
# Clone the repository
git clone https://github.com/KonstantinAxt/anti-slop.git
cd anti-slop

# Install dependencies
pnpm install

# Run the test suite
pnpm test
```

### Git Worktree Policy
When developing new features or rules, keep your work isolated using git worktrees:
```bash
git worktree add -b feat/your-feature-name ../anti-slop-your-feature main
cd ../anti-slop-your-feature
pnpm install
```

## 4. Directory Layout Conventions

- `src/`: Core CLI logic, AST checks, runners, and reporter implementations.
- `tests/`: Automated unit and integration tests run via `pnpm test` (Vitest).
- `e2e-fixtures/`: Intentional negative test fixtures (syntax errors, missing properties, loose TS).
  > **Important**: Do not move `e2e-fixtures/` into `tests/`. It is excluded from root `tsconfig.json` and test runner discovery by design.
- `documentation/`: Architecture decision records, metric guides (CRAP, mutation testing), and specifications.
---

## 5. Pre-Submission Checklist

Before opening a pull request, ensure your changes pass all verification gates:

```bash
# 1. Typecheck the codebase
pnpm exec tsc --noEmit

# 2. Run unit and integration tests
pnpm test

# 3. Dogfood anti-slop against itself
pnpm run build && node --import tsx bin/anti-slop.ts --staged
```

All contributions must pass with **0 errors and 0 warnings**.
