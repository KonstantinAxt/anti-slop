# anti-slop Documentation

This directory contains technical guides and architectural documentation for the advanced verification checks in `anti-slop`.

While standard linters detect syntactic defects and formatting errors, `anti-slop` provides specialized gates to evaluate **test veracity**, **change risk**, and **code architecture** before pull requests undergo human review.

---

## Technical Guides

### 1. [Mutation Testing (`mutation-testing.md`)](./mutation-testing.md)
Learn how `anti-slop` uses [Stryker Mutator](https://stryker-mutator.io/) to evaluate test suite quality through deliberate fault injection.

- **Basic Concepts**: What mutants are, mutant states (Killed, Survived, No Coverage), and why code coverage is insufficient.
- **Why We Add It**: Eliminating hollow assertions (`toBeDefined`, `toHaveBeenCalled`), detecting inverted conditions and off-by-one errors.
- **Metrics & Findings**: Interpreting the Mutation Score, `mutation-test/surviving-mutant`, `mutation-test/uncovered-mutant`, and mutator types.
- **Remediation & Next Steps**: Step-by-step workflow for killing surviving mutants with targeted assertions.
- **Further Readings**: Foundational papers and industry resources on mutation analysis.

### 2. [CRAP Metric (Change Risk Anti-Pattern) (`crap-metric.md`)](./crap-metric.md)
Learn how `anti-slop` evaluates change risk by combining Cyclomatic Complexity with line test coverage.

- **Basic Concepts**: The CRAP formula ($\text{CRAP} = \text{CC}^2 \times (1 - \text{cov})^3 + \text{CC}$), why complexity is penalized quadratically, and why coverage pays off cubically.
- **Why We Add It**: Finding fragile, untested "God functions" and preventing regressions in high-churn code.
- **Metrics & Findings**: Risk tiers (Low $\le 5$, Moderate $5-30$, High $> 30$), `crap-metric/high-crap-risk`, and the Uncle Bob tabular report.
- **Remediation & Next Steps**: Practical guide to lowering CRAP scores by either refactoring complexity or writing targeted branch tests.
- **Further Readings**: Original papers by Alberto Savoia, Bob Evans, and Thomas McCabe.

### 3. [Fractal Architecture (`fractal-architecture.md`)](./fractal-architecture.md)
Learn how `anti-slop` enforces Fractal Architecture Framework (FAF) and Domain-Fractal React Architecture (DFRA) structural invariants.

- **Basic Concepts**: Recursive self-similarity, fragment encapsulation, public access nodes, and private fractal branches (`@Scope`, `__scope`).
- **Why We Add It**: Eliminating lateral coupling, preventing circular imports, and stopping architectural decay across nested modules.
- **Metrics & Findings**: The four invariants: `fractal/no-direct-fragment-import`, `fractal/no-private-leak`, `fractal/no-upward-dependency`, and `fractal/peer-isolation`.
- **Remediation & Next Steps**: Practical guide to re-exporting through public index barrels, hoisting to `__shared`, and passing state via props.
- **Further Readings**: FAF, DFRA, and Robert C. Martin's component coupling principles.

### 4. [CI/CD Process & Architecture (`ci-cd.md`)](./ci-cd.md)
Learn how `anti-slop` implements continuous integration and hygiene pipelines on GitHub Actions using the native Bun runtime.

- **Architecture Overview**: Fast-fail static validation (`typecheck`) paired with deep test suites (`bun test`).
- **Nightly Hygiene**: Scheduled CRAP metric audits and dataset integrity verification.
- **Local vs. CI Mapping**: Parity commands for developers prior to PR submission.

### 5. [GitHub Governance & Idea Intake (`github-governance-and-intake.md`)](./github-governance-and-intake.md)
Learn how `anti-slop` administers community proposals, GitHub Discussions, issue forms, and project boards.

- **3-Tier Intake Funnel**: Discussions (Tier 1) -> Issue Forms (Tier 2) -> Projects/Roadmap (Tier 3).
- **Label Taxonomy**: Prefixed categorization across `kind/`, `status/`, and `area/`.
- **Automation**: One-command synchronization of labels using GitHub CLI (`gh`).
- **GitHub Projects (v2)**: Kanban setup with horizon and effort fields.
---

## Comparison Matrix

| Check | What It Measures | Question It Answers | When to Run | Primary Remediation |
|---|---|---|---|---|
| **ESLint & Strict TS** | Static syntax and type constraints | *"Does this code follow safety and style rules?"* | Every commit & save | Fix typing, syntax, or configuration |
| **Traditional Coverage** | Line / branch execution | *"Did our test run through this line of code?"* | Continuous integration | Write a test that exercises the line |
| **Mutation Testing** | Test assertion veracity | *"Will our tests fail if this line contains a bug?"* | PR / Pre-review (`--mutation`) | Add specific assertions for invariants |
| **CRAP Metric** | Change fragility and risk | *"Is this method too complex to modify safely without tests?"* | PR / Pre-review (`--crap`) | Reduce CC (refactor) or add branch tests |
| **Fractal Architecture** | Structural encapsulation and hierarchy | *"Do modules respect encapsulation, access nodes, and peer isolation?"* | Every commit & PR | Re-export via index, hoist to `__shared`, or use props |
---

## Quick Reference CLI Commands

```bash
# Run mutation testing on files changed against origin/main
anti-slop --mutation --since origin/main

# Run CRAP analysis on files changed against origin/main
anti-slop --crap --since origin/main

# Run CRAP analysis with custom threshold (e.g. 25)
anti-slop --crap --crap-threshold 25 --since origin/main

# Run both mutation and CRAP checks simultaneously
anti-slop --mutation --crap --since origin/main

# Output combined results as JSON for automated pipelines
anti-slop --crap --mutation --since origin/main --json > audit.json
```

