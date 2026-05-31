#!/usr/bin/env bash
# Register bot commands with Telegram so the command menu appears in chat.
# One-time operator step after deploying the bot.
#
# Usage:
#   TELEGRAM_BOT_TOKEN=<token> bash scripts/tg-set-commands.sh
#   bash scripts/tg-set-commands.sh <token>
set -euo pipefail

TOKEN="${TELEGRAM_BOT_TOKEN:-${1:-}}"
if [ -z "$TOKEN" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN not set." >&2
  echo "Usage: TELEGRAM_BOT_TOKEN=<token> bash scripts/tg-set-commands.sh" >&2
  exit 1
fi

curl -fsSL -X POST "https://api.telegram.org/bot${TOKEN}/setMyCommands" \
  -H "Content-Type: application/json" \
  -d '{
    "commands": [
      {"command":"help",     "description":"Show available commands"},
      {"command":"me",       "description":"Your account info"},
      {"command":"kits",     "description":"List active kits with holders"},
      {"command":"kit",      "description":"Kit details: /kit <serial> or /kit <serial> all"},
      {"command":"requests", "description":"List open requests"},
      {"command":"find",     "description":"Search kits and entities"},
      {"command":"request",  "description":"Open a request: /request <kit> <entity> [YYYY-MM-DD]"},
      {"command":"move",     "description":"Move a kit: /move <kit> <entity> (admin/technician)"},
      {"command":"approve",  "description":"Approve a request: /approve <handle> [notes]"},
      {"command":"reject",   "description":"Reject a request: /reject <handle> [notes]"}
    ]
  }'
echo
echo "Commands registered."
