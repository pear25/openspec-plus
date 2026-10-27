#!/usr/bin/env bash
# One-time setup: check prerequisites, enable the workflows openspec-plus
# relies on, then build and install everything via scripts/sync.sh.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

for cmd in openspec node git; do
  command -v "$cmd" >/dev/null || { echo "missing: $cmd (see README prerequisites)" >&2; exit 1; }
done

# Core workflows plus verify (independent check before archive).
openspec config set profile custom >/dev/null
openspec config set workflows '["propose","explore","apply","update","sync","archive","verify"]' >/dev/null

"$here/scripts/sync.sh"

# Put the `openspec-plus` checker on PATH (a symlink, so `git pull` updates it).
npm install -g "$here" >/dev/null
echo "openspec-plus CLI: $(command -v openspec-plus)"

cat <<'EOF'

Done. In each repo where you want OpenSpec, run:
  openspec init --tools none
(--tools none creates only openspec/; the skills are already global.)
EOF
