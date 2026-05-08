#!/usr/bin/env bash
# Stop hook: runs full build before session ends
cd /home/hadassi/Code/kit_tracker/frontend || exit 0
RESULT=$(npm run build 2>&1 | tail -25)
EXIT=$?
[ $EXIT -eq 0 ] && exit 0
jq -n --arg r "$RESULT" \
  '{"systemMessage":("Build failed — fix errors before shipping:\n" + $r)}'
