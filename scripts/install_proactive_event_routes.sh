#!/usr/bin/env bash
set -euo pipefail

# ELSA N1 installer: explicit proactive event inbox only. It never starts a
# background worker, contacts external services, generates images, or reads secrets.
# Run on N1: bash install_proactive_event_routes.sh [--restart]

RESTART=0
[[ "${1:-}" == "--restart" ]] && RESTART=1
ROOT="/media/ollama/n1/brain"
SERVER_FILE="$ROOT/native_server.py"
ROUTES_FILE="$ROOT/proactive_event_routes.py"
WRITER_FILE="$ROOT/write_proactive_event.py"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP="$SERVER_FILE.backup-$STAMP"

[[ -f "$SERVER_FILE" ]] || { echo "Missing $SERVER_FILE" >&2; exit 1; }
cp "$SERVER_FILE" "$BACKUP"

cat > "$ROUTES_FILE" <<'PY'
"""Sanitized, read-only App routes for explicit N1 perpetual-brain events."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Blueprint, jsonify

bp = Blueprint("elsa_proactive_events", __name__)
RUNTIME_DIR = Path(__file__).resolve().parent / ".elsa_perpetual"
EVENTS_FILE = RUNTIME_DIR / "proactive_events.json"
MAX_BYTES = 512 * 1024
MAX_EVENTS = 80
ALLOWED_KINDS = {"system_report", "chat_invite", "status_card"}
ALLOWED_SEVERITIES = {"info", "attention", "warning", "error"}
ALLOWED_VERIFICATION = {"reported", "verified"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _limited_text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if value and len(value) <= limit else None


def _read_events() -> list[dict[str, Any]]:
    try:
        if not EVENTS_FILE.is_file() or EVENTS_FILE.stat().st_size > MAX_BYTES:
            return []
        data = json.loads(EVENTS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _public_visual(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    kind = value.get("kind")
    label = _limited_text(value.get("label"), 120)
    if kind not in {"portrait_card", "generated_scene"} or not label or value.get("is_visualization") is not True:
        return None
    output: dict[str, Any] = {"kind": kind, "label": label, "is_visualization": True}
    for key, limit in (("generated_at", 80), ("character_reference_version", 120), ("prompt_digest", 320)):
        text = _limited_text(value.get(key), limit)
        if text:
            output[key] = text
    image_url = _limited_text(value.get("image_url"), 1500)
    if image_url and image_url.startswith("https://"):
        output["image_url"] = image_url
    return output


def _public_event(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    kind = value.get("kind")
    severity = value.get("severity")
    verification = value.get("verification_state")
    event_id = _limited_text(value.get("event_id"), 128)
    created_at = _limited_text(value.get("created_at"), 80)
    source = _limited_text(value.get("source"), 160)
    trigger = _limited_text(value.get("trigger"), 500)
    title = _limited_text(value.get("title"), 180)
    body = _limited_text(value.get("body"), 1200)
    if kind not in ALLOWED_KINDS or severity not in ALLOWED_SEVERITIES or verification not in ALLOWED_VERIFICATION:
        return None
    if not all((event_id, created_at, source, trigger, title, body)):
        return None
    output: dict[str, Any] = {
        "event_id": event_id, "kind": kind, "severity": severity, "created_at": created_at,
        "source": source, "trigger": trigger, "title": title, "body": body,
        "verification_state": verification,
    }
    for key in ("related_task_id", "related_report_id"):
        text = _limited_text(value.get(key), 128)
        if text:
            output[key] = text
    visual = _public_visual(value.get("visual"))
    if visual:
        output["visual"] = visual
    return output


@bp.get("/api/perpetual/events")
def perpetual_events():
    events = [event for raw in _read_events() if (event := _public_event(raw))]
    events.sort(key=lambda item: item["created_at"], reverse=True)
    return jsonify({"captured_at": _now(), "source": "n1-proactive-events/1", "events": events[:MAX_EVENTS]})


def register_proactive_event_routes(app) -> None:
    app.register_blueprint(bp)
PY

cat > "$WRITER_FILE" <<'PY'
#!/usr/bin/env python3
"""Append one explicitly declared N1 perpetual-brain event. No network calls."""
from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNTIME_DIR = ROOT / ".elsa_perpetual"
EVENTS_FILE = RUNTIME_DIR / "proactive_events.json"
MAX_EVENTS = 80


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_events() -> list[dict]:
    try:
        value = json.loads(EVENTS_FILE.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def bounded(value: str, label: str, limit: int) -> str:
    value = value.strip()
    if not value or len(value) > limit:
        raise SystemExit(f"{label} must be 1..{limit} characters")
    return value


parser = argparse.ArgumentParser(description="Write an explicit ELSA proactive event")
parser.add_argument("--kind", required=True, choices=["system_report", "chat_invite", "status_card"])
parser.add_argument("--severity", default="info", choices=["info", "attention", "warning", "error"])
parser.add_argument("--title", required=True)
parser.add_argument("--body", required=True)
parser.add_argument("--trigger", required=True)
parser.add_argument("--source", default="n1-perpetual-worker")
parser.add_argument("--verification", default="reported", choices=["reported", "verified"])
parser.add_argument("--task-id")
parser.add_argument("--report-id")
parser.add_argument("--visual-kind", choices=["portrait_card", "generated_scene"])
parser.add_argument("--visual-label")
parser.add_argument("--image-url")
parser.add_argument("--character-reference-version")
parser.add_argument("--prompt-digest")
args = parser.parse_args()

event = {
    "event_id": f"evt-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
    "kind": args.kind,
    "severity": args.severity,
    "created_at": now(),
    "source": bounded(args.source, "source", 160),
    "trigger": bounded(args.trigger, "trigger", 500),
    "title": bounded(args.title, "title", 180),
    "body": bounded(args.body, "body", 1200),
    "verification_state": args.verification,
}
if args.task_id:
    event["related_task_id"] = bounded(args.task_id, "task id", 128)
if args.report_id:
    event["related_report_id"] = bounded(args.report_id, "report id", 128)
if any((args.visual_kind, args.visual_label, args.image_url, args.character_reference_version, args.prompt_digest)):
    if not args.visual_kind or not args.visual_label:
        raise SystemExit("visual-kind and visual-label are both required for a visual event")
    visual = {"kind": args.visual_kind, "label": bounded(args.visual_label, "visual label", 120), "is_visualization": True, "generated_at": now()}
    if args.image_url:
        if not args.image_url.startswith("https://"):
            raise SystemExit("image-url must use HTTPS")
        visual["image_url"] = bounded(args.image_url, "image url", 1500)
    if args.character_reference_version:
        visual["character_reference_version"] = bounded(args.character_reference_version, "character reference version", 120)
    if args.prompt_digest:
        visual["prompt_digest"] = bounded(args.prompt_digest, "prompt digest", 320)
    if args.image_url and (not args.character_reference_version or not args.prompt_digest):
        raise SystemExit("new image events require character-reference-version and prompt-digest")
    event["visual"] = visual

RUNTIME_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
events = [event, *read_events()][:MAX_EVENTS]
fd, name = tempfile.mkstemp(prefix="proactive-events-", suffix=".json", dir=RUNTIME_DIR)
with os.fdopen(fd, "w", encoding="utf-8") as handle:
    json.dump(events, handle, ensure_ascii=False, separators=(",", ":"))
    handle.write("\n")
os.chmod(name, 0o600)
os.replace(name, EVENTS_FILE)
print(json.dumps({"ok": True, "event_id": event["event_id"], "path": str(EVENTS_FILE)}, ensure_ascii=False))
PY
chmod 700 "$WRITER_FILE"

python3 - "$SERVER_FILE" <<'PY'
import re
import sys
from pathlib import Path

server = Path(sys.argv[1])
text = server.read_text(encoding="utf-8")
marker = "# ELSA_PROACTIVE_EVENT_ROUTES_V1"
if marker in text:
    print("Proactive event route registration already exists; leaving native_server.py unchanged.")
    raise SystemExit(0)
if not re.search(r"\bapp\s*=\s*Flask\s*\(", text):
    raise SystemExit("Could not locate `app = Flask(...)`; restore the backup and register proactive_event_routes.register_proactive_event_routes(app) manually.")
registration = "\n\n" + marker + "\nfrom proactive_event_routes import register_proactive_event_routes as _register_proactive_event_routes\n_register_proactive_event_routes(app)\n"
main_guard = re.search(r"^if\s+__name__\s*==\s*[\"']__main__[\"']\s*:", text, flags=re.MULTILINE)
if main_guard:
    text = text[:main_guard.start()] + registration + "\n" + text[main_guard.start():]
else:
    text += registration
server.write_text(text, encoding="utf-8")
print("Registered proactive event routes in native_server.py")
PY

python3 -m py_compile "$ROUTES_FILE" "$WRITER_FILE" "$SERVER_FILE"
echo "Installed and syntax-validated. Backup: $BACKUP"
echo "Manual verification after restart:"
echo "  pm2 restart elsa-native --update-env"
echo "  curl -fsS http://127.0.0.1:50556/api/perpetual/events | python3 -m json.tool"
echo "  python3 '$WRITER_FILE' --kind status_card --title '艾西等待自我回報' --body '尚未寫入心情或工作事件。' --trigger 'manual contract check' --visual-kind portrait_card --visual-label '等待回報'"
if [[ "$RESTART" -eq 1 ]]; then
  command -v pm2 >/dev/null || { echo "pm2 is not available; restart elsa-native manually." >&2; exit 1; }
  pm2 restart elsa-native --update-env
  pm2 save
fi
