#!/usr/bin/env bash
# ELSA V5 Read-only Integration Probe
# This script only sends HTTP GET requests and reads local process/socket status.
# It does not write to the ELSA service, edit .env files, restart PM2, or trigger trades.

set -Eeuo pipefail

PUBLIC_BASE_URL="${ELSA_BASE_URL:-https://brain.pin-yi.uk}"
LOCAL_BASE_URL="${ELSA_LOCAL_URL:-http://127.0.0.1:3000}"
DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_DIR="$DESKTOP_DIR/ELSA-readonly-probe-$STAMP"
RESPONSES_DIR="$REPORT_DIR/responses"

mkdir -p "$RESPONSES_DIR"

REPORT="$REPORT_DIR/README.txt"

cat > "$REPORT" <<EOF
ELSA V5 read-only integration probe
Generated: $(date -Is)
Public base URL: $PUBLIC_BASE_URL
Local base URL: $LOCAL_BASE_URL

This report contains only GET response samples and local status summaries.
Do not share this folder publicly before reviewing it.
EOF

log() {
  printf '%s\n' "$*" | tee -a "$REPORT"
}

pretty_body() {
  local source="$1"
  local destination="$2"

  if command -v jq >/dev/null 2>&1 && jq -e . "$source" >/dev/null 2>&1; then
    jq 'walk(if type == "object" then with_entries(if (.key | test("token|secret|password|passphrase|api[_-]?key|authorization"; "i")) then .value = "[REDACTED]" else . end) else . end)' "$source" > "$destination"
  else
    sed -E 's/("?(token|secret|password|passphrase|api[_-]?key|authorization)"?[[:space:]]*[:=][[:space:]]*")[^"]+"/\1[REDACTED]"/Ig' "$source" > "$destination"
  fi
}

probe_get() {
  local scope="$1"
  local path="$2"
  local base_url="$3"
  local safe_path
  safe_path="$(printf '%s' "$path" | tr '/?&=' '_')"
  local raw="$RESPONSES_DIR/${scope}-${safe_path}.raw"
  local output="$RESPONSES_DIR/${scope}-${safe_path}.txt"
  local url="${base_url%/}${path}"
  local http_code

  http_code="$(curl --silent --show-error --location --max-time 8 --connect-timeout 4 \
    --output "$raw" --write-out '%{http_code}' "$url" 2>"$raw.stderr" || true)"

  {
    printf 'URL: %s\n' "$url"
    printf 'HTTP status: %s\n' "${http_code:-transport-error}"
    printf '\nResponse body (redacted):\n'
  } > "$output"

  if [[ -s "$raw" ]]; then
    pretty_body "$raw" "$output.body"
    head -c 16000 "$output.body" >> "$output"
    rm -f "$output.body"
  elif [[ -s "$raw.stderr" ]]; then
    sed -E 's/(token|secret|password|passphrase|api[_-]?key)=?[^[:space:]]+/\1=[REDACTED]/Ig' "$raw.stderr" >> "$output"
  else
    printf '(no response body)\n' >> "$output"
  fi

  rm -f "$raw" "$raw.stderr"
  log "[$scope] $path -> ${http_code:-transport-error}"
}

log ""
log "== HTTP endpoint probes =="

# Confirmed public read-only endpoints.
for path in \
  "/api/system/bible" \
  "/api/plugins" \
  "/api/exchanges" \
  "/api/exchange/balance"; do
  probe_get "public" "$path" "$PUBLIC_BASE_URL"
done

# Candidate names derived from the existing ELSA operations. A 404 is useful:
# it tells us that the actual public path needs to be supplied by the desktop service.
for path in \
  "/api/signal?symbol=BTCUSDT&tf=1H" \
  "/api/positions" \
  "/api/auto/status" \
  "/api/auto/positions" \
  "/api/trading/status" \
  "/api/trading/positions" \
  "/auto/status" \
  "/positions"; do
  probe_get "public-candidate" "$path" "$PUBLIC_BASE_URL"
done

log ""
log "== Local service probes =="
for path in \
  "/api/system/bible" \
  "/api/plugins" \
  "/api/exchanges" \
  "/api/signal?symbol=BTCUSDT&tf=1H" \
  "/api/positions" \
  "/api/auto/status"; do
  probe_get "local" "$path" "$LOCAL_BASE_URL"
done

log ""
log "== PM2 status (read-only) =="
if command -v pm2 >/dev/null 2>&1; then
  pm2 list --no-color 2>&1 | tee "$REPORT_DIR/pm2-status.txt" | tee -a "$REPORT"
else
  log "pm2 command not found."
fi

log ""
log "== Listening TCP ports (read-only) =="
ss -ltn 2>&1 | tee "$REPORT_DIR/listening-tcp.txt" | tee -a "$REPORT" || true

log ""
log "Completed. Share the README.txt and the matching response files for endpoints that returned HTTP 200."
printf '\nReport folder: %s\n' "$REPORT_DIR"
