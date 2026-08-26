#!/usr/bin/env bash
set -euo pipefail

# ELSA voice deployment preflight.
# This script only reads service metadata, filenames, and package names. It never
# installs packages, restarts services, opens config contents, or prints secrets.

BRAIN_ROOT="${ELSA_BRAIN_ROOT:-/media/ollama/n1/brain}"

found_existing=0
found_partial=0

section() {
  printf '\n=== %s ===\n' "$1"
}

status_line() {
  printf '%-30s %s\n' "$1" "$2"
}

command_state() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    status_line "$name" "available"
  else
    status_line "$name" "not found"
  fi
}

known_dir() {
  local path="$1"
  local label="$2"
  if [[ -d "$path" ]]; then
    status_line "$label" "present: $path"
    found_partial=$((found_partial + 1))
  else
    status_line "$label" "absent"
  fi
}

python_package() {
  local package="$1"
  if python3 -m pip show "$package" >/dev/null 2>&1; then
    local version
    version="$(python3 -m pip show "$package" 2>/dev/null | awk -F': ' '$1 == "Version" { print $2; exit }')"
    status_line "Python package $package" "installed${version:+ ($version)}"
    found_existing=$((found_existing + 1))
  else
    status_line "Python package $package" "not installed"
  fi
}

printf 'ELSA Aixi Voice Deployment Preflight v1\n'
printf 'Brain root: %s\n' "$BRAIN_ROOT"
printf 'Mode: read-only; no packages, services, files, models, credentials, or configurations are changed.\n'

section "Runtime tools"
for tool in python3 node npm pnpm pm2 docker ollama ffmpeg nvidia-smi; do
  command_state "$tool"
done

section "Known local voice directories"
known_dir "$BRAIN_ROOT/voice" "ELSA voice directory"
known_dir "$BRAIN_ROOT/tts" "ELSA TTS directory"
known_dir "$BRAIN_ROOT/speech" "ELSA speech directory"
known_dir "$BRAIN_ROOT/whisper" "ELSA Whisper directory"
known_dir "$BRAIN_ROOT/.venv" "ELSA virtual environment"
known_dir "$BRAIN_ROOT/venv" "ELSA virtual environment"
known_dir "$HOME/.cache/huggingface" "Hugging Face model cache"

section "Known Python voice packages"
if command -v python3 >/dev/null 2>&1; then
  for package in TTS coqui-tts kokoro-onnx kokoro faster-whisper openai-whisper whisperx edge-tts piper-tts; do
    python_package "$package"
  done
else
  echo 'python3 unavailable; Python package inspection skipped.'
fi

section "Managed service indicators"
if command -v pm2 >/dev/null 2>&1; then
  pm2 ls --no-color 2>/dev/null | grep -Ei 'elsa|voice|tts|speech|whisper|piper|kokoro' || echo 'No matching PM2 process names reported.'
else
  echo 'PM2 unavailable; PM2 inspection skipped.'
fi

if command -v docker >/dev/null 2>&1; then
  docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null | grep -Ei 'voice|tts|speech|whisper|piper|kokoro|coqui' || echo 'No matching running containers reported.'
else
  echo 'Docker unavailable; container inspection skipped.'
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl list-units --all --type=service --no-legend 2>/dev/null | grep -Ei 'voice|tts|speech|whisper|piper|kokoro|coqui' || echo 'No matching system services reported.'
else
  echo 'systemctl unavailable; system-service inspection skipped.'
fi

section "Safe filename indicators under brain root"
if [[ -d "$BRAIN_ROOT" ]]; then
  matches="$(find "$BRAIN_ROOT" -maxdepth 3 -type f \( -iname '*voice*' -o -iname '*tts*' -o -iname '*speech*' -o -iname '*whisper*' -o -iname '*piper*' -o -iname '*kokoro*' \) -printf '%p\n' 2>/dev/null | head -n 40 || true)"
  if [[ -n "$matches" ]]; then
    printf '%s\n' "$matches"
    found_partial=$((found_partial + 1))
  else
    echo 'No matching filenames found (file contents were not read).'
  fi
else
  echo "Brain root is missing: $BRAIN_ROOT"
fi

section "Available Ollama model names"
if command -v ollama >/dev/null 2>&1; then
  ollama list 2>/dev/null || echo 'Ollama model inventory unavailable.'
else
  echo 'Ollama unavailable; model inventory skipped.'
fi

section "Deployment decision"
if (( found_existing > 0 )); then
  echo 'RECOMMENDATION: REVIEW_EXISTING'
  echo 'Reason: a known voice runtime package was found. Reuse or complete the existing stack before installing another one.'
elif (( found_partial > 0 )); then
  echo 'RECOMMENDATION: REVIEW_OR_COMPLETE'
  echo 'Reason: voice-related directories or filenames were found, but no supported runtime was confirmed.'
else
  echo 'RECOMMENDATION: CLEAN_INSTALL_CANDIDATE'
  echo 'Reason: no known local voice stack indicator was found. Select a TTS provider and produce a separate deployment plan.'
fi

echo
echo 'This preflight intentionally does not inspect .env files, token values, API keys, model contents, audio contents, or arbitrary configuration files.'
