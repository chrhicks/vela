#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: web-preview.sh [--commit REF]" >&2
  exit 1
}

main() {
  local commit=origin/main
  while [ $# -gt 0 ]; do
    case $1 in
      --commit) [ $# -ge 2 ] || usage; commit=$2; shift 2 ;;
      *) usage ;;
    esac
  done

  local checkout=$HOME/dev/personal/vela-web-preview unit=vela-web-preview

  [ "$(cd "$(dirname "$0")/.." && pwd -P)" = "$(cd "$checkout" && pwd -P)" ] || { echo "web-preview.sh: run it from $checkout/deploy: the unit serves the app from there" >&2; exit 1; }

  git -C "$checkout" fetch --quiet origin
  git -C "$checkout" checkout --quiet --detach "$commit"
  echo "web-preview: at $(git -C "$checkout" rev-parse --short HEAD)"

  (cd "$checkout" && pnpm install --frozen-lockfile && pnpm --dir web build)

  mkdir -p "$HOME/.config/systemd/user"
  local source=$checkout/deploy/$unit.service target=$HOME/.config/systemd/user/$unit.service
  [ "$(readlink "$target" || true)" = "$source" ] || rm -f "$target"
  systemctl --user link "$source"
  systemctl --user enable "$unit"
  systemctl --user daemon-reload
  systemctl --user restart "$unit"
  echo "web-preview: serving on 127.0.0.1:8794"
}

main "$@"
