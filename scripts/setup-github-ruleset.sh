#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-KonstantinAxt/anti-slop}"
RULESET_NAME="protect-main"

echo "Checking existing rulesets for $REPO..."
RULESET_ID=$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$RULESET_NAME\") | .id" || true)

PAYLOAD=$(cat <<'EOF'
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": [
        "~DEFAULT_BRANCH"
      ],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "deletion"
    },
    {
      "type": "non_fast_forward"
    },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    }
  ],
  "bypass_actors": []
}
EOF
)

if [ -n "$RULESET_ID" ]; then
  echo "Updating existing ruleset $RULESET_ID ($RULESET_NAME)..."
  gh api --method PUT "repos/$REPO/rulesets/$RULESET_ID" --input - <<< "$PAYLOAD" > /dev/null
  echo "Successfully updated ruleset $RULESET_ID."
else
  echo "Creating ruleset $RULESET_NAME..."
  gh api --method POST "repos/$REPO/rulesets" --input - <<< "$PAYLOAD" > /dev/null
  echo "Successfully created ruleset $RULESET_NAME."
fi
