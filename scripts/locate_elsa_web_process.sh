#!/usr/bin/env bash
set -euo pipefail

PORT="${ELSA_PORT:-50556}"

echo "======================================================================"
echo " ELSA WEB SOURCE LOCATOR — READ ONLY"
echo " 對象：目前監聽 ${PORT} 的程序與 PM2 啟動入口"
echo " 不寫檔、不重啟、不修改任何服務"
echo "======================================================================"

echo
echo "[1/5] 本機健康檢查"
curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/health" || true
echo

echo
echo "[2/5] 監聽 ${PORT} 的程序"
ss -ltnp "sport = :${PORT}" 2>/dev/null || true

echo
echo "[3/5] PM2 服務 metadata"
pm2 jlist | python3 - <<'PY'
import json, sys
try:
    apps = json.load(sys.stdin)
except Exception as exc:
    print(f"無法讀取 pm2 jlist：{exc}")
    raise SystemExit(0)

for app in apps:
    env = app.get("pm2_env") or {}
    name = app.get("name", "")
    if name in {"elsa-native", "elsa-selfevolve", "cloudflared-agi"} or "elsa" in name.lower():
        print(f"\nNAME={name}")
        print(f"PID={app.get('pid')}")
        print(f"STATUS={env.get('status')}")
        print(f"CWD={env.get('pm_cwd')}")
        print(f"SCRIPT={env.get('pm_exec_path')}")
        print(f"ARGS={env.get('args')}")
        print(f"INTERPRETER={env.get('exec_interpreter')}")
PY

echo
echo "[4/5] elsa-native 程序樹與命令列"
ROOT_PID="$(pm2 pid elsa-native 2>/dev/null | tr -d '[:space:]' || true)"
if [[ -z "${ROOT_PID}" || "${ROOT_PID}" == "0" ]]; then
  echo "找不到 elsa-native 的 PM2 PID。"
else
  echo "PM2 root PID=${ROOT_PID}"
  queue=("${ROOT_PID}")
  seen=" "
  while [[ ${#queue[@]} -gt 0 ]]; do
    pid="${queue[0]}"
    queue=("${queue[@]:1}")
    [[ " ${seen} " == *" ${pid} "* ]] && continue
    seen+="${pid} "
    [[ -d "/proc/${pid}" ]] || continue
    cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
    cmd="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
    echo "PID=${pid}"
    echo "CWD=${cwd}"
    echo "CMD=${cmd}"
    while IFS= read -r child; do
      [[ -n "${child}" ]] && queue+=("${child}")
    done < <(pgrep -P "${pid}" 2>/dev/null || true)
    echo "---"
  done
fi

echo
echo "[5/5] 尋找實際 Flask 路由來源（僅限已發現的工作目錄）"
declare -a roots=()
if [[ -n "${ROOT_PID}" && -d "/proc/${ROOT_PID}/cwd" ]]; then
  roots+=("$(readlink -f "/proc/${ROOT_PID}/cwd" 2>/dev/null || true)")
fi
roots+=("/media/ollama/n1/brain" "/media/ollama/n1/elsa-native" "${HOME}/elsa-native")

declare -A printed=()
for root in "${roots[@]}"; do
  [[ -n "${root}" && -d "${root}" ]] || continue
  [[ -n "${printed[${root}]:-}" ]] && continue
  printed[${root}]=1
  echo "ROOT=${root}"
  grep -RIl --include='*.py' --include='*.js' --include='*.ts' --include='*.tsx' \
    -e 'api/stream' -e 'EventSource' -e 'Flask(' "${root}" 2>/dev/null | head -n 80 || true
done

echo
echo "======================================================================"
echo "定位完成。請貼回完整輸出；下一步只會修補列出的實際來源檔。"
echo "======================================================================"
