#!/usr/bin/env bash
set -euo pipefail

# Extends the previously installed perpetual_brain_routes.py module without
# exposing SSH, cloud, Git, R2, or exchange credentials to the mobile app.
# Usage: bash install_memory_center_routes.sh [--restart]

RESTART=0
if [[ "${1:-}" == "--restart" ]]; then
  RESTART=1
fi

BRAIN_ROOT="${ELSA_BRAIN_ROOT:-/media/ollama/n1/brain}"
SERVER_FILE="$BRAIN_ROOT/native_server.py"
ROUTES_FILE="$BRAIN_ROOT/perpetual_brain_routes.py"
MARKER="# ELSA_MEMORY_CENTER_ROUTES_V1"

[[ -f "$SERVER_FILE" ]] || { echo "Missing native server: $SERVER_FILE" >&2; exit 1; }
[[ -f "$ROUTES_FILE" ]] || { echo "Missing perpetual route module: $ROUTES_FILE" >&2; echo "Install install_perpetual_brain_routes.sh first." >&2; exit 1; }

if grep -Fq "$MARKER" "$ROUTES_FILE"; then
  echo "Memory Center routes are already present; no source changes made."
else
  BACKUP="$ROUTES_FILE.backup-$(date +%Y%m%d-%H%M%S)"
  cp "$ROUTES_FILE" "$BACKUP"

  cat >> "$ROUTES_FILE" <<'PY'


# ELSA_MEMORY_CENTER_ROUTES_V1
# Read-only mobile observability contracts. They never execute SSH, modify PM2,
# access credential values, submit trades, or write to R2.
import socket

MEMORY_CENTER_STATE_DIR = STATE_DIR / "memory_center"
MEMORY_SYNC_REPORT_FILE = MEMORY_CENTER_STATE_DIR / "memory_sync_status.json"
AIXI_SELF_REPORT_FILE = MEMORY_CENTER_STATE_DIR / "aixi_self_status.json"


def _read_limited_json(path: Path, max_bytes: int = 131072) -> dict[str, Any] | None:
    """Read a small worker-written report without leaking arbitrary files."""
    try:
        with path.open("rb") as handle:
            raw = handle.read(max_bytes + 1)
        if len(raw) > max_bytes:
            return None
        parsed = json.loads(raw.decode("utf-8"))
        return parsed if isinstance(parsed, dict) else None
    except (FileNotFoundError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None


def _tcp_reachability(host: str, port: int) -> str:
    """A bounded TCP probe only; it does not authenticate or run SSH commands."""
    try:
        with socket.create_connection((host, port), timeout=1.5):
            return "reachable"
    except (OSError, ValueError):
        return "unreachable"


def _safe_service_summary() -> list[dict[str, str]]:
    allow = {"elsa-native", "elsa-watchdog", "elsa-selfevolve", "cloudflared-agi"}
    summary: list[dict[str, str]] = []
    for item in _pm2_processes():
        name = item.get("name")
        if not isinstance(name, str) or name not in allow:
            continue
        env = item.get("pm2_env") if isinstance(item.get("pm2_env"), dict) else {}
        state = env.get("status") if isinstance(env.get("status"), str) else "unreported"
        summary.append({"name": name, "state": state})
    return sorted(summary, key=lambda service: service["name"])


def _protection_gpu_snapshot() -> dict[str, Any] | None:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,temperature.gpu,power.draw,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None
        fields = [part.strip() for part in result.stdout.splitlines()[0].split(",")]
        if len(fields) != 5:
            return None
        return {
            "name": fields[0],
            "temperature_c": int(float(fields[1])),
            "power_w": round(float(fields[2]), 1),
            "memory_used_mb": int(float(fields[3])),
            "memory_total_mb": int(float(fields[4])),
        }
    except (FileNotFoundError, ValueError, subprocess.TimeoutExpired):
        return None


@bp.get("/api/system/inventory")
def system_inventory():
    captured_at = _now()
    return jsonify({
        "captured_at": captured_at,
        "source": "n1-readonly-inventory/1",
        "nodes": [
            {
                "id": "N1",
                "role": "brain_center",
                "connection_state": "local",
                "last_verified_at": captured_at,
                "services": _safe_service_summary(),
            },
            {
                "id": "N2",
                "role": "public_tunnel",
                "connection_state": _tcp_reachability("100.120.139.65", 2222),
                "last_verified_at": captured_at,
                "services": [],
            },
            {
                "id": "N3",
                "role": "remote_ssh",
                "connection_state": _tcp_reachability("100.98.242.48", 8022),
                "last_verified_at": captured_at,
                "services": [],
            },
        ],
    })


@bp.get("/api/system/protection")
def system_protection():
    disk = _disk_snapshot()
    free_gb = round(disk["total_gb"] - disk["used_gb"], 2) if disk else None
    headroom_pct = round((free_gb / disk["total_gb"]) * 100, 2) if disk and disk["total_gb"] > 0 else None
    watchdog_state = _pm2_status("elsa-watchdog") or "unreported"
    return jsonify({
        "captured_at": _now(),
        "source": "n1-readonly-protection/1",
        "gpu": _protection_gpu_snapshot(),
        "disk": {**disk, "free_gb": free_gb, "headroom_pct": headroom_pct} if disk else None,
        "watchdog_state": watchdog_state,
        "protection_state": "watchdog_online" if watchdog_state == "online" else "unreported",
        "last_action": "unreported",
        "pause_reason": None,
    })


@bp.get("/api/system/structure")
def system_structure():
    # Node relationships are a declared topology. N2/N3 live state belongs to inventory.
    return jsonify({
        "captured_at": _now(),
        "source": "n1-declared-topology/1",
        "structure_version": "three-machine-topology/1",
        "last_verified_at": None,
        "nodes": [
            {"id": "N1", "role": "brain_center", "verification": "n1_local"},
            {"id": "N2", "role": "public_tunnel", "verification": "requires_inventory"},
            {"id": "N3", "role": "remote_ssh", "verification": "requires_inventory"},
        ],
        "data_flow": ["perpetual_brain", "n1_memory_index", "r2_raw_archive", "trade_executor"],
    })


@bp.get("/api/memory/sync-status")
def memory_sync_status():
    report = _read_limited_json(MEMORY_SYNC_REPORT_FILE)
    if report is None:
        return jsonify({
            "captured_at": _now(),
            "source": "n1-memory-sync-report/1",
            "n1_index_state": "unreported",
            "pending_items": None,
            "deduplicated_count": None,
            "r2_sync_state": "unreported",
            "r2_object_count": None,
            "last_sync_at": None,
            "error_summary": "No controlled memory-sync worker report is available.",
        })

    def _safe_int(value: Any) -> int | None:
        return value if isinstance(value, int) and value >= 0 else None

    return jsonify({
        "captured_at": _now(),
        "source": "n1-memory-sync-report/1",
        "n1_index_state": report.get("n1_index_state") if isinstance(report.get("n1_index_state"), str) else "unreported",
        "pending_items": _safe_int(report.get("pending_items")),
        "deduplicated_count": _safe_int(report.get("deduplicated_count")),
        "r2_sync_state": report.get("r2_sync_state") if isinstance(report.get("r2_sync_state"), str) else "unreported",
        "r2_object_count": _safe_int(report.get("r2_object_count")),
        "last_sync_at": report.get("last_sync_at") if isinstance(report.get("last_sync_at"), str) else None,
        "error_summary": report.get("error_summary") if isinstance(report.get("error_summary"), str) else None,
    })


@bp.get("/api/ai/self-status")
def aixi_self_status():
    # This is an explicit voluntary record, never an inference from `/ask`.
    report = _read_limited_json(AIXI_SELF_REPORT_FILE)
    if report is None:
        return jsonify({"error": "No explicit Aixi self-report is available."}), 404

    required = ("reported_at", "source", "long_term_wishes")
    if any(key not in report for key in required):
        return jsonify({"error": "Aixi self-report contract is incomplete."}), 422
    wishes = report.get("long_term_wishes")
    if not isinstance(wishes, list) or any(not isinstance(wish, str) or not wish.strip() for wish in wishes):
        return jsonify({"error": "Aixi self-report wishes are invalid."}), 422

    def _thought_field(key: str) -> str | None:
        value = report.get(key)
        return value[:800] if isinstance(value, str) and value.strip() else None

    return jsonify({
        "reported_at": _thought_field("reported_at"),
        "source": _thought_field("source"),
        "current_mood": _thought_field("current_mood"),
        "current_focus": _thought_field("current_focus"),
        "near_term_intent": _thought_field("near_term_intent"),
        "long_term_wishes": [wish[:800] for wish in wishes[:12]],
    })
PY

  python3 -m py_compile "$ROUTES_FILE" "$SERVER_FILE"
  echo "Installed Memory Center routes. Backup: $BACKUP"
fi

echo
echo "Verify without restarting yet:"
echo "  python3 -m py_compile '$SERVER_FILE' '$ROUTES_FILE'"
echo "  curl -fsS http://127.0.0.1:50556/api/system/inventory | python3 -m json.tool"
echo "  curl -fsS http://127.0.0.1:50556/api/system/protection | python3 -m json.tool"
echo "  curl -fsS http://127.0.0.1:50556/api/system/structure | python3 -m json.tool"
echo "  curl -fsS http://127.0.0.1:50556/api/memory/sync-status | python3 -m json.tool"
echo "  curl -sS -o /dev/null -w 'Aixi self-report HTTP %{http_code}\n' http://127.0.0.1:50556/api/ai/self-status"
echo
echo "The self-report route intentionally returns 404 until a controlled N1 worker or owner writes a complete explicit report to:"
echo "  $BRAIN_ROOT/.elsa_perpetual/memory_center/aixi_self_status.json"
echo
echo "To restart automatically after reviewing this output, re-run with --restart."
if [[ "$RESTART" -eq 1 ]]; then
  command -v pm2 >/dev/null || { echo "pm2 is not available; restart elsa-native manually." >&2; exit 1; }
  pm2 restart elsa-native --update-env
  pm2 save
  echo "elsa-native restarted. Run the verification commands above."
fi
