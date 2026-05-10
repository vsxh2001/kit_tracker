#!/bin/bash
set -euo pipefail

# Deterministic port assignment for worktrees.
# Detects current worktree, assigns unique ports based on offset from ports.json registry.
# Outputs environment variables for docker-compose, PocketBase, Vite, etc.

# Get the current worktree root first (this works for both main and worktrees)
CURRENT_WORKTREE="$(git rev-parse --show-toplevel)"

# Get the common git directory and resolve to absolute path
GIT_COMMON_DIR="$(git rev-parse --git-common-dir)"
if [[ "$GIT_COMMON_DIR" != /* ]]; then
  # Relative path; make it absolute
  GIT_COMMON_DIR="$(cd "$GIT_COMMON_DIR" 2>/dev/null && pwd)" || GIT_COMMON_DIR="$CURRENT_WORKTREE/$GIT_COMMON_DIR"
fi

REPO_ROOT="${GIT_COMMON_DIR%/.git}"  # Remove /.git suffix
PORTS_REGISTRY="${REPO_ROOT}/.claude/ports.json"

# Derive a simple worktree identifier
if [ "$CURRENT_WORKTREE" == "$REPO_ROOT" ]; then
  WORKTREE_NAME="main"
else
  # Extract basename (e.g., "feat-mobile-responsive" from ".../.claude/worktrees/feat-mobile-responsive")
  WORKTREE_NAME="${CURRENT_WORKTREE##*/}"
fi

# Base ports (offset 0)
BASE_PB_PORT=8090
BASE_VITE_PORT=5173
BASE_MAILHOG_SMTP_PORT=1025
BASE_MAILHOG_UI_PORT=8025

# Initialize registry if it doesn't exist
if [ ! -f "$PORTS_REGISTRY" ]; then
  mkdir -p "$(dirname "$PORTS_REGISTRY")"
  cat > "$PORTS_REGISTRY" << 'EOFREGISTRY'
{
  "offsets": {
    "main": 0
  },
  "next_offset": 1,
  "port_base": {
    "PB_HOST_PORT": 8090,
    "VITE_PORT": 5173,
    "MAILHOG_SMTP_PORT": 1025,
    "MAILHOG_UI_PORT": 8025
  }
}
EOFREGISTRY
fi

# Helper function to get or allocate offset for worktree
get_offset() {
  local name="$1"
  local registry="$2"
  
  # Read current state
  local current_offset
  local next_offset
  
  current_offset=$(python3 -c "import json; r=json.load(open('$registry')); print(r['offsets'].get('$name', -1))" 2>/dev/null || echo "-1")
  
  if [ "$current_offset" != "-1" ]; then
    # Already registered
    echo "$current_offset"
    return 0
  fi
  
  # Allocate new offset
  next_offset=$(python3 -c "import json; r=json.load(open('$registry')); print(r['next_offset'])" 2>/dev/null || echo "999")
  
  # Update registry with new entry
  python3 << EOFPYTHON
import json
with open('$registry', 'r') as f:
    reg = json.load(f)
reg['offsets']['$name'] = $next_offset
reg['next_offset'] = $next_offset + 1
with open('$registry', 'w') as f:
    json.dump(reg, f, indent=2)
EOFPYTHON
  
  echo "$next_offset"
}

# Get the offset for this worktree
OFFSET=$(get_offset "$WORKTREE_NAME" "$PORTS_REGISTRY")

# Calculate ports based on offset (increment by 2 to leave room for multiple services per offset)
MAILHOG_OFFSET=$((OFFSET * 2))
PB_PORT=$((BASE_PB_PORT + MAILHOG_OFFSET))
VITE_PORT=$((BASE_VITE_PORT + OFFSET))
MAILHOG_SMTP_PORT=$((BASE_MAILHOG_SMTP_PORT + MAILHOG_OFFSET))
MAILHOG_UI_PORT=$((BASE_MAILHOG_UI_PORT + MAILHOG_OFFSET))

# Docker Compose project name (derived from worktree)
PB_PROJECT="kit-${WORKTREE_NAME}"

# Output environment variables
cat << EOFENV
export PB_HOST_PORT=$PB_PORT
export VITE_PORT=$VITE_PORT
export MAILHOG_SMTP_PORT=$MAILHOG_SMTP_PORT
export MAILHOG_UI_PORT=$MAILHOG_UI_PORT
export PB_PROJECT=$PB_PROJECT
EOFENV

# Also write to .claude/ports.env in the worktree for persistence
PORTS_ENV="${CURRENT_WORKTREE}/.claude/ports.env"
mkdir -p "$(dirname "$PORTS_ENV")"
cat > "$PORTS_ENV" << EOFENVFILE
export PB_HOST_PORT=$PB_PORT
export VITE_PORT=$VITE_PORT
export MAILHOG_SMTP_PORT=$MAILHOG_SMTP_PORT
export MAILHOG_UI_PORT=$MAILHOG_UI_PORT
export PB_PROJECT=$PB_PROJECT
EOFENVFILE
