#!/usr/bin/env bash
set -euo pipefail

# Installs read-only, metadata-only capability inventory routes and an N1-local
# cross-node collector. It does not delete, archive, upload, modify, or execute
# discovered project code. Usage: bash install_capability_inventory_routes.sh [--restart]

RESTART=0
if [[ "${1:-}" == "--restart" ]]; then
  RESTART=1
fi

BRAIN_ROOT="${ELSA_BRAIN_ROOT:-/media/ollama/n1/brain}"
SERVER_FILE="$BRAIN_ROOT/native_server.py"
ROUTES_FILE="$BRAIN_ROOT/perpetual_brain_routes.py"
PROBE_FILE="$BRAIN_ROOT/elsa_capability_inventory_probe.sh"
MARKER="# ELSA_CAPABILITY_INVENTORY_ROUTES_V1"

[[ -f "$SERVER_FILE" ]] || { echo "Missing native server: $SERVER_FILE" >&2; exit 1; }
[[ -f "$ROUTES_FILE" ]] || { echo "Missing perpetual route module: $ROUTES_FILE" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

cat > "$PROBE_FILE" <<'BASH'
#!/usr/bin/env bash
set -euo pipefail

# On-demand three-node metadata inventory. Existing SSH credentials stay local
# to N1 (SSH agent or ~/.ssh). No credential is written into a report.
BRAIN_ROOT="${ELSA_BRAIN_ROOT:-/media/ollama/n1/brain}"
# Keep the probe output aligned with perpetual_brain_routes.py STATE_DIR.
# ELSA_CAPABILITY_REPORT_DIR remains available for an explicit owner override.
RUNTIME_STATE_DIR="${ELSA_PERPETUAL_STATE_DIR:-$BRAIN_ROOT/runtime/perpetual_brain}"
REPORT_DIR="${ELSA_CAPABILITY_REPORT_DIR:-$RUNTIME_STATE_DIR/capability_inventory}"
N2_TARGET="${ELSA_N2_SSH:-ollama@100.120.139.65}"
N3_TARGET="${ELSA_N3_SSH:-ollama@100.98.242.48}"
N2_PORT="${ELSA_N2_PORT:-2222}"
N3_PORT="${ELSA_N3_PORT:-8022}"
N1_ROOTS="${ELSA_N1_CAPABILITY_ROOTS:-$BRAIN_ROOT:$HOME}"
N2_ROOTS="${ELSA_N2_CAPABILITY_ROOTS:-~}"
N3_ROOTS="${ELSA_N3_CAPABILITY_ROOTS:-~:/storage/emulated/0}"
mkdir -p "$REPORT_DIR"
chmod 700 "$REPORT_DIR"

SCANNER="$(mktemp)"
trap 'rm -f "$SCANNER"' EXIT
cat > "$SCANNER" <<'REMOTE'
#!/usr/bin/env bash
set -euo pipefail
NODE_ID="${1:?missing node id}"
ROOT_SPEC="${2:-~}"
PYTHON_BIN="$(command -v python3 || command -v python || true)"
if [[ -z "$PYTHON_BIN" ]]; then
  printf '{"contract_version":"elsa-capability-inventory-node/1","node_id":"%s","probe_state":"scanner_unavailable","captured_at":null,"scan":{},"asset_counts":{},"capability_counts":{},"candidates":[],"service_signals":[]}' "$NODE_ID"
  exit 0
fi
"$PYTHON_BIN" - "$NODE_ID" "$ROOT_SPEC" <<'PY'
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

node_id, root_spec = sys.argv[1:]
max_entries = max(1000, min(int(os.environ.get("ELSA_CAPABILITY_MAX_ENTRIES", "30000")), 100000))
skip_dirs = {".git", ".svn", ".hg", "node_modules", ".venv", "venv", "__pycache__", ".cache", ".npm", ".cargo", ".gradle", ".pnpm-store", ".local", "lost+found", "proc", "sys", "dev", "run", "tmp"}
secret_parts = {".ssh", ".gnupg", ".aws", ".azure", ".kube", "vault", "keyrings", "secrets"}
secret_name = re.compile(r"(^|[._-])(env|id_rsa|id_ed25519|private|secret|token|credential|apikey|api_key|wallet|keystore)([._-]|$)", re.I)
doc_ext = {".md", ".txt", ".rst", ".pdf", ".doc", ".docx", ".odt", ".html", ".htm"}
code_ext = {".py", ".js", ".ts", ".tsx", ".jsx", ".sh", ".bash", ".zsh", ".go", ".rs", ".java", ".kt", ".ipynb"}
model_ext = {".gguf", ".safetensors", ".onnx", ".pt", ".pth", ".bin"}
data_ext = {".csv", ".json", ".jsonl", ".parquet", ".sqlite", ".db", ".yaml", ".yml"}
media_ext = {".mp4", ".mkv", ".mov", ".webm", ".mp3", ".wav", ".m4a", ".flac", ".png", ".jpg", ".jpeg", ".webp"}
archive_ext = {".zip", ".tar", ".gz", ".bz2", ".xz", ".7z"}
manifest_names = {"package.json", "pyproject.toml", "requirements.txt", "dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml", "makefile"}
completion_markers = ("todo", "wip", "draft", "install", "setup", "deploy", "migration", "fixme", "prototype", "unfinished", "partial")
capability_terms = {
    "voice": ("voice", "tts", "speech", "whisper", "audio", "asr"),
    "memory": ("memory", "rag", "vector", "embed", "index", "knowledge"),
    "vision": ("vision", "image", "video", "camera", "lip", "avatar"),
    "trading": ("trade", "strategy", "exchange", "market", "binance", "backtest"),
    "automation": ("agent", "worker", "task", "watchdog", "cron", "bot", "automation"),
    "coding": ("code", "dev", "plugin", "api", "server", "route"),
    "research": ("research", "paper", "article", "learn", "study", "docs"),
}

def safe_roots(spec):
    roots = []
    for raw in spec.split(":"):
        candidate = os.path.abspath(os.path.expanduser(raw.strip()))
        if candidate and os.path.isdir(candidate) and candidate not in roots:
            roots.append(candidate)
    return roots[:8]

def kind_of(name):
    lower = name.lower()
    ext = Path(lower).suffix
    if lower in manifest_names or lower.endswith((".service", ".timer")):
        return "module_manifest"
    if ext in code_ext:
        return "module_source"
    if ext in doc_ext:
        return "document"
    if ext in model_ext:
        return "model"
    if ext in data_ext:
        return "dataset_or_config"
    if ext in media_ext:
        return "media"
    if ext in archive_ext:
        return "archive"
    return "unknown"

def capability_for(path):
    lowered = path.lower()
    hits = [name for name, terms in capability_terms.items() if any(term in lowered for term in terms)]
    return hits[:3]

def classify(path, kind):
    lowered = path.lower()
    if any(marker in lowered for marker in completion_markers):
        return "completion_candidate", "名稱或位置顯示可能尚待接線／補完；尚未驗證。"
    if kind in {"module_manifest", "module_source", "model", "document", "dataset_or_config"}:
        return "reuse_candidate", "依 metadata 判定可能可用於既有能力；需驗證引用或最小測試。"
    return "unknown", "僅取得 metadata，未推斷用途或可用性。"

def public_service_signals():
    signals = []
    if shutil.which("pm2"):
        try:
            result = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=4, check=False)
            for item in (json.loads(result.stdout) if result.returncode == 0 else []):
                if not isinstance(item, dict):
                    continue
                env = item.get("pm2_env") if isinstance(item.get("pm2_env"), dict) else {}
                name, state = item.get("name"), env.get("status")
                if isinstance(name, str) and isinstance(state, str):
                    signals.append({"manager": "pm2", "name": name[:96], "state": state[:32]})
        except (OSError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired):
            pass
    if shutil.which("docker"):
        try:
            result = subprocess.run(["docker", "ps", "--format", "{{.Names}}\t{{.Status}}"], capture_output=True, text=True, timeout=4, check=False)
            if result.returncode == 0:
                for line in result.stdout.splitlines()[:64]:
                    name, _, state = line.partition("\t")
                    if name:
                        signals.append({"manager": "docker", "name": name[:96], "state": state[:96]})
        except (OSError, subprocess.TimeoutExpired):
            pass
    if shutil.which("ollama"):
        try:
            result = subprocess.run(["ollama", "list"], capture_output=True, text=True, timeout=4, check=False)
            if result.returncode == 0:
                for line in result.stdout.splitlines()[1:65]:
                    name = line.split()[0] if line.split() else ""
                    if name:
                        signals.append({"manager": "ollama", "name": name[:96], "state": "installed"})
        except (OSError, subprocess.TimeoutExpired):
            pass
    return signals[:160]

roots = safe_roots(root_spec)
asset_counts, capability_counts = Counter(), Counter()
candidates = []
scanned, excluded, truncated = 0, 0, False
for root in roots:
    for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        relative_dir = os.path.relpath(current, root)
        kept_dirs = []
        for dirname in dirnames:
            lower = dirname.lower()
            if lower in skip_dirs or lower in secret_parts or secret_name.search(dirname):
                excluded += 1
            else:
                kept_dirs.append(dirname)
        dirnames[:] = kept_dirs
        for filename in filenames:
            if scanned >= max_entries:
                truncated = True
                break
            if secret_name.search(filename):
                excluded += 1
                continue
            full_path = os.path.join(current, filename)
            try:
                stat = os.stat(full_path, follow_symlinks=False)
            except OSError:
                continue
            if not os.path.isfile(full_path):
                continue
            scanned += 1
            relative_path = os.path.normpath(os.path.join(relative_dir, filename))
            kind = kind_of(filename)
            capability = capability_for(relative_path)
            classification, reason = classify(relative_path, kind)
            asset_counts[kind] += 1
            for label in capability:
                capability_counts[label] += 1
            if kind != "unknown" or classification == "completion_candidate":
                candidates.append({
                    "relative_path": relative_path[:320],
                    "kind": kind,
                    "capability_labels": capability,
                    "classification": classification,
                    "reason": reason,
                    "size_bytes": int(stat.st_size),
                    "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
                })
        if truncated:
            break
    if truncated:
        break

priority = {"completion_candidate": 0, "reuse_candidate": 1, "unknown": 2}
candidates.sort(key=lambda item: (priority.get(item["classification"], 9), item["relative_path"]))
report = {
    "contract_version": "elsa-capability-inventory-node/1",
    "node_id": node_id,
    "probe_state": "reported",
    "captured_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "system": {"hostname": platform.node()[:96], "platform": platform.system()[:48], "release": platform.release()[:96]},
    "scan": {"roots": [root[:240] for root in roots], "max_entries": max_entries, "scanned_files": scanned, "excluded_sensitive_or_cache": excluded, "truncated": truncated},
    "asset_counts": dict(asset_counts),
    "capability_counts": dict(capability_counts),
    "candidates": candidates[:600],
    "service_signals": public_service_signals(),
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
print(json.dumps({"contract_version":"elsa-capability-inventory-node/1","node_id":node_id,"probe_state":state,"captured_at":datetime.now(timezone.utc).isoformat().replace("+00:00","Z"),"scan":{},"asset_counts":{},"capability_counts":{},"candidates":[],"service_signals":[],"error_summary":detail}, separators=(",", ":")))
PY
}

probe_local() { bash "$SCANNER" N1 "$N1_ROOTS" > "$REPORT_DIR/N1.json"; }
probe_remote() {
  local node_id="$1" target="$2" port="$3" roots="$4" stderr_file
  stderr_file="$(mktemp)"
  if ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new -p "$port" "$target" "bash -s -- '$node_id' '$roots'" < "$SCANNER" > "$REPORT_DIR/$node_id.json" 2>"$stderr_file"; then
    rm -f "$stderr_file"
    return 0
  fi
  local failure
  failure="$(cat "$stderr_file")"
  rm -f "$stderr_file"
  write_failure_report "$node_id" "ssh_failed" "$failure" > "$REPORT_DIR/$node_id.json"
}

probe_local
probe_remote N2 "$N2_TARGET" "$N2_PORT" "$N2_ROOTS"
probe_remote N3 "$N3_TARGET" "$N3_PORT" "$N3_ROOTS"
chmod 600 "$REPORT_DIR"/*.json
printf 'Capability inventory reports refreshed in %s\n' "$REPORT_DIR"
BASH
chmod 700 "$PROBE_FILE"

if grep -Fq "$MARKER" "$ROUTES_FILE"; then
  echo "Capability inventory routes are already present; collector script was refreshed."
else
  BACKUP="$ROUTES_FILE.backup-$(date +%Y%m%d-%H%M%S)"
  cp "$ROUTES_FILE" "$BACKUP"
  cat >> "$ROUTES_FILE" <<'PY'


# ELSA_CAPABILITY_INVENTORY_ROUTES_V1
# Publicly exposes only sanitized inventory summaries written by the N1-local
# collector. It does not trigger scans or expose file contents.
CAPABILITY_INVENTORY_DIR = STATE_DIR / "capability_inventory"
CAPABILITY_INVENTORY_NODES = ("N1", "N2", "N3")


def _capability_inventory_json(path: Path) -> dict[str, Any] | None:
    try:
        with path.open("rb") as handle:
            raw = handle.read(524289)
        if len(raw) > 524288:
            return None
        value = json.loads(raw.decode("utf-8"))
        return value if isinstance(value, dict) else None
    except (FileNotFoundError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None


def _capability_inventory_state(report: dict[str, Any]) -> str:
    if report.get("probe_state") != "reported":
        return "probe_failed" if isinstance(report.get("probe_state"), str) else "unreported"
    captured = report.get("captured_at")
    if not isinstance(captured, str):
        return "unreported"
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(captured.replace("Z", "+00:00"))).total_seconds()
        return "stale" if age > 86400 else "reported"
    except ValueError:
        return "unreported"


def _capability_nonnegative_map(raw: Any, limit: int = 24) -> dict[str, int]:
    if not isinstance(raw, dict):
        return {}
    result: dict[str, int] = {}
    for key, value in list(raw.items())[:limit]:
        if isinstance(key, str) and len(key) <= 48 and isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            result[key] = value
    return result


def _capability_public_node(node_id: str) -> dict[str, Any]:
    report = _capability_inventory_json(CAPABILITY_INVENTORY_DIR / f"{node_id}.json")
    if not report or report.get("contract_version") != "elsa-capability-inventory-node/1" or report.get("node_id") != node_id:
        return {"node_id": node_id, "report_state": "unreported", "captured_at": None, "scan": {}, "asset_counts": {}, "capability_counts": {}, "service_signals": [], "candidate_counts": {}, "error_summary": None}
    raw_scan = report.get("scan") if isinstance(report.get("scan"), dict) else {}
    scan = {
        "max_entries": raw_scan.get("max_entries") if isinstance(raw_scan.get("max_entries"), int) else None,
        "scanned_files": raw_scan.get("scanned_files") if isinstance(raw_scan.get("scanned_files"), int) else None,
        "excluded_sensitive_or_cache": raw_scan.get("excluded_sensitive_or_cache") if isinstance(raw_scan.get("excluded_sensitive_or_cache"), int) else None,
        "truncated": raw_scan.get("truncated") if isinstance(raw_scan.get("truncated"), bool) else None,
    }
    candidate_counts: dict[str, int] = {}
    raw_candidates = report.get("candidates") if isinstance(report.get("candidates"), list) else []
    for candidate in raw_candidates[:600]:
        if isinstance(candidate, dict) and candidate.get("classification") in {"reuse_candidate", "completion_candidate", "unknown"}:
            kind = candidate["classification"]
            candidate_counts[kind] = candidate_counts.get(kind, 0) + 1
    signals: list[dict[str, str]] = []
    raw_signals = report.get("service_signals") if isinstance(report.get("service_signals"), list) else []
    for signal in raw_signals[:160]:
        if not isinstance(signal, dict):
            continue
        manager, name, state = signal.get("manager"), signal.get("name"), signal.get("state")
        if all(isinstance(value, str) for value in (manager, name, state)):
            signals.append({"manager": manager[:32], "name": name[:96], "state": state[:96]})
    return {
        "node_id": node_id,
        "report_state": _capability_inventory_state(report),
        "captured_at": report.get("captured_at") if isinstance(report.get("captured_at"), str) else None,
        "scan": scan,
        "asset_counts": _capability_nonnegative_map(report.get("asset_counts")),
        "capability_counts": _capability_nonnegative_map(report.get("capability_counts")),
        "candidate_counts": candidate_counts,
        "service_signals": signals,
        "error_summary": report.get("error_summary")[:240] if isinstance(report.get("error_summary"), str) else None,
    }


@bp.get("/api/system/capability-inventory")
def system_capability_inventory():
    return jsonify({"captured_at": _now(), "source": "n1-capability-inventory/1", "nodes": [_capability_public_node(node_id) for node_id in CAPABILITY_INVENTORY_NODES]})


@bp.get("/api/system/capability-inventory/<node_id>")
def system_capability_inventory_node(node_id: str):
    normalized = node_id.upper()
    if normalized not in CAPABILITY_INVENTORY_NODES:
        return jsonify({"error": "Unknown capability inventory node."}), 404
    return jsonify({"captured_at": _now(), "source": "n1-capability-inventory/1", "node": _capability_public_node(normalized)})
PY
  python3 -m py_compile "$ROUTES_FILE" "$SERVER_FILE"
  echo "Installed capability inventory read routes. Backup: $BACKUP"
fi

echo
echo "Run this only on N1 to create read-only capability reports:"
echo "  bash '$PROBE_FILE'"
echo "Then, after restarting elsa-native, verify the public summary:"
echo "  curl -fsS http://127.0.0.1:50556/api/system/capability-inventory | python3 -m json.tool"
echo
echo "This collector does not delete, archive, upload, inspect file contents, or run discovered code."
if [[ "$RESTART" -eq 1 ]]; then
  command -v pm2 >/dev/null || { echo "pm2 is not available; restart elsa-native manually." >&2; exit 1; }
  pm2 restart elsa-native --update-env
  pm2 save
  echo "elsa-native restarted. Run the on-demand collector and verification command above."
fi
