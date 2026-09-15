#!/usr/bin/env bash
# Irodori-TTS-Server を起動する。初回はモデルを Hugging Face から取得するので時間がかかる。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ ! -d "$HERE/server/.venv" ]; then
  echo "server/ が未セットアップ。docs/05_TTS導入.md の手順を実行する" >&2
  exit 1
fi
set -a; source "$HERE/.env"; set +a
cd "$HERE/server"
exec uv run --no-sync python -m irodori_openai_tts --host "${IRODORI_HOST}" --port "${IRODORI_PORT}"
