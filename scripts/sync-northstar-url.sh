#!/usr/bin/env bash
# Sync EXPO_PUBLIC_NORTHSTAR_URL in .env.local to the Mac's current LAN IP.
# Run when WiFi changes or before launching the Expo app on a physical device.
#
# Usage:
#   bash scripts/sync-northstar-url.sh           # auto-detect IP, port 8000
#   bash scripts/sync-northstar-url.sh 8001      # auto-detect IP, custom port
#   bash scripts/sync-northstar-url.sh 8000 lan  # auto-detect IP (default)
#   bash scripts/sync-northstar-url.sh 8000 local  # force 127.0.0.1 (Simulator)

set -euo pipefail

PORT="${1:-8000}"
MODE="${2:-lan}"

cd "$(dirname "$0")/.."
ENV_FILE=".env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found in $(pwd)" >&2
  exit 1
fi

if [[ "$MODE" == "local" ]]; then
  IP="127.0.0.1"
else
  # Try en0 first (typically WiFi on macOS), then en1.
  IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [[ -z "$IP" ]]; then
    IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if [[ -z "$IP" ]]; then
    echo "Error: couldn't detect a LAN IP on en0 or en1. Is WiFi connected?" >&2
    echo "Run with 'local' to use 127.0.0.1 instead: bash $0 $PORT local" >&2
    exit 1
  fi
fi

URL="http://${IP}:${PORT}"
KEY="EXPO_PUBLIC_NORTHSTAR_URL"

# Replace existing line or append. Match either the active line or a commented
# version. Macos sed is picky — use a temp file.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if grep -qE "^[#[:space:]]*${KEY}=" "$ENV_FILE"; then
  # Replace the LAST occurrence (most recently active value)
  awk -v key="$KEY" -v url="$URL" '
    BEGIN { last = 0 }
    /^[#[:space:]]*'"$KEY"'=/ { last = NR }
    { lines[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        if (i == last) {
          print key "=" url
        } else {
          print lines[i]
        }
      }
    }
  ' "$ENV_FILE" > "$TMP"
  mv "$TMP" "$ENV_FILE"
  echo "Updated ${KEY} → ${URL}"
else
  printf '\n%s=%s\n' "$KEY" "$URL" >> "$ENV_FILE"
  echo "Appended ${KEY}=${URL}"
fi

# Quick reachability check (don't fail if agent network isn't running yet)
if command -v nc >/dev/null 2>&1; then
  if nc -z -G 2 "$IP" "$PORT" 2>/dev/null; then
    echo "TCP ${IP}:${PORT} is reachable ✓"
  else
    echo "TCP ${IP}:${PORT} not reachable yet (start agents with: cd agents && python run_all.py --local)"
  fi
fi
