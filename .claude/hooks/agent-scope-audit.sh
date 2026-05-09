#!/usr/bin/env bash
# SubagentStop hook: audits files touched by a subagent against its declared allowed_paths lane.
# Never blocks — exits 0 always. Logs errors to /tmp/claude-agent-audit-debug.log.

set -uo pipefail

LOG=/tmp/claude-agent-audit-debug.log
AGENTS_DIR="/home/hadassi/Code/kit_tracker/.claude/agents"

log_debug() { echo "[agent-scope-audit] $*" >> "$LOG" 2>/dev/null || true; }

emit() { echo "$1"; exit 0; }

# Failsafe wrapper
{

INPUT=$(cat)
log_debug "Input: $INPUT"

# Extract fields from hook input
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null || echo "unknown")
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // .subagent_type // ""' 2>/dev/null || echo "")
WORKTREE=$(echo "$INPUT" | jq -r '.worktree // .cwd // .working_directory // ""' 2>/dev/null || echo "")

log_debug "session_id=$SESSION_ID agent_type=$AGENT_TYPE worktree=$WORKTREE"

# If no worktree path, try to derive from session tasks directory
if [ -z "$WORKTREE" ]; then
  # Check common worktree patterns
  CANDIDATE=$(find /home/hadassi/Code/kit_tracker/.claude/worktrees -maxdepth 1 -type d -name "agent-*" 2>/dev/null | head -1)
  if [ -n "$CANDIDATE" ]; then
    WORKTREE="$CANDIDATE"
    log_debug "Derived worktree: $WORKTREE"
  fi
fi

if [ -z "$WORKTREE" ] || [ ! -d "$WORKTREE" ]; then
  log_debug "No worktree found — skipping audit"
  emit '{"systemMessage": "agent-scope-audit: no worktree path in hook input — skipped"}'
fi

# Get list of files touched by this agent vs origin/main
cd "$WORKTREE" || { log_debug "Cannot cd to $WORKTREE"; emit '{"systemMessage": "agent-scope-audit: cannot access worktree — skipped"}'; }

# Determine merge base
MERGE_BASE=$(git merge-base HEAD origin/main 2>/dev/null || echo "")
if [ -z "$MERGE_BASE" ]; then
  log_debug "Cannot determine merge base"
  emit '{"systemMessage": "agent-scope-audit: cannot determine merge base — skipped"}'
fi

TOUCHED_FILES=$(git diff --name-only "$MERGE_BASE" HEAD 2>/dev/null || echo "")
log_debug "Touched files: $TOUCHED_FILES"

if [ -z "$TOUCHED_FILES" ]; then
  emit '{"systemMessage": "agent-scope-audit: ✓ no files changed — clean"}'
fi

# If we don't know agent type, can't check lane
if [ -z "$AGENT_TYPE" ]; then
  log_debug "No agent_type in input — cannot check lane"
  TOUCHED_LIST=$(echo "$TOUCHED_FILES" | head -5 | tr '\n' ' ')
  emit "{\"systemMessage\": \"agent-scope-audit: agent type unknown — touched files: $TOUCHED_LIST\"}"
fi

# Read allowed_paths from agent frontmatter
AGENT_FILE="$AGENTS_DIR/${AGENT_TYPE}.md"
if [ ! -f "$AGENT_FILE" ]; then
  log_debug "Agent file not found: $AGENT_FILE"
  emit "{\"systemMessage\": \"agent-scope-audit: unknown agent type '$AGENT_TYPE' — cannot check lane\"}"
fi

# Parse allowed_paths from YAML frontmatter using awk + grep
ALLOWED_JSON=$(awk '/^---/{f++} f==1{print} f==2{exit}' "$AGENT_FILE" | grep '^allowed_paths:' | sed 's/^allowed_paths:[[:space:]]*//')
log_debug "Allowed paths JSON: $ALLOWED_JSON"

# If empty array or not found, treat as empty
if [ -z "$ALLOWED_JSON" ] || [ "$ALLOWED_JSON" = "[]" ]; then
  # Read-only agent — any edit is a violation
  COUNT=$(echo "$TOUCHED_FILES" | wc -l | tr -d ' ')
  SAMPLE=$(echo "$TOUCHED_FILES" | head -5 | tr '\n' ', ' | sed 's/,$//')
  emit "{\"systemMessage\": \"⚠ agent $AGENT_TYPE ($SESSION_ID) touched $COUNT files but has empty allowed_paths (read-only): $SAMPLE; verify before merging\"}"
fi

# Extract patterns from JSON array using python3 (available on this system)
PATTERNS=$(python3 -c "
import json, sys
try:
    data = json.loads(sys.argv[1])
    print('\n'.join(data))
except Exception as e:
    sys.exit(1)
" "$ALLOWED_JSON" 2>/dev/null)

if [ $? -ne 0 ]; then
  log_debug "Failed to parse allowed_paths JSON: $ALLOWED_JSON"
  emit '{"systemMessage": "agent-scope-audit: failed to parse allowed_paths — skipped"}'
fi

log_debug "Patterns: $PATTERNS"

# For each touched file, check if it matches any allowed pattern
shopt -s extglob

VIOLATIONS=()
while IFS= read -r FILE; do
  [ -z "$FILE" ] && continue
  MATCHED=0
  while IFS= read -r PATTERN; do
    [ -z "$PATTERN" ] && continue
    # Use bash glob matching with fnmatch-style patterns
    # Convert glob to bash pattern: ** matches any path segments
    if [[ "$FILE" == $PATTERN ]]; then
      MATCHED=1
      break
    fi
    # Try with fnmatch via python for ** glob support
    MATCH=$(python3 -c "
import fnmatch, sys
file, pattern = sys.argv[1], sys.argv[2]
# fnmatch doesn't support **, do manual check
if '**' in pattern:
    # Split on ** and check prefix/suffix
    parts = pattern.split('**')
    if len(parts) == 2:
        prefix, suffix = parts[0].rstrip('/'), parts[1].lstrip('/')
        if prefix and not file.startswith(prefix + '/') and file != prefix:
            print('0'); sys.exit()
        if suffix and not (file.endswith('/' + suffix) or file == suffix or fnmatch.fnmatch(file.split('/')[-1], suffix)):
            print('0'); sys.exit()
        print('1')
    else:
        print('1' if fnmatch.fnmatch(file, pattern.replace('**', '*')) else '0')
else:
    print('1' if fnmatch.fnmatch(file, pattern) else '0')
" "$FILE" "$PATTERN" 2>/dev/null)
    if [ "$MATCH" = "1" ]; then
      MATCHED=1
      break
    fi
  done <<< "$PATTERNS"
  
  if [ "$MATCHED" -eq 0 ]; then
    VIOLATIONS+=("$FILE")
  fi
done <<< "$TOUCHED_FILES"

VCOUNT=${#VIOLATIONS[@]}
if [ "$VCOUNT" -eq 0 ]; then
  emit "{\"systemMessage\": \"✓ agent $AGENT_TYPE ($SESSION_ID) stayed in lane\"}"
fi

# Build violation list (max 5)
VLIST=$(printf '%s\n' "${VIOLATIONS[@]}" | head -5 | tr '\n' ', ' | sed 's/,$//')
emit "{\"systemMessage\": \"⚠ agent $AGENT_TYPE ($SESSION_ID) touched $VCOUNT files outside declared lane: $VLIST; verify before merging\"}"

} 2>>"$LOG" || {
  log_debug "Script error — bailing out safely"
  echo '{"systemMessage": "agent-scope-audit: script error — see /tmp/claude-agent-audit-debug.log"}'
  exit 0
}
