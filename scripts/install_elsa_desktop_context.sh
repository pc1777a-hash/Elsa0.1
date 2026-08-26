#!/usr/bin/env bash
# ELSA V5 Desktop Context Installer
# Run this script from the desktop itself. It writes all generated files beneath the desktop directory.

set -Eeuo pipefail

SYSTEM_BIBLE_URL="https://brain.pin-yi.uk/api/system/bible"
ELSA_PORTRAIT_URL="https://files.manuscdn.com/user_upload_by_module/session_file/310519663895751073/iZiDyTcuBQigVZsR.png"
ELSA_SOFT_PORTRAIT_URL="https://files.manuscdn.com/user_upload_by_module/session_file/310519663895751073/txvUhRGFtBYdHMOU.png"
ELSA_CEREMONY_URL="https://files.manuscdn.com/user_upload_by_module/session_file/310519663895751073/xbSSWfrYJcjKrSdo.jpg"
ELSA_INTRO_VIDEO_URL="https://files.manuscdn.com/user_upload_by_module/session_file/310519663895751073/gECyrhTuoajXHqPC.mp4"
DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
TARGET_DIR="$DESKTOP_DIR/ELSA-V5-Mobile"
PERSONA_DIR="$TARGET_DIR/persona"

mkdir -p "$TARGET_DIR" "$PERSONA_DIR"

curl -fsSL "$SYSTEM_BIBLE_URL" -o "$TARGET_DIR/system-bible.json"
curl -fsSL "$ELSA_PORTRAIT_URL" -o "$PERSONA_DIR/elsa-portrait.png"
curl -fsSL "$ELSA_SOFT_PORTRAIT_URL" -o "$PERSONA_DIR/elsa-soft-portrait.png"
curl -fsSL "$ELSA_CEREMONY_URL" -o "$PERSONA_DIR/elsa-ceremony.jpg"
curl -fsSL "$ELSA_INTRO_VIDEO_URL" -o "$PERSONA_DIR/elsa-intro.mp4"

cat > "$TARGET_DIR/README.txt" <<'EOF'
ELSA V5 Mobile — Desktop Context

This folder was created on the desktop by the ELSA setup script.

Files:
- system-bible.json: latest public ELSA V5 architecture status retrieved from brain.pin-yi.uk.
- verify-elsa-services.sh: fetches the current architecture status again and prints it.
- persona/elsa-portrait.png: ELSA primary portrait for the dashboard and assistant avatar.
- persona/elsa-soft-portrait.png: ELSA secondary portrait for conversational use.
- persona/elsa-ceremony.jpg: ELSA ceremony artwork archive.
- persona/elsa-intro.mp4: ELSA provided video archive.

The Mobile App uses a separate configurable service URL for conversation, plugin, and exchange APIs. Store API credentials only on the existing ELSA service, never in the mobile App or this folder.
EOF

cat > "$TARGET_DIR/verify-elsa-services.sh" <<'BASH'
#!/usr/bin/env bash
set -Eeuo pipefail

SYSTEM_BIBLE_URL="https://brain.pin-yi.uk/api/system/bible"
curl -fsSL "$SYSTEM_BIBLE_URL"
printf '\n'
BASH

chmod 700 "$TARGET_DIR/verify-elsa-services.sh"

printf '\nELSA V5 desktop context is ready.\n'
printf 'Folder: %s\n' "$TARGET_DIR"
printf 'Architecture file: %s\n' "$TARGET_DIR/system-bible.json"
printf 'Persona archive: %s\n' "$PERSONA_DIR"
printf 'Verification: %s\n\n' "$TARGET_DIR/verify-elsa-services.sh"
