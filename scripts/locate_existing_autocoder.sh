#!/usr/bin/env bash
set -euo pipefail

# Read-only diagnosis for the user's existing N1 autonomous coding worker.
# It never starts, stops, edits, or deletes a PM2 process or source file.

BRAIN_DIR="${BRAIN_DIR:-/media/ollama/n1/brain}"
PM2_NAME="${PM2_NAME:-elsa-selfevolve}"

if [[ ! -d "$BRAIN_DIR" ]]; then
  echo "ERROR: Brain directory does not exist: $BRAIN_DIR" >&2
  exit 1
fi

echo "=== ELSA EXISTING AUTOCODER LOCATOR (READ ONLY) ==="
echo "brain_dir=$BRAIN_DIR"
echo "pm2_name=$PM2_NAME"
echo

echo "=== PM2 PROCESS METADATA (no environment values) ==="
if command -v pm2 >/dev/null 2>&1; then
  pm2 describe "$PM2_NAME" || true
else
  echo "pm2 command not found"
fi
echo

echo "=== AUTONOMOUS CODER CANDIDATES ==="
mapfile -t candidates < <(find "$BRAIN_DIR" -type f -name 'autonomous_coder.py' -print 2>/dev/null | sort)
if (( ${#candidates[@]} == 0 )); then
  echo "No autonomous_coder.py found below $BRAIN_DIR"
else
  for candidate in "${candidates[@]}"; do
    echo
    echo "--- $candidate ---"
    grep -nE '^(class[[:space:]].*(CodingLoop|Coder)|def[[:space:]]+(run_task|execute|deploy)|[[:space:]]+def[[:space:]]+(run_task|execute|deploy))' "$candidate" || true
    if grep -q 'CodingLoop' "$candidate"; then
      echo "MATCH: contains CodingLoop"
      echo "--- first 80 lines ---"
      sed -n '1,80p' "$candidate"
    fi
  done
fi
echo

echo "=== PM2 STARTUP REFERENCE CANDIDATES ==="
grep -RIl --include='*.py' --include='*.js' --include='*.json' --include='*.config.*' \
  -e 'elsa-selfevolve' -e 'autonomous_coder' -e 'CodingLoop' \
  "$BRAIN_DIR" 2>/dev/null | sort | head -n 80 || true
echo

echo "=== WORKER LOG TAIL (last 80 lines) ==="
if command -v pm2 >/dev/null 2>&1; then
  pm2 logs "$PM2_NAME" --lines 80 --nostream || true
fi
echo
echo "RESULT: Paste this entire output back. No existing process or source file was changed."
