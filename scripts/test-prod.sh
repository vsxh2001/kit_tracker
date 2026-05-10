#!/bin/bash
set -euo pipefail

# Docker Compose test harness for prod-parity e2e testing.
# Tears down volumes, builds + starts the full stack, seeds test data,
# runs Playwright against the dockerized frontend (served by PocketBase),
# and cleans up on exit (or --keep flag to debug).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
KEEP_RUNNING=0
NO_BUILD=0

# Parse optional flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP_RUNNING=1; shift ;;
    --no-build) NO_BUILD=1; shift ;;
    *) echo "Usage: $0 [--keep] [--no-build]"; exit 1 ;;
  esac
done

# Cleanup handler — always runs on exit
cleanup() {
  local exit_code=$?
  if [ $KEEP_RUNNING -eq 0 ]; then
    echo "Tearing down docker compose stack..."
    (cd "$REPO_ROOT" && docker compose down 2>/dev/null || true)
  else
    echo "Stack left running (--keep flag). Clean up manually with: docker compose down"
  fi
  exit $exit_code
}
trap cleanup EXIT

cd "$REPO_ROOT"

# Ensure .env exists with PB credentials
if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example to .env and set PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD."
  exit 1
fi

# Source .env to pick up PB credentials (for seed_test_users.sh call)
set +u
source .env
set -u

echo "========== Tearing down any existing compose state and volumes =========="
docker compose down -v 2>/dev/null || true

if [ $NO_BUILD -eq 0 ]; then
  echo "========== Building docker compose stack =========="
  docker compose build
fi

echo "========== Starting docker compose stack =========="
docker compose up -d

echo "========== Waiting for PocketBase health check (max 60s) =========="
i=0
PB_HOST_PORT=${PB_HOST_PORT:-8090}
until curl -sf http://localhost:${PB_HOST_PORT}/api/health > /dev/null 2>&1; do
  i=$((i + 1))
  if [ $i -ge 60 ]; then
    echo "ERROR: PocketBase did not become ready within 60s."
    echo "======== Last 50 lines of docker compose logs ========"
    docker compose logs --tail=50
    exit 1
  fi
  echo "  Waiting... ($i/60)"
  sleep 1
done
echo "PocketBase is ready. Collections and test users initialized via docker-entrypoint.sh."

echo "========== Running Playwright e2e suite (docker stack) =========="
# Point Playwright to the dockerized frontend (served by PB on the assigned port)
# Set PLAYWRIGHT_TEST_BASE_URL to signal docker mode (skips webServer health checks)
cd "${REPO_ROOT}/frontend"
PB_HOST_PORT=${PB_HOST_PORT:-8090}
VITE_PB_URL="http://localhost:${PB_HOST_PORT}" \
PLAYWRIGHT_TEST_BASE_URL="http://localhost:${PB_HOST_PORT}" \
npx playwright test --config=playwright.config.ts || {
  local_exit=$?
  echo "ERROR: Playwright tests failed (exit code: $local_exit)."
  echo "======== Last 50 lines of docker compose logs ========"
  (cd "$REPO_ROOT" && docker compose logs --tail=50)
  exit $local_exit
}

echo "========== Playwright suite completed successfully =========="
exit 0
