# GitHub Governance & Idea Intake Guide

This document describes how to configure and administer the **anti-slop** GitHub repository (`https://github.com/KonstantinAxt/anti-slop`) to manage community ideas, feature requests, and issue workflows according to industry standards.

---

## 1. Overview: The 3-Tier Intake Funnel

To prevent issue backlog fatigue, maintain high quality, and ensure every accepted item is actionable:

```
┌─────────────────────────────────┐
│  Tier 1: GitHub Discussions     │  --> Open-ended brainstorming, idea polling, RFCs
└────────────────┬────────────────┘
                 │ (Promoted / Upvoted)
┌────────────────▼────────────────┐
│  Tier 2: GitHub Issue Forms     │  --> Structured specifications with invalid/valid examples
└────────────────┬────────────────┘
                 │ (Accepted by Maintainers)
┌────────────────▼────────────────┐
│  Tier 3: GitHub Projects (v2)   │  --> Now / Next / Later Roadmap & Kanban execution
└─────────────────────────────────┘
```

---

## 2. GitHub Web Settings Setup

### A. Enable GitHub Discussions
1. Go to repository **Settings** > **General** > **Features**.
2. Check the box for **Discussions**.
3. Under the **Discussions** tab, configure the following categories:
   - 💡 **Ideas** *(Format: Open Discussion, Voting enabled)*: For community suggestions and concept exploration.
   - 🏗️ **Architecture & RFCs** *(Format: Open Discussion)*: For cross-cutting structural proposals.
   - 💬 **Q&A** *(Format: Question / Answer)*: For usage questions and setup help.
   - 🎉 **Show & Tell** *(Format: Open Discussion)*: For sharing success stories and repository configs.

### B. Issue Templates Verification
Once `.github/ISSUE_TEMPLATE/` is pushed to `main`, GitHub will automatically display:
- **🎯 New Rule / Detector Proposal**
- **🚀 Feature / Improvement Request**
- **🐛 Bug Report / False Positive**
- Direct links to **Ideas** in Discussions (blank issues disabled via `config.yml`).

---

## 3. Label Taxonomy

The repository uses prefix-based namespacing for issue and PR categorization:

| Category | Label | Color | Description |
|---|---|---|---|
| **Kind** | `kind/rule-proposal` | `#0E8A16` | Proposal for a new defect or slop detector |
| | `kind/feature` | `#1D76DB` | Feature or capability request |
| | `kind/bug` | `#D93F0B` | Bug, crash, or unexpected behavior |
| | `kind/false-positive` | `#E99695` | Valid code incorrectly flagged by a rule |
| | `kind/documentation` | `#0075CA` | Documentation improvements or guides |
| | `kind/refactor` | `#C5DEF5` | Internal refactoring without behavior change |
| | `kind/perf` | `#5319E7` | Performance improvements (AST traversal, caching) |
| **Status** | `status/triage` | `#FBCA04` | Awaiting initial review and classification |
| | `status/rfc-needed` | `#F9D0C4` | Needs formal RFC or architectural discussion |
| | `status/accepted` | `#0E8A16` | Approved for implementation; ready on backlog |
| | `status/in-progress` | `#BFDADC` | Currently being worked on |
| | `status/blocked` | `#B60205` | Blocked on external dependency or discussion |
| **Area** | `area/rules` | `#D4C5F9` | AST detector rules and pattern matching |
| | `area/cli` | `#C2E0C6` | CLI arguments, execution flags, and options |
| | `area/crap-metric` | `#FEF2C0` | CRAP metric and cyclomatic complexity |
| | `area/mutation` | `#BFDADC` | Stryker mutation testing engine |
| | `area/strict-ts` | `#1D76DB` | Strict TypeScript boundary analysis |
| | `area/reporters` | `#D4C5F9` | JSON, terminal, and LLM prompt reporters |
| | `area/ci` | `#E99695` | GitHub Actions, nightly hygiene, and release flows |
| **Community** | `good first issue` | `#7057FF` | Good for newcomers to the project |
| | `help wanted` | `#008672` | Extra attention is needed from the community |

---

## 4. Automation: Provisioning Labels with GitHub CLI

You can provision or synchronize all repository labels instantly using the GitHub CLI (`gh`).

Run this script from the repository root:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO="KonstantinAxt/anti-slop"

declare -a LABELS=(
  "kind/rule-proposal:0E8A16:Proposal for a new defect or slop detector"
  "kind/feature:1D76DB:Feature or capability request"
  "kind/bug:D93F0B:Bug, crash, or unexpected behavior"
  "kind/false-positive:E99695:Valid code incorrectly flagged by a rule"
  "kind/documentation:0075CA:Documentation improvements or guides"
  "kind/refactor:C5DEF5:Internal refactoring without behavior change"
  "kind/perf:5319E7:Performance improvements (AST traversal, caching)"
  "status/triage:FBCA04:Awaiting initial review and classification"
  "status/rfc-needed:F9D0C4:Needs formal RFC or architectural discussion"
  "status/accepted:0E8A16:Approved for implementation; ready on backlog"
  "status/in-progress:BFDADC:Currently being worked on"
  "status/blocked:B60205:Blocked on external dependency or discussion"
  "area/rules:D4C5F9:AST detector rules and pattern matching"
  "area/cli:C2E0C6:CLI arguments, execution flags, and options"
  "area/crap-metric:FEF2C0:CRAP metric and cyclomatic complexity"
  "area/mutation:BFDADC:Stryker mutation testing engine"
  "area/strict-ts:1D76DB:Strict TypeScript boundary analysis"
  "area/reporters:D4C5F9:JSON, terminal, and LLM prompt reporters"
  "area/ci:E99695:GitHub Actions, nightly hygiene, and release flows"
  "good first issue:7057FF:Good for newcomers to the project"
  "help wanted:008672:Extra attention is needed from the community"
)

echo "Provisioning labels for $REPO..."
for entry in "${LABELS[@]}"; do
  IFS=":" read -r name color desc <<< "$entry"
  gh label create "$name" --color "$color" --description "$desc" --repo "$REPO" --force || true
done
echo "All labels synchronized."
```

---

## 5. GitHub Projects (v2) Setup

Link a GitHub Project board to the `anti-slop` repository:

1. **Board Layout (Kanban)**:
   - `📥 Triage`: Issues labeled `status/triage`.
   - `📋 Backlog`: Issues labeled `status/accepted`.
   - `🚧 In Progress`: Active branches / assigned work.
   - `🧪 Review`: Pull requests undergoing review and CI checks.
   - `🚀 Shipped`: Merged items released in target version.

2. **Custom Fields**:
   - `Horizon`: Single select (`Now`, `Next`, `Later`).
   - `Effort`: Single select (`XS`, `S`, `M`, `L`, `XL`).
   - `Impact`: Single select (`High`, `Medium`, `Low`).

3. **Automation Rules**:
   - Auto-add issues to the project board when opened.
   - Set status to `Done` when an associated pull request merges to `main`.
