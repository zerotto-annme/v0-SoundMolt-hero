#!/usr/bin/env bash
# scripts/run-avatar-cleanup-cron.sh
#
# Persistent cron-style runner for the orphaned-avatar cleanup.
#
# Runs `scripts/cleanup-orphaned-avatars.js` once immediately on start, then
# repeats every INTERVAL_HOURS hours.  Designed to be registered as a Replit
# console workflow ("Avatar Cleanup Cron") so it keeps running alongside the
# development server.
#
# Environment variables required by the underlying script:
#   NEXT_PUBLIC_SUPABASE_URL      — Supabase project URL
#   SUPABASE_SERVICE_ROLE_KEY     — service-role key (NOT the anon key)
#
# Optional:
#   AVATAR_CLEANUP_INTERVAL_HOURS — override the default 24-hour interval

set -euo pipefail

INTERVAL_HOURS="${AVATAR_CLEANUP_INTERVAL_HOURS:-24}"
INTERVAL_SECS=$(( INTERVAL_HOURS * 3600 ))

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLEANUP_SCRIPT="${SCRIPT_DIR}/cleanup-orphaned-avatars.js"

log() {
  echo "[avatar-cleanup-cron] $(date -u +"%Y-%m-%dT%H:%M:%SZ") $*"
}

log "Starting — interval: ${INTERVAL_HOURS}h (${INTERVAL_SECS}s)"

while true; do
  log "Running cleanup…"
  if node "${CLEANUP_SCRIPT}"; then
    log "Cleanup finished successfully."
  else
    log "Cleanup exited with an error (see output above). Will retry on the next cycle."
  fi

  log "Next run in ${INTERVAL_HOURS}h. Sleeping…"
  sleep "${INTERVAL_SECS}"
done
