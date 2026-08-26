#!/usr/bin/env bash
# ELSA V5 Local Route Locator
# Read-only: scans source/configuration names and PM2 metadata.
# It never reads .env values, writes project files, controls PM2, or sends HTTP mutations.

set -Eeuo pipefail

PROJECT_DIR="${ELSA_PROJECT_DIR:-$HOME/elsa-native}"
DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_DIR="$DESKTOP_DIR/ELSA-route-locator-$STAMP"
mkdir -p "$REPORT_DIR"

REPORT="$REPORT_DIR/README.txt"
ROUTES="$REPORT_DIR/route-candidates.txt"
CONFIG="$REPORT_DIR/config-key-names.txt"

log() {
  printf '%s\n' "$*" | tee -a "$REPORT"
}

write_section() {
  printf '\n== %s ==\n' "$1" | tee -a "$REPORT"
}

cat > "$REPORT" <<EOF
ELSA V5 Local Route Locator
Generated: $(date -Is)
Project directory: $PROJECT_DIR

Safety: this script reads source files and process metadata only. It does not print .env values,
modify files, restart PM2, alter service state, or issue POST/PUT/PATCH/DELETE requests.
EOF

write_section "Project directory"
if [[ -d "$PROJECT_DIR" ]]; then
  log "Found: $PROJECT_DIR"
else
  log "Not found: $PROJECT_DIR"
  log "Run again with: ELSA_PROJECT_DIR=/actual/project/path bash locate_elsa_routes.sh"
fi

write_section "PM2 metadata (read-only)"
if command -v pm2 >/dev/null 2>&1; then
  pm2 list --no-color 2>&1 | tee "$REPORT_DIR/pm2-list.txt" | tee -a "$REPORT" || true
  for process in elsa-native elsa-watchdog elsa-selfevolve cloudflared-agi; do
    printf '\n-- pm2 show %s --\n' "$process" | tee -a "$REPORT_DIR/pm2-show.txt" | tee -a "$REPORT"
    pm2 show "$process" --no-color 2>&1 | sed -E 's/([A-Za-z_]*(TOKEN|SECRET|PASSWORD|PASSPHRASE|API[_-]?KEY)[A-Za-z_]*)[[:space:]]*[:=][[:space:]]*[^[:space:]]+/\1=[REDACTED]/Ig' | tee -a "$REPORT_DIR/pm2-show.txt" | tee -a "$REPORT" || true
  done
else
  log "pm2 command not found."
fi

write_section "Listening HTTP-adjacent ports (read-only)"
ss -ltnp 2>&1 | tee "$REPORT_DIR/listening-tcp.txt" | tee -a "$REPORT" || true

if [[ -d "$PROJECT_DIR" ]]; then
  write_section "Configuration key names only (values redacted)"
  : > "$CONFIG"
  while IFS= read -r -d '' config_file; do
    printf '\n# %s\n' "$config_file" >> "$CONFIG"
    sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2=[REDACTED]/p' "$config_file" \
      | grep -Ei 'PORT|HOST|URL|ORIGIN|BASE|API|ROUTE|PATH|TRADING|SIGNAL|POSITION|AUTO|PROXY|TUNNEL' || true
  done < <(find "$PROJECT_DIR" -maxdepth 4 -type f \( -name '.env' -o -name '.env.*' -o -name '*config*.env' \) -print0 2>/dev/null)
  if [[ -s "$CONFIG" ]]; then
    cat "$CONFIG" | tee -a "$REPORT"
  else
    log "No matching configuration key names found."
  fi

  write_section "Route and handler candidates"
  : > "$ROUTES"
  # Only code/config file names are scanned. Large folders and dependencies are excluded.
  while IFS= read -r -d '' source_file; do
    grep -nE \
      '(@(app|router)\.(get|route)|\b(app|router)\.(get|use)\(|\b(GET|POST|PUT|PATCH|DELETE)[[:space:]]+/(api|auto|trade|trading|signal|position)|/(api|auto|trade|trading|signal|position)[A-Za-z0-9_?&=/.-]*)' \
      "$source_file" 2>/dev/null \
      | sed -E 's/([A-Za-z_]*(TOKEN|SECRET|PASSWORD|PASSPHRASE|API[_-]?KEY)[A-Za-z_]*)[[:space:]]*=[[:space:]]*[^,[:space:]]+/\1=[REDACTED]/Ig' \
      | sed "s#^#$source_file:#" >> "$ROUTES" || true
  done < <(find "$PROJECT_DIR" \
    -path "$PROJECT_DIR/node_modules" -prune -o \
    -path "$PROJECT_DIR/.git" -prune -o \
    -path "$PROJECT_DIR/venv" -prune -o \
    -path "$PROJECT_DIR/.venv" -prune -o \
    -type f \( -name '*.py' -o -name '*.js' -o -name '*.cjs' -o -name '*.mjs' -o -name '*.ts' -o -name '*.tsx' -o -name '*.sh' -o -name '*.conf' -o -name '*.yml' -o -name '*.yaml' \) -print0 2>/dev/null)
  if [[ -s "$ROUTES" ]]; then
    sort -u "$ROUTES" | tee "$REPORT_DIR/route-candidates-sorted.txt" | tee -a "$REPORT"
  else
    log "No route candidates found with the current patterns."
  fi

  write_section "Reverse-proxy route hints"
  grep -RInE 'location[[:space:]]+/|proxy_pass|reverse_proxy|ingress|tunnel|hostname' \
    "$PROJECT_DIR" \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=venv --exclude-dir=.venv \
    --include='*.conf' --include='*.yml' --include='*.yaml' --include='*.toml' --include='*.json' \
    2>/dev/null \
    | sed -E 's/([A-Za-z_]*(TOKEN|SECRET|PASSWORD|PASSPHRASE|API[_-]?KEY)[A-Za-z_]*)[[:space:]]*[:=][[:space:]]*[^,[:space:]]+/\1=[REDACTED]/Ig' \
    | tee "$REPORT_DIR/proxy-hints.txt" | tee -a "$REPORT" || true
fi

write_section "What to return"
log "Return README.txt plus:"
log "1. route-candidates-sorted.txt lines that define the BTCUSDT signal, positions, and auto-status handlers."
log "2. proxy-hints.txt lines mapping the public hostname to the local service."
log "3. The response samples from GET-only requests after we identify exact routes."

printf '\nReport folder: %s\n' "$REPORT_DIR"
