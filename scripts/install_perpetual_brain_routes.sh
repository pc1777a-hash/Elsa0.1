#!/usr/bin/env bash
# Installs observable, non-secret Flask routes into the existing ELSA N1 service.
# Default behavior: backup + install + syntax validation only. It never restarts
# a service or executes a task unless the operator explicitly passes --restart.
set -Eeuo pipefail

BRAIN_DIR="${ELSA_BRAIN_DIR:-/media/ollama/n1/brain}"
SERVER_FILE="${BRAIN_DIR}/native_server.py"
ROUTES_FILE="${BRAIN_DIR}/perpetual_brain_routes.py"
RUNTIME_DIR="${BRAIN_DIR}/runtime/perpetual_brain"
RESTART=0
ROLLBACK_PATH=""

usage() {
  cat <<'USAGE'
Usage:
  bash install_perpetual_brain_routes.sh [--restart]
  bash install_perpetual_brain_routes.sh --rollback /path/to/native_server.py.backup-YYYYmmdd-HHMMSS

Environment:
  ELSA_BRAIN_DIR=/media/ollama/n1/brain   # Override only if ELSA lives elsewhere.

The installer adds only these routes:
  GET  /api/perpetual/status
  GET  /api/perpetual/tasks
  POST /api/perpetual/tasks                 # Queues a task; does not execute it.
  GET  /api/perpetual/tasks/<task_id>
  POST /api/perpetual/tasks/<task_id>/cancel
  POST /api/perpetual/tasks/<task_id>/approve-deploy
  GET  /api/perpetual/strategy-status
  GET  /api/system/resources

It does not store secrets, run SSH commands, invoke Git, call /api/autocode,
or place live trades. Those actions require a separate reviewed N1 worker.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --restart) RESTART=1 ;;
    --rollback)
      shift
      ROLLBACK_PATH="${1:-}"
      [[ -n "$ROLLBACK_PATH" ]] || { echo "--rollback requires a backup path" >&2; exit 2; }
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

[[ -f "$SERVER_FILE" ]] || { echo "Missing: $SERVER_FILE" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

if [[ -n "$ROLLBACK_PATH" ]]; then
  [[ -f "$ROLLBACK_PATH" ]] || { echo "Backup not found: $ROLLBACK_PATH" >&2; exit 1; }
  cp -a "$ROLLBACK_PATH" "$SERVER_FILE"
  python3 -m py_compile "$SERVER_FILE"
  echo "Rollback complete. Restart manually with: pm2 restart elsa-native --update-env"
  exit 0
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${SERVER_FILE}.backup-${STAMP}"
cp -a "$SERVER_FILE" "$BACKUP"
mkdir -p "$RUNTIME_DIR"

cat > "$ROUTES_FILE" <<'PY'
"""Observable, non-secret routes for ELSA's N1 permanent-brain worker.

This module deliberately exposes task metadata and aggregate resources only. It
does not expose shell commands, file contents, API keys, private keys, tokens,
or model prompts. POST /tasks records a queued request; a reviewed worker must
claim it and update its status before the App can show it as running.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Blueprint, jsonify, request

BRAIN_ROOT = Path(os.environ.get("ELSA_BRAIN_DIR", "/media/ollama/n1/brain"))
STATE_DIR = BRAIN_ROOT / "runtime" / "perpetual_brain"
TASKS_FILE = STATE_DIR / "tasks.json"
LOCK = threading.RLock()
bp = Blueprint("perpetual_brain", __name__)
ALLOWED_KINDS = {"code", "research", "maintenance"}
TASK_STATES = {"queued", "running", "needs_approval", "completed", "failed", "cancelled"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_tasks() -> list[dict[str, Any]]:
    try:
        payload = json.loads(TASKS_FILE.read_text(encoding="utf-8"))
        return payload if isinstance(payload, list) else []
    except FileNotFoundError:
        return []
    except (OSError, json.JSONDecodeError):
        return []


def _save_tasks(tasks: list[dict[str, Any]]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = TASKS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(tasks, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, TASKS_FILE)


def _public_task(task: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "task_id", "kind", "title", "objective", "state", "created_at", "updated_at",
        "started_at", "completed_at", "approval_at", "current_step", "failure_reason",
        "test_summary", "git_summary", "deployment_policy", "executor_mode",
    }
    return {key: task[key] for key in allowed if key in task}


def _find_task(task_id: str) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    tasks = _load_tasks()
    return tasks, next((item for item in tasks if item.get("task_id") == task_id), None)


def _pm2_processes() -> list[dict[str, Any]]:
    try:
        result = subprocess.run(
            ["pm2", "jlist"], capture_output=True, text=True, timeout=3, check=False
        )
        payload = json.loads(result.stdout) if result.returncode == 0 else []
        return payload if isinstance(payload, list) else []
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return []


def _pm2_status(process_name: str) -> str | None:
    for item in _pm2_processes():
        if item.get("name") == process_name:
            env = item.get("pm2_env") if isinstance(item.get("pm2_env"), dict) else {}
            return env.get("status") if isinstance(env.get("status"), str) else None
    return None


def _active_task(tasks: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((item for item in reversed(tasks) if item.get("state") == "running"), None)


@bp.get("/api/perpetual/status")
def perpetual_status():
    with LOCK:
        tasks = _load_tasks()
    service_state = _pm2_status("elsa-selfevolve")
    active = _active_task(tasks)
    return jsonify({
        "online": service_state == "online",
        "loop_state": service_state or "unavailable",
        "last_heartbeat": None,
        "active_task_id": active.get("task_id") if active else None,
        "queue_depth": sum(1 for item in tasks if item.get("state") == "queued"),
        "worker_version": "n1-route-bridge/1",
    })


@bp.get("/api/perpetual/tasks")
def list_tasks():
    with LOCK:
        tasks = [_public_task(item) for item in reversed(_load_tasks())]
    return jsonify({"tasks": tasks})


@bp.post("/api/perpetual/tasks")
def create_task():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON body is required"}), 400
    kind = payload.get("kind")
    title = payload.get("title")
    objective = payload.get("objective")
    if kind not in ALLOWED_KINDS:
        return jsonify({"error": "kind must be code, research, or maintenance"}), 400
    if not isinstance(title, str) or not title.strip() or not isinstance(objective, str) or not objective.strip():
        return jsonify({"error": "title and objective are required strings"}), 400

    timestamp = _now()
    task = {
        "task_id": f"pt-{uuid.uuid4().hex[:12]}",
        "kind": kind,
        "title": title.strip()[:160],
        "objective": objective.strip()[:4000],
        "state": "queued",
        "created_at": timestamp,
        "updated_at": timestamp,
        "deployment_policy": "require_approval",
        "executor_mode": "awaiting_reviewed_worker",
        "current_step": "queued; no worker has claimed this task",
    }
    with LOCK:
        tasks = _load_tasks()
        tasks.append(task)
        _save_tasks(tasks)
    return jsonify(_public_task(task)), 201


@bp.get("/api/perpetual/tasks/<task_id>")
def get_task(task_id: str):
    with LOCK:
        _, task = _find_task(task_id)
    if task is None:
        return jsonify({"error": "task not found"}), 404
    return jsonify({**_public_task(task), "tool_events": []})


@bp.post("/api/perpetual/tasks/<task_id>/cancel")
def cancel_task(task_id: str):
    with LOCK:
        tasks, task = _find_task(task_id)
        if task is None:
            return jsonify({"error": "task not found"}), 404
        if task.get("state") not in {"queued", "running", "needs_approval"}:
            return jsonify({"error": "task can no longer be cancelled"}), 409
        task.update({"state": "cancelled", "updated_at": _now(), "current_step": "cancelled by operator"})
        _save_tasks(tasks)
    return jsonify(_public_task(task))


@bp.post("/api/perpetual/tasks/<task_id>/approve-deploy")
def approve_deploy(task_id: str):
    with LOCK:
        tasks, task = _find_task(task_id)
        if task is None:
            return jsonify({"error": "task not found"}), 404
        if task.get("state") != "needs_approval":
            return jsonify({"error": "task is not awaiting deployment approval"}), 409
        task.update({"approval_at": _now(), "updated_at": _now(), "current_step": "deployment approved; awaiting deployment controller"})
        _save_tasks(tasks)
    return jsonify(_public_task(task))


@bp.get("/api/perpetual/strategy-status")
def strategy_status():
    with LOCK:
        tasks = _load_tasks()
    latest_code = next((item for item in reversed(tasks) if item.get("kind") == "code"), None)
    executor_status = _pm2_status("elsa-selfevolve")
    return jsonify({
        "development_task": _public_task(latest_code) if latest_code else None,
        "candidate_version": None,
        "deployed_version": None,
        "executor_state": executor_status or "unavailable",
        "executor_heartbeat": None,
        "risk_guard_state": "unreported",
        "last_cycle": None,
    })


def _gpu_snapshot() -> dict[str, Any] | None:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.used,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3, check=False,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None
        fields = [part.strip() for part in result.stdout.splitlines()[0].split(",")]
        if len(fields) != 3:
            return None
        return {"name": fields[0], "memory_used_mb": int(fields[1]), "memory_total_mb": int(fields[2])}
    except (FileNotFoundError, ValueError, subprocess.TimeoutExpired):
        return None


def _disk_snapshot() -> dict[str, Any] | None:
    try:
        stat = os.statvfs(BRAIN_ROOT)
        total = stat.f_blocks * stat.f_frsize
        available = stat.f_bavail * stat.f_frsize
        return {"used_gb": round((total - available) / 1024**3, 2), "total_gb": round(total / 1024**3, 2)}
    except OSError:
        return None


def _loaded_models() -> list[str]:
    try:
        result = subprocess.run(["ollama", "ps"], capture_output=True, text=True, timeout=3, check=False)
        if result.returncode != 0:
            return []
        names = []
        for line in result.stdout.splitlines()[1:]:
            match = re.match(r"^([^\s]+)", line.strip())
            if match:
                names.append(match.group(1))
        return names
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []


@bp.get("/api/system/resources")
def system_resources():
    with LOCK:
        tasks = _load_tasks()
    return jsonify({
        "captured_at": _now(),
        "gpu": _gpu_snapshot(),
        "disk": _disk_snapshot(),
        "loaded_models": _loaded_models(),
        "queue_depth": sum(1 for item in tasks if item.get("state") == "queued"),
    })


def register_perpetual_routes(app) -> None:
    app.register_blueprint(bp)
PY

python3 - "$SERVER_FILE" <<'PY'
import re
import sys
from pathlib import Path

server = Path(sys.argv[1])
text = server.read_text(encoding="utf-8")
marker = "# ELSA_PERPETUAL_BRAIN_ROUTES_V1"
if marker in text:
    print("Route registration already exists; leaving native_server.py unchanged.")
    raise SystemExit(0)
if not re.search(r"\bapp\s*=\s*Flask\s*\(", text):
    raise SystemExit("Could not locate `app = Flask(...)`; restore the backup and register perpetual_brain_routes.register_perpetual_routes(app) manually.")

registration = (
    "\n\n" + marker + "\n"
    "from perpetual_brain_routes import register_perpetual_routes as _register_perpetual_routes\n"
    "_register_perpetual_routes(app)\n"
)
main_guard = re.search(r"^if\s+__name__\s*==\s*[\"']__main__[\"']\s*:", text, flags=re.MULTILINE)
if main_guard:
    text = text[:main_guard.start()] + registration + "\n" + text[main_guard.start():]
else:
    app_run = re.search(r"^.*\bapp\.run\s*\(", text, flags=re.MULTILINE)
    if app_run:
        text = text[:app_run.start()] + registration + "\n" + text[app_run.start():]
    else:
        text += registration
server.write_text(text, encoding="utf-8")
print("Registered perpetual brain routes in native_server.py")
PY

python3 -m py_compile "$ROUTES_FILE" "$SERVER_FILE"
echo "Installed and syntax-validated. Backup: $BACKUP"
echo
echo "Verify without restarting yet:"
echo "  python3 -m py_compile '$SERVER_FILE' '$ROUTES_FILE'"
echo "  pm2 restart elsa-native --update-env"
echo "  curl -fsS http://127.0.0.1:50556/api/perpetual/status | python3 -m json.tool"
echo "  curl -fsS http://127.0.0.1:50556/api/system/resources | python3 -m json.tool"
echo
echo "To restart automatically after reviewing this output, re-run with --restart."
if [[ "$RESTART" -eq 1 ]]; then
  command -v pm2 >/dev/null || { echo "pm2 is not available; restart the native service manually." >&2; exit 1; }
  pm2 restart elsa-native --update-env
  pm2 save
  echo "elsa-native restarted. Verify the two curl commands above."
fi
