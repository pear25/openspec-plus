#!/usr/bin/env bash
# Rebuild the global OpenSpec setup for Claude Code:
#   1. the user-level spec-driven schema (package schema + overlay/)
#   2. the OpenSpec skills and /opsx commands in ~/.claude
# `openspec init` only writes per-project files, so step 2 generates them in a
# throwaway project and copies them out. Workflows come from the global
# profile (`openspec config list`). Re-run after `brew upgrade openspec`, after
# changing the profile, or after editing overlay/.
set -euo pipefail

CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
here="$(cd "$(dirname "$0")" && pwd)"

node "$here/build-schema.mjs"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

(cd "$tmp" && git init -q && openspec init --tools claude --no-animation >/dev/null)

mkdir -p "$CLAUDE_DIR/skills" "$CLAUDE_DIR/commands"

# Replace only OpenSpec-owned entries so removed workflows don't linger.
rm -rf "$CLAUDE_DIR"/skills/openspec-* "$CLAUDE_DIR/commands/opsx"
cp -R "$tmp"/.claude/skills/openspec-* "$CLAUDE_DIR/skills/"
cp -R "$tmp/.claude/commands/opsx" "$CLAUDE_DIR/commands/"

echo "OpenSpec $(openspec --version) installed into $CLAUDE_DIR:"
ls -d "$CLAUDE_DIR"/skills/openspec-* | sed 's|.*/|  skill   |'
ls "$CLAUDE_DIR/commands/opsx" | sed 's|^|  /opsx:|; s|\.md$||'
