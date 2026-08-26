#!/usr/bin/env bash
# ELSA 永動腦受控編碼實測：只建立隔離測試任務，絕不直接改動既有服務。
# 使用方式：bash test_perpetual_code_worker.sh
set -euo pipefail

BASE_URL="${ELSA_BASE_URL:-http://127.0.0.1:50556}"
WAIT_SECONDS="${ELSA_CODE_TEST_WAIT_SECONDS:-75}"
POLL_SECONDS=5
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TITLE="隔離編碼實測 ${STAMP}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少必要命令：$1" >&2
    exit 1
  }
}

require_command curl
require_command python3

echo "== 1. 檢查永動腦狀態（唯讀） =="
STATUS="$(curl --fail --silent --show-error --max-time 10 "$BASE_URL/api/perpetual/status")"
printf '%s\n' "$STATUS" | python3 -m json.tool

ONLINE="$(printf '%s' "$STATUS" | python3 -c 'import json,sys; print(str(bool(json.load(sys.stdin).get("online"))).lower())')"
if [[ "$ONLINE" != "true" ]]; then
  echo "\n結果：永動腦未回報 online，未提交編碼任務。"
  exit 2
fi

OBJECTIVE="請只在 /media/ollama/n1/brain/.elsa_perpetual/code_worker_selftest/${STAMP}/ 建立 selftest.py，內容為一個不使用網路、不讀取環境變數、不執行 shell 指令的 pure Python 函式 add(a, b)。再以 python3 -m py_compile 驗證此檔。不可修改 native_server.py、任何 .env、PM2、Docker、交易程式、模型或現有服務設定；不可部署；完成後回報實際檔案路徑、SHA-256、py_compile 結果與失敗原因。"

PAYLOAD="$(python3 - "$TITLE" "$OBJECTIVE" <<'PY'
import json, sys
print(json.dumps({"kind": "code", "title": sys.argv[1], "objective": sys.argv[2]}, ensure_ascii=False))
PY
)"

echo "\n== 2. 提交不可部署的隔離編碼任務 =="
CREATED="$(curl --fail --silent --show-error --max-time 10 \
  -X POST "$BASE_URL/api/perpetual/tasks" \
  -H 'Content-Type: application/json' \
  --data "$PAYLOAD")"
printf '%s\n' "$CREATED" | python3 -m json.tool

TASK_ID="$(printf '%s' "$CREATED" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task_id"])')"
echo "\n任務 ID：$TASK_ID"
echo "注意：此任務的 deployment_policy 應為 require_approval；本腳本不會呼叫核准或部署端點。"

echo "\n== 3. 等待工作者認領並回報證據（最多 ${WAIT_SECONDS} 秒） =="
ELAPSED=0
LAST=''
while (( ELAPSED <= WAIT_SECONDS )); do
  LAST="$(curl --fail --silent --show-error --max-time 10 "$BASE_URL/api/perpetual/tasks/$TASK_ID")"
  STATE="$(printf '%s' "$LAST" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("state", "unknown"))')"
  STEP="$(printf '%s' "$LAST" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("current_step", ""))')"
  echo "[$ELAPSED/${WAIT_SECONDS}s] state=$STATE | step=$STEP"
  case "$STATE" in
    completed|failed|needs_approval|cancelled) break ;;
  esac
  sleep "$POLL_SECONDS"
  ELAPSED=$((ELAPSED + POLL_SECONDS))
done

echo "\n== 4. 最終任務證據 =="
printf '%s\n' "$LAST" | python3 -m json.tool

FINAL_STATE="$(printf '%s' "$LAST" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("state", "unknown"))')"
echo "\n== 判讀 =="
case "$FINAL_STATE" in
  completed|needs_approval)
    echo "工作者已認領任務並回傳完成或待核准狀態；請保留上方 test_summary、git_summary 與 tool_events 作為證據。"
    ;;
  queued)
    echo "任務成功進入佇列，但尚無受控執行器認領。這證明路由可排程，不證明永動腦具備編碼／寫檔能力。"
    echo "可在確認後以：curl -X POST \"$BASE_URL/api/perpetual/tasks/$TASK_ID/cancel\" 取消這筆待處理測試任務。"
    ;;
  failed)
    echo "工作者已認領但執行失敗；請保留 failure_reason 作為後續修復依據。"
    ;;
  *)
    echo "工作者未在等待時間內回傳可判定結果；請貼回完整輸出與 pm2 logs elsa-selfevolve --lines 80。"
    ;;
esac
