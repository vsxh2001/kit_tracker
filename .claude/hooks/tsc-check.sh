#!/usr/bin/env bash
# PostToolUse hook: runs tsc after TypeScript file edits
FILE=$(jq -r '.tool_input.file_path // .tool_response.filePath // ""' 2>/dev/null)
echo "$FILE" | grep -qE 'frontend/.*\.(ts|tsx)$' || exit 0
cd /home/hadassi/Code/kit_tracker/frontend || exit 0
ERRORS=$(npx tsc --noEmit 2>&1 | head -40)
[ -z "$ERRORS" ] && exit 0
jq -n --arg e "$ERRORS" \
  '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":("TypeScript errors — fix before continuing:\n" + $e)}}'
