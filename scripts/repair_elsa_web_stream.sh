#!/usr/bin/env bash
set -euo pipefail

# Repairs the specific public-web failure confirmed at https://elsa.pin-yi.uk:
# the static page loads, but EventSource('/api/stream') returns Flask 404.
# This script finds the existing Flask source by its public page title, backs it up,
# adds an SSE endpoint before the existing __main__ block, and restarts only the
# PM2 process whose exec path / args point to that same source file.

BRAIN_DIR="${ELSA_BRAIN_DIR:-/media/ollama/n1/brain}"
CORE_URL="${ELSA_CORE_URL:-http://127.0.0.1:50556/api/perpetual/status}"
PUBLIC_URL="${ELSA_PUBLIC_URL:-https://elsa.pin-yi.uk/api/stream}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"

fail() { printf '\n[FAIL] %s\n' "$*" >&2; exit 1; }
note() { printf '\n[ELSA-WEB] %s\n' "$*"; }

[[ -d "$BRAIN_DIR" ]] || fail "N1 brain directory not found: $BRAIN_DIR"
command -v pm2 >/dev/null || fail "pm2 is not available"
command -v python3 >/dev/null || fail "python3 is not available"

note "Finding the Flask source that serves the existing ELSA public page..."
mapfile -t CANDIDATES < <(
  grep -rl --include='*.py' --exclude-dir='.git' --exclude-dir='venv' --exclude-dir='node_modules' \
    -e '艾西自主矩陣' -e 'AGI 統合控制面板' "$BRAIN_DIR" 2>/dev/null | sort -u
)

if [[ ${#CANDIDATES[@]} -eq 0 ]]; then
  mapfile -t CANDIDATES < <(
    grep -rl --include='*.py' --exclude-dir='.git' --exclude-dir='venv' --exclude-dir='node_modules' \
      "EventSource('/api/stream')" "$BRAIN_DIR" 2>/dev/null | sort -u
  )
fi

[[ ${#CANDIDATES[@]} -gt 0 ]] || fail "Could not find the ELSA public Flask source by page title or EventSource contract."
[[ ${#CANDIDATES[@]} -eq 1 ]] || {
  printf '[FAIL] Multiple possible public web sources were found; no file was changed:\n' >&2
  printf '  %s\n' "${CANDIDATES[@]}" >&2
  exit 2
}

SOURCE="${CANDIDATES[0]}"
note "Selected source: $SOURCE"

if grep -Eq "route\([[:space:]]*['\"]/api/stream['\"]" "$SOURCE"; then
  note "This source already has /api/stream. No source patch was needed. Continuing to restart and verify."
else
  BACKUP="${SOURCE}.backup-sse-${STAMP}"
  cp --preserve=mode,timestamps "$SOURCE" "$BACKUP"
  note "Backup created: $BACKUP"

  ELSA_SOURCE="$SOURCE" ELSA_CORE_URL="$CORE_URL" python3 - <<'PY'
import os
import re
from pathlib import Path

source = Path(os.environ['ELSA_SOURCE'])
core_url = os.environ['ELSA_CORE_URL']
text = source.read_text(encoding='utf-8')

match = re.search(r'^(?P<app>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*Flask\s*\(', text, re.MULTILINE)
if not match:
    raise SystemExit('Could not identify the existing Flask app variable; source left unchanged.')
app_name = match.group('app')

main_match = re.search(r'^if\s+__name__\s*==\s*[\'\"]__main__[\'\"]\s*:', text, re.MULTILINE)
if not main_match:
    raise SystemExit('Could not locate the existing __main__ block; source left unchanged.')

route = f'''

# Added by ELSA web accessibility repair ({os.environ.get("TZ", "UTC")}).
# The public UI uses EventSource('/api/stream') and expects SSE JSON messages.
@{app_name}.route('/api/stream')
def elsa_public_stream():
    from flask import Response, stream_with_context
    import json
    import time
    from urllib.request import urlopen

    def core_state():
        try:
            with urlopen({core_url!r}, timeout=3) as response:
                if 200 <= response.status < 300:
                    return 'online'
                return f'http_{{response.status}}'
        except Exception as error:
            return f'offline:{{type(error).__name__}}'

    @stream_with_context
    def event_stream():
        sequence = 0
        while True:
            sequence += 1
            state = core_state()
            status = {{
                'sd_status': f'N1 {{state}}',
                'last_cycle': time.strftime('%Y-%m-%d %H:%M:%S'),
            }}
            yield 'data: ' + json.dumps({{'type': 'status', 'data': status}}, ensure_ascii=False) + '\\n\\n'
            if sequence == 1 or sequence % 12 == 0:
                log = {{
                    'cat': 'SYSTEM',
                    'time': time.strftime('%H:%M:%S'),
                    'msg': f'ELSA SSE 已連線；N1 核心狀態：{{state}}',
                }}
                yield 'data: ' + json.dumps({{'type': 'log', 'data': log}}, ensure_ascii=False) + '\\n\\n'
            yield ': keepalive\\n\\n'
            time.sleep(5)

    return Response(
        event_stream(),
        mimetype='text/event-stream',
        headers={{
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        }},
    )

'''

updated = text[:main_match.start()] + route + text[main_match.start():]
source.write_text(updated, encoding='utf-8')
print(f'Patched {source} using Flask app variable {app_name}.')
PY
fi

note "Checking Python syntax..."
python3 -m py_compile "$SOURCE"

note "Finding the PM2 process that runs this exact source..."
PM2_NAME="$(pm2 jlist | SOURCE="$SOURCE" python3 -c '
import json, os, sys
source = os.path.realpath(os.environ["SOURCE"])
items = json.load(sys.stdin)
for item in items:
    env = item.get("pm2_env", {})
    values = [str(env.get("pm_exec_path", ""))]
    values.extend(str(value) for value in env.get("args", []) if value is not None)
    if any(os.path.realpath(value) == source for value in values if value):
        print(item.get("name", ""))
        break
')"

[[ -n "$PM2_NAME" ]] || fail "Source was patched but no PM2 process maps to it. No restart was performed. Inspect: pm2 jlist"
note "Restarting only PM2 process: $PM2_NAME"
pm2 restart "$PM2_NAME" --update-env

note "Waiting for the local service to reload..."
sleep 3

note "Verifying public SSE response from $PUBLIC_URL"
SSE_OUTPUT="$(timeout 10 curl -fsSN --connect-timeout 5 "$PUBLIC_URL" 2>/dev/null || true)"
printf '%s\n' "$SSE_OUTPUT" | sed -n '1,8p'

printf '%s' "$SSE_OUTPUT" | grep -q '^data: ' || fail "Public /api/stream did not return an SSE data event after restart."
printf '%s' "$SSE_OUTPUT" | grep -q '"type": "status"\|"type":"status"' || fail "SSE opened but did not return a status message."

note "PASS: elsa.pin-yi.uk now returns EventSource-compatible SSE data."
note "Backup retained at: ${BACKUP:-not-needed}"
note "Rollback if needed: cp '${BACKUP:-SOURCE_BACKUP_NOT_CREATED}' '$SOURCE' && pm2 restart '$PM2_NAME' --update-env"
