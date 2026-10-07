#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-KonstantinAxt/anti-slop}"

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
  echo "Syncing label: $name"
  gh label create "$name" --color "$color" --description "$desc" --repo "$REPO" --force || true
done
echo "All labels synchronized successfully."
