#!/usr/bin/env bash
set -euo pipefail

# Prune old backup releases from GitHub, retaining:
# - Last 14 dailies (most recent 14 days)
# - Of releases older than 14 days: 1 per week for last 8 weeks
# - Of releases older than 8 weeks: 1 per month for last 6 months
# - Delete the rest

echo "=== Backup release pruning ==="

# Fetch all releases with backup- prefix, newest first
echo "Fetching release list..."
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
RELEASES=$(gh release list --limit 200 --json createdAt,tagName,name \
  --jq '.[] | select(.tagName | startswith("backup-")) | "\(.createdAt) \(.tagName)"' \
  --repo "$REPO")

if [ -z "$RELEASES" ]; then
  echo "No backup releases found."
  exit 0
fi

# Sort newest first (dates are ISO, lexicographic sort works)
RELEASES=$(echo "$RELEASES" | sort -r)

NOW=$(date -u +%s)
KEEP_TAGS=()
DELETE_TAGS=()

# Track which week/month we've already kept for weekly/monthly retention
declare -a KEPT_WEEKS=()
declare -a KEPT_MONTHS=()

DAILY_COUNT=0
CUTOFF_14_DAYS=$((NOW - 14 * 86400))
CUTOFF_8_WEEKS=$((NOW - 8 * 7 * 86400))
CUTOFF_6_MONTHS=$((NOW - 6 * 30 * 86400))

while IFS= read -r line; do
  if [ -z "$line" ]; then continue; fi
  
  ISO_DATE="${line%% *}"
  TAG="${line##* }"
  RELEASE_TS=$(date -u -d "$ISO_DATE" +%s 2>/dev/null || echo "0")
  
  if [ "$RELEASE_TS" = "0" ]; then
    echo "⚠ Skipping $TAG (date parse failed)"
    continue
  fi
  
  AGE_DAYS=$(( (NOW - RELEASE_TS) / 86400 ))
  
  # Rule 1: Keep last 14 dailies
  if [ "$DAILY_COUNT" -lt 14 ]; then
    echo "✓ KEEP $TAG (daily #$((DAILY_COUNT + 1))/14, ${AGE_DAYS}d old)"
    KEEP_TAGS+=("$TAG")
    ((DAILY_COUNT++))
    continue
  fi
  
  # Rule 2: Older than 14 days, keep 1 per week for 8 weeks
  if [ "$RELEASE_TS" -gt "$CUTOFF_8_WEEKS" ]; then
    WEEK_NUM=$(date -u -d @"$RELEASE_TS" +%V)
    YEAR_NUM=$(date -u -d @"$RELEASE_TS" +%Y)
    WEEK_KEY="$YEAR_NUM-$WEEK_NUM"
    
    if [[ ! " ${KEPT_WEEKS[*]:-} " =~ " ${WEEK_KEY} " ]]; then
      echo "✓ KEEP $TAG (weekly keeper, week $WEEK_KEY, ${AGE_DAYS}d old)"
      KEEP_TAGS+=("$TAG")
      KEPT_WEEKS+=("$WEEK_KEY")
      continue
    fi
  fi
  
  # Rule 3: Older than 8 weeks, keep 1 per month for 6 months
  if [ "$RELEASE_TS" -gt "$CUTOFF_6_MONTHS" ]; then
    MONTH_NUM=$(date -u -d @"$RELEASE_TS" +%Y%m)
    
    if [[ ! " ${KEPT_MONTHS[*]:-} " =~ " ${MONTH_NUM} " ]]; then
      echo "✓ KEEP $TAG (monthly keeper, month $MONTH_NUM, ${AGE_DAYS}d old)"
      KEEP_TAGS+=("$TAG")
      KEPT_MONTHS+=("$MONTH_NUM")
      continue
    fi
  fi
  
  # Default: delete
  echo "✗ DELETE $TAG (${AGE_DAYS}d old, retention policy not met)"
  DELETE_TAGS+=("$TAG")
done <<< "$RELEASES"

echo ""
echo "Summary: keeping ${#KEEP_TAGS[@]}, deleting ${#DELETE_TAGS[@]}"

# Delete releases
for TAG in "${DELETE_TAGS[@]}"; do
  echo "Deleting $TAG..."
  gh release delete "$TAG" --yes --repo "$REPO"
done

echo "=== Pruning complete ==="
