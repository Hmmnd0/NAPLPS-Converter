#!/usr/bin/env bash
#
# view.sh — render a NAPLPS .nap file using the bundled 1993 TURSHOW viewer
#           under DOSBox-X.
#
# Usage:   ./view.sh path/to/file.nap
#
# DOSBox-X is NOT bundled (it's a large, platform-specific, GPL binary).
# Install it once with your package manager — see the hint below if missing.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAP="${1:-}"

if [[ -z "$NAP" || ! -f "$NAP" ]]; then
  echo "Usage: $0 path/to/file.nap" >&2
  exit 1
fi

if [[ ! -f "$HERE/TURSHOW.EXE" ]]; then
  echo "TURSHOW.EXE not found in $HERE — it should ship with this folder." >&2
  exit 1
fi

if ! command -v dosbox-x >/dev/null 2>&1; then
  cat >&2 <<'EOF'
dosbox-x not found on your PATH. Install it (one time):

  macOS:    brew install dosbox-x
  Linux:    sudo apt install dosbox-x      # or your distro's package manager
  Windows:  winget install dosbox-x        # or download from https://dosbox-x.com

Then re-run this script.
EOF
  exit 1
fi

# DOS is 8.3-only and dislikes spaces in mount paths, so stage the viewer and a
# short-named copy of the .nap in a clean temp directory, then mount that as C:.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$HERE/TURSHOW.EXE" "$WORK/TURSHOW.EXE"
cp "$NAP" "$WORK/VIEW.NAP"

echo "Rendering $(basename "$NAP") in TURSHOW (close the DOSBox-X window to exit)…"
dosbox-x -fastlaunch \
  -c "mount c $WORK" \
  -c "c:" \
  -c "TURSHOW VIEW.NAP -vga"
