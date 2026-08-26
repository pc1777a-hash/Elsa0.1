#!/usr/bin/env bash
set -euo pipefail

# ELSA trading strategy inventory v1
#
# Read-only discovery only. This script never starts, stops, restarts, installs,
# edits, deletes, or deploys anything. It never prints file contents or reads
# .env, credential, key, token, wallet, database, cache, or virtualenv paths.
# It is intended to find safe strategy-source metadata and managed runtime clues.

BRAIN_ROOT="${ELSA_BRAIN_ROOT:-/media/ollama/n1/brain}"
MAX_ITEMS="${ELSA_STRATEGY_MAX_ITEMS:-180}"

section() {
  printf '\n## %s\n' "$1"
}

note() {
  printf -- '- %s\n' "$1"
}

available() {
  command -v "$1" >/dev/null 2>&1
}

safe_time() {
  if stat -c '%y' "$1" >/dev/null 2>&1; then
    stat -c '%y' "$1" | cut -d'.' -f1
  else
    printf 'unreported'
  fi
}

safe_size() {
  if stat -c '%s' "$1" >/dev/null 2>&1; then
    stat -c '%s' "$1"
  else
    printf 'unreported'
  fi
}

artifact_kind() {
  local name
  name="$(basename "$1")"
  case "$name" in
    *strategy*|*alpha*|*signal*|*entry*|*exit*) printf 'strategy-candidate' ;;
    *trade*|*trader*|*execution*|*order*|*position*) printf 'trading-executor-candidate' ;;
    *backtest*|*paper*|*simulat*) printf 'research-or-test-candidate' ;;
    *) printf 'trading-related-source' ;;
  esac
}

is_safe_candidate() {
  local lower
  lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"

  case "$lower" in
    */.git/*|*/.venv/*|*/venv/*|*/node_modules/*|*/__pycache__/*|*/.cache/*|*/.pm2/*|*/secrets/*|*/secret/*|*/keys/*|*/key/*|*/wallet/*|*/credentials/*|*/credential/*|*/private/*|*/data/*|*/memory/*|*/memories/*)
      return 1
      ;;
  esac

  case "$(basename "$lower")" in
    .env|.env.*|*secret*|*token*|*credential*|*apikey*|*api_key*|*private*|*wallet*|id_rsa*|*.pem|*.key|*.p12|*.pfx|*.sqlite|*.db)
      return 1
      ;;
  esac

  return 0
}

strategy_candidates() {
  if [[ ! -d "$BRAIN_ROOT" ]]; then
    note "N1 brain root is missing: $BRAIN_ROOT"
    return
  fi

  local count=0
  while IFS= read -r -d '' path; do
    if ! is_safe_candidate "$path"; then
      continue
    fi

    local lower relative kind bytes modified
    lower="$(printf '%s' "$(basename "$path")" | tr '[:upper:]' '[:lower:]')"
    if [[ ! "$lower" =~ (strategy|alpha|signal|trade|trader|execution|order|position|backtest|paper|simulat) ]]; then
      continue
    fi

    relative="${path#"$BRAIN_ROOT"/}"
    kind="$(artifact_kind "$path")"
    bytes="$(safe_size "$path")"
    modified="$(safe_time "$path")"
    printf -- '- [%s] `%s` — %s bytes, modified %s\n' "$kind" "$relative" "$bytes" "$modified"

    count=$((count + 1))
    if (( count >= MAX_ITEMS )); then
      note "Candidate list capped at $MAX_ITEMS entries; set ELSA_STRATEGY_MAX_ITEMS to raise the safe metadata limit."
      break
    fi
  done < <(
    find "$BRAIN_ROOT" -maxdepth 6 \
      \( -path "$BRAIN_ROOT/.git" -o -path "$BRAIN_ROOT/.venv" -o -path "$BRAIN_ROOT/venv" -o -path "$BRAIN_ROOT/node_modules" -o -path "$BRAIN_ROOT/.elsa_perpetual" -o -path '*/__pycache__' -o -path '*/.cache' \) -prune -o \
      -type f \( -iname '*.py' -o -iname '*.js' -o -iname '*.ts' -o -iname '*.mjs' -o -iname '*.sh' \) -print0 2>/dev/null | sort -z
  )

  if (( count == 0 )); then
    note 'No safe trading-related source filenames were found in the current scan scope.'
  fi
}

printf '# ELSA N1 Trading Strategy Inventory\n\n'
printf '> Generated locally and read-only. This report includes only source filenames, relative paths, file sizes, modification times, and managed-service names/statuses. It does not print file contents, `.env` values, API keys, exchange credentials, wallet data, tokens, or arbitrary configuration values.\n\n'
note "Scan root: \`$BRAIN_ROOT\`"
note "Generated at: \`$(date -u +'%Y-%m-%dT%H:%M:%SZ')\`"

section 'Managed trading runtime evidence'
if available pm2; then
  printf '```text\n'
  pm2 ls --no-color 2>/dev/null | grep -Ei 'name|trade|trader|strategy|bot|elsa' || true
  printf '```\n'
else
  note 'PM2 is unavailable.'
fi

if available systemctl; then
  printf '```text\n'
  systemctl list-units --all --type=service --no-legend 2>/dev/null | grep -Ei 'trade|trader|strategy|bot|elsa' || true
  printf '```\n'
else
  note 'systemctl is unavailable.'
fi

if available docker; then
  printf '```text\n'
  docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null | grep -Ei 'trade|trader|strategy|bot|elsa' || true
  printf '```\n'
else
  note 'Docker is unavailable.'
fi

section 'Safe strategy and trading source candidates'
strategy_candidates

section 'Classification rules'
note '**已部署** only requires an explicit managed runtime entry plus a separately verified health or strategy-status report; a filename alone is not deployment evidence.'
note '**已安裝未接線** means safe source metadata exists without managed-runtime evidence.'
note '**草稿／測試中** means the filename indicates backtesting, simulation, paper, or research; source text has not been inspected.'
note '**半完成／未知** means the report cannot prove purpose, dependency chain, or live execution; preserve it and request a reviewed source sample before any action.'

section 'Next safe step'
note 'Paste this Markdown report back to ELSA. After candidates are classified, share only the selected strategy source files for source-level review; do not paste `.env`, exchange API settings, private keys, wallet data, or complete runtime configuration.'
