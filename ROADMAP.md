# anti-slop Roadmap

This document outlines the strategic priorities, active initiatives, and long-term research directions for **anti-slop**.

We use the industry-standard **Now / Next / Later** horizon framework rather than rigid calendar deadlines. This maintains agility while offering transparency to contributors and adopting teams.

To propose a new feature or detector, please follow the intake process described in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Strategic Pillars

1. **Precision Defect Detection (Zero False Positives)**: High-confidence static analysis targeting AI-generated anti-patterns, hollow tests, and subtle type-boundary leaks.
2. **Deep Verification & Metrics**: Combining AST analysis with empirical measures (Change Risk Anti-Patterns / CRAP score and Stryker mutation testing).
3. **Seamless DX & Agent Integration**: Frictionless local developer feedback (`--staged`, `--since`) and machine/LLM-ready outputs (`--llm`, `--json`) for AI coding harnesses.

---

## Horizons

```
┌──────────────────────────┬──────────────────────────┬──────────────────────────┐
│         🟢 NOW           │         🟡 NEXT          │         ⚪ LATER         │
│   (Current Iteration)    │   (Accepted / Planned)   │  (Exploration & Future)  │
└──────────────────────────┴──────────────────────────┴──────────────────────────┘
```

### 🟢 Now (Current Iteration / Target v0.2.0)

- [ ] **Community & Intake Governance**:
  - Structured issue forms for rule proposals and feature requests.
  - Public GitHub Discussions with upvoting for community brainstorming.
- [ ] **CRAP Metric Runner Hardening**:
  - Robust Jest and Vitest coverage file discovery.
  - Cyclomatic complexity threshold configurability via `.anti-sloprc.json`.
- [ ] **Staged & Incremental Performance**:
  - Optimization of AST traversal on git diff ranges (`--staged`, `--since origin/main`).
  - Cache AST parsing between local runs.
- [ ] **LLM Prompt Formatting Refinement**:
  - Standardized diagnostic block output optimized for automated repair loops in AI harnesses.

### 🟡 Next (Accepted / Planned)

- [ ] **Custom Rule Engine / Ast-Grep Integration**:
  - Declarative YAML/JSON rule authoring allowing repositories to define custom slop rules without modifying anti-slop core.
- [ ] **Multi-Test Runner Coverage Parsing**:
  - Native parser for Bun test coverage outputs and Playwright coverage reports.
- [ ] **Interactive TUI Mode**:
  - Terminal-based interactive triage (`anti-slop --interactive`) to review, accept, or ignore diagnostics per file.
- [ ] **GitHub Action & SARIF Reporter**:
  - First-class GitHub Action with SARIF export for native GitHub Security & Code Scanning tab integration.
  - Automated PR review annotations.

### ⚪ Later (Exploration & Future Research)

- [ ] **Multi-Language Defect Guarding**:
  - Evaluate tree-sitter or LSP-based detectors for Python and Go codebases.
- [ ] **Targeted AI Mutation Generation**:
  - Automatic synthesis of targeted mutants for functions flagged with high CRAP scores to test critical coverage holes.
- [ ] **Autonomous LLM Self-Healing Pipeline**:
  - An optional flag (`anti-slop --fix-with-llm`) that orchestrates local model generation to repair detected slop and verify with passing tests.

---

## Contributing to the Roadmap

The roadmap is a living document shaped by community feedback:
- **Vote on Ideas**: Browse [GitHub Discussions: Ideas](https://github.com/KonstantinAxt/anti-slop/discussions/categories/ideas) and upvote features you want prioritized.
- **Submit Proposals**: Open an issue using the [Feature Request Form](https://github.com/KonstantinAxt/anti-slop/issues/new?template=feature_request.yml) or [Rule Proposal Form](https://github.com/KonstantinAxt/anti-slop/issues/new?template=rule_proposal.yml).
- **Propose Architectural Changes**: Start an RFC in [GitHub Discussions: Architecture & RFCs](https://github.com/KonstantinAxt/anti-slop/discussions).
