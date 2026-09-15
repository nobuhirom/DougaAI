#!/usr/bin/env bash
# 生成した立ち絵の背景を透過にして、キャラクターの表情スプライトとして置く。
#   tools/characters/make-sprite.sh <入力.png> <characterId> <expression>
# 例: tools/characters/make-sprite.sh ~/Downloads/kaede-base.png kaede normal
#   → characters/kaede/expressions/normal.png（透過 PNG）
set -euo pipefail
in="$1"; cid="$2"; expr="$3"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out_dir="$root/characters/$cid/expressions"
mkdir -p "$out_dir"
REMBG="${REMBG:-$HOME/.local/bin/rembg}"
[ -x "$REMBG" ] || { echo "rembg が無い: uv tool install 'rembg[cli]'" >&2; exit 1; }
"$REMBG" i -m isnet-anime "$in" "$out_dir/$expr.png"
# 余白を詰めて寸法を出す（Remotion 側の size に使う）
python3 - "$out_dir/$expr.png" <<'PY'
import sys, struct, zlib
p = sys.argv[1]
d = open(p, 'rb').read()
w, h = struct.unpack('>II', d[16:24])
print(f"{p}: {w}x{h}")
PY
