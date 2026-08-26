#!/usr/bin/env bash
set -euo pipefail

# Installs read-only storage inventory reporting for N1/N2/N3.
# Usage: bash install_storage_inventory_routes.sh [--restart]
# The installed probe runs only when the owner invokes it on N1. The mobile
# app receives no write route and no credentials.

RESTART=0
if [[ "${1:-}" == "--restart" ]]; then
  RESTART=1
fi

BRAIN_ROOT="${ELSA_BRAIN_ROOT:-/media/ollama/n1/brain}"
SERVER_FILE="$BRAIN_ROOT/native_server.py"
ROUTES_FILE="$BRAIN_ROOT/perpetual_brain_routes.py"
PROBE_FILE="$BRAIN_ROOT/elsa_storage_inventory_probe.sh"
MARKER="# ELSA_STORAGE_INVENTORY_ROUTES_V1"

[[ -f "$SERVER_FILE" ]] || { echo "Missing native server: $SERVER_FILE" >&2; exit 1; }
[[ -f "$ROUTES_FILE" ]] || { echo "Missing perpetual routes: $ROUTES_FILE" >&2; exit 1; }

cat > "$PROBE_FILE" <<'BASH'
#!/usr/bin/env bash
set -euo pipefail

# Cross-node, metadata-only storage report collector. It reads df-style volume
# information and predefined source anchors only; it never traverses files or
# transfers their contents. Override target strings only on N1 if your SSH user
# differs. Keys stay in the local SSH agent or ~/.ssh, never in this script.

BRAIN_ROOT="${ELSA_BRAIN_ROOT:-/media/ollama/n1/brain}"
# Keep the probe output aligned with perpetual_brain_routes.py STATE_DIR.
# ELSA_STORAGE_REPORT_DIR remains available for an explicit owner override.
RUNTIME_STATE_DIR="${ELSA_PERPETUAL_STATE_DIR:-$BRAIN_ROOT/runtime/perpetual_brain}"
REPORT_DIR="${ELSA_STORAGE_REPORT_DIR:-$RUNTIME_STATE_DIR/storage_inventory}"
N2_TARGET="${ELSA_N2_SSH:-ollama@100.120.139.65}"
N3_TARGET="${ELSA_N3_SSH:-ollama@100.98.242.48}"
N2_PORT="${ELSA_N2_PORT:-2222}"
N3_PORT="${ELSA_N3_PORT:-8022}"
mkdir -p "$REPORT_DIR"
chmod 700 "$REPORT_DIR"

SCANNER="$(mktemp)"
trap 'rm -f "$SCANNER"' EXIT
cat > "$SCANNER" <<'REMOTE'
#!/usr/bin/env bash
set -euo pipefail
NODE_ID="${1:?missing node id}"
PYTHON_BIN="$(command -v python3 || command -v python || true)"
if [[ -z "$PYTHON_BIN" ]]; then
  printf '{"contract_version":"elsa-storage-node/1","node_id":"%s","probe_state":"scanner_unavailable","captured_at":null,"volumes":[],"import_sources":[]}' "$NODE_ID"
  exit 0
fi
"$PYTHON_BIN" - "$NODE_ID" <<'PY'
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone

node_id = sys.argv[1]
skip_types = {"tmpfs", "devtmpfs", "proc", "sysfs", "cgroup", "cgroup2", "overlay", "squashfs", "ramfs", "efivarfs"}

def text(value, limit=160):
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] if value else None

def volumes():
    try:
        result = subprocess.run(["df", "-Pk"], capture_output=True, text=True, timeout=5, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return []
    found = []
    for line in result.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 6:
            continue
        filesystem, total, used, available, capacity = parts[:5]
        mount_path = " ".join(parts[5:])
        fs_type = None
        try:
            type_result = subprocess.run(["findmnt", "-n", "-o", "FSTYPE", "-T", mount_path], capture_output=True, text=True, timeout=2, check=False)
            fs_type = text(type_result.stdout, 48)
        except (OSError, subprocess.TimeoutExpired):
            pass
        if fs_type in skip_types or filesystem.startswith(("tmpfs", "devtmpfs", "proc", "sysfs")):
            continue
        try:
            total_bytes = int(total) * 1024
            used_bytes = int(used) * 1024
            available_bytes = int(available) * 1024
        except ValueError:
            continue
        if total_bytes <= 0:
            continue
        found.append({
            "mount_path": text(mount_path, 240),
            "filesystem_type": fs_type or "unreported",
            "total_bytes": total_bytes,
            "used_bytes": used_bytes,
            "available_bytes": available_bytes,
            "usage_percent": round((used_bytes / total_bytes) * 100, 1),
        })
    return found[:48]

def source_exists(identifier, label, path, mode):
    return {"id": identifier, "label": label, "state": "available" if os.path.exists(path) else "unreported", "access": mode}

home = os.path.expanduser("~")
sources = [
    source_exists("user-home", "使用者目錄（僅手動選取）", home, "user_selected"),
    source_exists("downloads", "Downloads（僅手動選取）", os.path.join(home, "Downloads"), "user_selected"),
    source_exists("termux-shared", "Termux shared storage（僅手動選取）", os.path.join(home, "storage", "shared"), "user_selected"),
    source_exists("android-shared", "Android shared storage（僅手動選取）", "/storage/emulated/0", "user_selected"),
    source_exists("nix-store", "Nix store（預設不匯入）", "/nix", "manual_only"),
]

report = {
    "contract_version": "elsa-storage-node/1",
    "node_id": node_id,
    "probe_state": "reported",
    "captured_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "system": {
        "hostname": text(platform.node(), 96),
        "platform": text(platform.system(), 48),
        "release": text(platform.release(), 96),
    },
    "volumes": volumes(),
    "import_sources": sources,
}
print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
PY
REMOTE
chmod 700 "$SCANNER"

write_failure_report() {
  local node_id="$1"
  local state="$2"
  local output="$3"
  python3 - "$node_id" "$state" "$output" <<'PY'
import json, sys
from datetime import datetime, timezone
node_id, state, output = sys.argv[1:]
detail = "SSH connection was not established."
if "Permission denied" in output:
    detail = "SSH authentication was not accepted."
elif "timed out" in output or "No route" in output or "Connection refused" in output:
    detail = "SSH transport was not available."
print(json.dumps({
  "contract_version": "elsa-storage-node/1",
  "node_id": node_id,
  "probe_state": state,
  "captured_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
  "system": {}, "volumes": [], "import_sources": [], "error_summary": detail,
}, separators=(",", ":")))
PY
}

probe_local() {
  bash "$SCANNER" N1 > "$REPORT_DIR/N1.json"
}

probe_remote() {
  local node_id="$1"
  local target="$2"
  local port="$3"
  local stderr_file
  stderr_file="$(mktemp)"
  if ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -p "$port" "$target" "bash -s -- '$node_id'" < "$SCANNER" > "$REPORT_DIR/$node_id.json" 2>"$stderr_file"; then
    rm -f "$stderr_file"
    return 0
  fi
  local failed_output
  failed_output="$(cat "$stderr_file")"
  rm -f "$stderr_file"
  write_failure_report "$node_id" "ssh_failed" "$failed_output" > "$REPORT_DIR/$node_id.json"
  return 0
}

probe_local
probe_remote N2 "$N2_TARGET" "$N2_PORT"
probe_remote N3 "$N3_TARGET" "$N3_PORT"
chmod 600 "$REPORT_DIR"/*.json
printf 'Storage inventory reports refreshed in %s\n' "$REPORT_DIR"
BASH
chmod 700 "$PROBE_FILE"

if grep -Fq "$MARKER" "$ROUTES_FILE"; then
  echo "Storage inventory read routes are already present; probe script was refreshed."
else
  BACKUP="$ROUTES_FILE.backup-$(date +%Y%m%d-%H%M%S)"
  cp "$ROUTES_FILE" "$BACKUP"
  cat >> "$ROUTES_FILE" <<'PY'


# ELSA_STORAGE_INVENTORY_ROUTES_V1
# Read-only report access. Scans run only through the N1-local probe script.
from datetime import datetime, timezone

STORAGE_INVENTORY_DIR = STATE_DIR / "storage_inventory"
STORAGE_INVENTORY_NODES = ("N1", "N2", "N3")


def _storage_text(value: Any, limit: int = 240) -> str | None:
    return value[:limit] if isinstance(value, str) and value.strip() else None


def _storage_number(value: Any) -> int | float | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0 else None


def _storage_report_state(report: dict[str, Any]) -> str:
    probe_state = report.get("probe_state")
    if probe_state != "reported":
        return "probe_failed" if isinstance(probe_state, str) else "unreported"
    captured_at = _storage_text(report.get("captured_at"), 48)
    if not captured_at:
        return "unreported"
    try:
        captured = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
        if (datetime.now(timezone.utc) - captured).total_seconds() > 86_400:
            return "stale"
    except ValueError:
        return "unreported"
    return "reported"


def _storage_public_report(node_id: str) -> dict[str, Any]:
    path = STORAGE_INVENTORY_DIR / f"{node_id}.json"
    report = _read_limited_json(path, max_bytes=131072)
    if not report or report.get("contract_version") != "elsa-storage-node/1" or report.get("node_id") != node_id:
        return {"node_id": node_id, "report_state": "unreported", "captured_at": None, "system": {}, "volumes": [], "import_sources": [], "error_summary": None}

    raw_system = report.get("system") if isinstance(report.get("system"), dict) else {}
    system = {
        "hostname": _storage_text(raw_system.get("hostname"), 96),
        "platform": _storage_text(raw_system.get("platform"), 48),
        "release": _storage_text(raw_system.get("release"), 96),
    }
    volumes: list[dict[str, Any]] = []
    raw_volumes = report.get("volumes") if isinstance(report.get("volumes"), list) else []
    for volume in raw_volumes[:48]:
        if not isinstance(volume, dict):
            continue
        total = _storage_number(volume.get("total_bytes"))
        used = _storage_number(volume.get("used_bytes"))
        available = _storage_number(volume.get("available_bytes"))
        if total is None or used is None or available is None or total <= 0 or used > total:
            continue
        volumes.append({
            "mount_path": _storage_text(volume.get("mount_path"), 240) or "unreported",
            "filesystem_type": _storage_text(volume.get("filesystem_type"), 48) or "unreported",
            "total_bytes": total,
            "used_bytes": used,
            "available_bytes": available,
            "usage_percent": _storage_number(volume.get("usage_percent")),
        })
    sources: list[dict[str, Any]] = []
    raw_sources = report.get("import_sources") if isinstance(report.get("import_sources"), list) else []
    for source in raw_sources[:16]:
        if not isinstance(source, dict):
            continue
        source_id = _storage_text(source.get("id"), 48)
        label = _storage_text(source.get("label"), 96)
        state = source.get("state") if source.get("state") in {"available", "unreported"} else "unreported"
        access = source.get("access") if source.get("access") in {"user_selected", "manual_only"} else "manual_only"
        if source_id and label:
            sources.append({"id": source_id, "label": label, "state": state, "access": access})
    return {
        "node_id": node_id,
        "report_state": _storage_report_state(report),
        "captured_at": _storage_text(report.get("captured_at"), 48),
        "system": system,
        "volumes": volumes,
        "import_sources": sources,
        "error_summary": _storage_text(report.get("error_summary"), 240),
    }


@bp.get("/api/system/storage-inventory")
def system_storage_inventory():
    return jsonify({
        "captured_at": _now(),
        "source": "n1-storage-inventory/1",
        "nodes": [_storage_public_report(node_id) for node_id in STORAGE_INVENTORY_NODES],
    })


@bp.get("/api/system/storage-inventory/<node_id>")
def system_storage_inventory_node(node_id: str):
    normalized = node_id.upper()
    if normalized not in STORAGE_INVENTORY_NODES:
        return jsonify({"error": "Unknown storage inventory node."}), 404
    return jsonify({
        "captured_at": _now(),
        "source": "n1-storage-inventory/1",
        "node": _storage_public_report(normalized),
    })
PY
  python3 -m py_compile "$ROUTES_FILE" "$SERVER_FILE"
  echo "Installed storage inventory read routes. Backup: $BACKUP"
fi

echo
echo "Run a read-only three-node storage inventory from N1 when ready:"
echo "  bash '$PROBE_FILE'"
echo "Then inspect its public report locally:"
echo "  curl -fsS http://127.0.0.1:50556/api/system/storage-inventory | python3 -m json.tool"
echo
echo "The probe requires existing SSH authentication on N1 for N2/N3. It never copies files, walks directories, or reads secrets."
if [[ "$RESTART" -eq 1 ]]; then
  command -v pm2 >/dev/null || { echo "pm2 is not available; restart elsa-native manually." >&2; exit 1; }
  pm2 restart elsa-native --update-env
  pm2 save
  echo "elsa-native restarted. Run the probe and verification command above."
fi
