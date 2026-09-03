#!/usr/bin/env bash
#
# Install the canonical organize-chrome-tabs skill into every agent that reads it.
#
# The repo is the single source of truth. Each agent gets an exact copy, so the
# three installs cannot drift apart again.
#
#   ./scripts/sync-skill.sh          install into every target
#   ./scripts/sync-skill.sh --check  exit non-zero if any target is out of sync
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/plugins/organise-chrome-tabs/skills/organize-chrome-tabs"
SKILL_NAME="organize-chrome-tabs"

# Claude Code, Codex, and Copilot CLI each scan their own personal skills root.
TARGETS=(
  "$HOME/.claude/skills/$SKILL_NAME"
  "$HOME/.codex/skills/$SKILL_NAME"
  "$HOME/.copilot/skills/$SKILL_NAME"
)

if [[ ! -f "$SRC/SKILL.md" ]]; then
  echo "error: no SKILL.md at $SRC" >&2
  exit 1
fi

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

status=0
for target in "${TARGETS[@]}"; do
  label="${target/#$HOME/~}"
  if (( CHECK_ONLY )); then
    if [[ ! -d "$target" ]]; then
      echo "MISSING  $label"
      status=1
    elif diff -rq "$SRC" "$target" >/dev/null 2>&1; then
      echo "ok       $label"
    else
      echo "DRIFTED  $label"
      diff -rq "$SRC" "$target" 2>&1 | sed 's/^/           /'
      status=1
    fi
  else
    mkdir -p "$(dirname "$target")"
    # --delete removes files the repo no longer ships, such as the old
    # references/tab-steward.md that predates references/tab-steward-api.md.
    rsync -a --delete "$SRC/" "$target/"
    echo "synced   $label"
  fi
done

exit "$status"
