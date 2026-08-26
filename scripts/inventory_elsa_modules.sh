#!/usr/bin/env bash
set -euo pipefail

# ELSA module asset inventory v1.
# Read-only by default: it reports safe metadata to stdout and never starts,
# stops, installs, deletes, edits, or reads the contents of source/config files.

BRAIN_ROOT="${ELSA_BRAIN_ROOT:-/media/ollama/n1/brain}"
MAX_ITEMS="${ELSA_INVENTORY_MAX_ITEMS:-240}"

section() {
  printf '\n## %s\n' "$1"
}

note() {
  printf -- '- %s\n' "$1"
}

available() {
  command -v "$1" >/dev/null 2>&1
}

artifact_kind() {
  local path="$1"
  local name
  name="$(basename "$path")"
  case "$name" in
    install_*.sh|setup_*.sh|bootstrap_*.sh) printf 'installer' ;;
    native_server.py|server.py|app.py|main.py) printf 'service-source' ;;
    *_routes.py|*router*.py) printf 'service-route' ;;
    AGI_SYSTEM_PROMPT*|*prompt*.md|*prompt*.txt) printf 'prompt-contract' ;;
    package.json|pyproject.toml|requirements*.txt|pnpm-lock.yaml|package-lock.json) printf 'dependency-manifest' ;;
    *.md) printf 'documentation' ;;
    *.sh) printf 'automation-script' ;;
    *.py|*.js|*.ts|*.mjs) printf 'module-source' ;;
    *) printf 'supporting-artifact' ;;
  esac
}

safe_artifact_list() {
  if [[ ! -d "$BRAIN_ROOT" ]]; then
    note "N1 brain root is missing: $BRAIN_ROOT"
    return
  fi

  local count=0
  while IFS= read -r -d '' path; do
    local relative kind
    relative="${path#"$BRAIN_ROOT"/}"
    kind="$(artifact_kind "$path")"
    printf -- '- [%s] `%s`\n' "$kind" "$relative"
    count=$((count + 1))
    if (( count >= MAX_ITEMS )); then
      note "Artifact list capped at $MAX_ITEMS entries; increase ELSA_INVENTORY_MAX_ITEMS if required."
      break
    fi
  done < <(
    find "$BRAIN_ROOT" -maxdepth 4 \
      \( -path "$BRAIN_ROOT/.git" -o -path "$BRAIN_ROOT/.venv" -o -path "$BRAIN_ROOT/venv" -o -path "$BRAIN_ROOT/node_modules" -o -path "$BRAIN_ROOT/.elsa_perpetual" -o -path '*/__pycache__' \) -prune -o \
      -type f \( -iname '*.py' -o -iname '*.sh' -o -iname '*.js' -o -iname '*.ts' -o -iname '*.mjs' -o -iname '*.md' -o -iname 'package.json' -o -iname 'pnpm-lock.yaml' -o -iname 'package-lock.json' -o -iname 'pyproject.toml' -o -iname 'requirements*.txt' \) \
      -print0 2>/dev/null | sort -z
  )

  if (( count == 0 )); then
    note 'No safe source, installer, manifest, or documentation filenames were found within the scan scope.'
  fi
}

safe_duplicate_names() {
  if [[ ! -d "$BRAIN_ROOT" ]]; then
    return
  fi
  local duplicates
  duplicates="$({
    find "$BRAIN_ROOT" -maxdepth 4 \
      \( -path "$BRAIN_ROOT/.git" -o -path "$BRAIN_ROOT/.venv" -o -path "$BRAIN_ROOT/venv" -o -path "$BRAIN_ROOT/node_modules" -o -path "$BRAIN_ROOT/.elsa_perpetual" -o -path '*/__pycache__' \) -prune -o \
      -type f \( -iname '*.py' -o -iname '*.sh' -o -iname '*.js' -o -iname '*.ts' -o -iname '*.mjs' \) -printf '%f\n' 2>/dev/null | sort | uniq -cd | sort -nr | head -n 30
  } || true)"
  if [[ -n "$duplicates" ]]; then
    printf '%s\n' "$duplicates" | while read -r amount name; do
      note "duplicate-candidate: `$name` appears $amount times; compare purpose and entry point before merging or replacing."
    done
  else
    note 'No duplicate source filenames were found in the safe scan scope.'
  fi
}

printf '# ELSA N1 Module Asset Inventory\n\n'
printf '> Generated locally. This report contains filenames, package names, model names, service names, and statuses only; it does not read `.env` files, credential values, chat/memory content, source contents, or arbitrary configuration contents.\n'
printf '> Scan root: `%s`\n' "$BRAIN_ROOT"

section 'Runtime and orchestration availability'
for tool in python3 node npm pnpm pm2 docker systemctl ollama ffmpeg nvidia-smi git; do
  if available "$tool"; then
    note "`$tool`: available"
  else
    note "`$tool`: not found"
  fi
done

section 'Running and managed module indicators'
if available pm2; then
  printf '```text\n'
  pm2 ls --no-color 2>/dev/null || true
  printf '```\n'
else
  note 'PM2 is unavailable.'
fi

if available docker; then
  printf '```text\n'
  docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null || true
  printf '```\n'
else
  note 'Docker is unavailable.'
fi

if available systemctl; then
  printf '```text\n'
  systemctl list-units --all --type=service --no-legend 2>/dev/null | grep -Ei 'elsa|ollama|voice|tts|speech|whisper|memory|trade|cloudflared' || true
  printf '```\n'
else
  note 'systemctl is unavailable.'
fi

section 'Safe source, installer, manifest, and document artifacts'
safe_artifact_list

section 'Potential duplicate source filenames'
safe_duplicate_names

section 'Relevant local Python package indicators'
if available python3; then
  packages="$(python3 -m pip list --format=freeze 2>/dev/null | grep -Ei 'torch|transformers|sentence|ollama|whisper|tts|voice|speech|fastapi|flask|langchain|chromadb|qdrant|faiss|duckdb|ccxt|vector|memory|rag|embed|coqui|piper|kokoro' || true)"
  if [[ -n "$packages" ]]; then
    printf '```text\n%s\n```\n' "$packages"
  else
    note 'No relevant package names were reported by the active Python environment.'
  fi
else
  note 'Python package inspection skipped because python3 is unavailable.'
fi

section 'Relevant Node package indicators'
if [[ -f "$BRAIN_ROOT/package.json" ]] && available pnpm; then
  printf '```text\n'
  (cd "$BRAIN_ROOT" && pnpm list --depth 0 2>/dev/null | grep -Ei 'ai|ollama|voice|tts|speech|whisper|memory|vector|trade|ccxt' || true)
  printf '```\n'
else
  note 'No root package.json with pnpm was available for a Node dependency summary.'
fi

section 'Local model indicators'
if available ollama; then
  printf '```text\n'
  ollama list 2>/dev/null || true
  printf '```\n'
else
  note 'Ollama is unavailable.'
fi

section 'Classification and deployment gate'
note '**已運作**：出現在 PM2、Docker 或 systemd 的服務；沿用前仍需確認其公開契約與健康檢查。'
note '**已安裝未接線**：存在依賴清單、模型或來源檔，但未見受管理服務；先補 API／服務註冊，不重裝相同套件。'
note '**半完成**：偵測到安裝器、路由、資料夾或重複候選，但沒有完整的可驗證啟動鏈；先人工檢查安裝紀錄。'
note '**重複候選**：檔名重複不代表功能重複；需比較入口點、依賴與實際服務使用處後才可合併。'
note '**未知**：只有檔名且無服務或套件證據；保持不動，等待人工分類。'
note '在任何新部署前，先將本報告中的對應模組列為：沿用、補完、合併、新建或人工確認；**人工確認預設阻擋覆寫與啟動**。'
