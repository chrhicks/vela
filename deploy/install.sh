#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: install.sh thuban [--commit REF]" >&2
  exit 1
}

main() {
  [ $# -ge 1 ] || usage
  local machine=$1 commit=origin/main
  shift
  while [ $# -gt 0 ]; do
    case $1 in
      --commit) [ $# -ge 2 ] || usage; commit=$2; shift 2 ;;
      *) usage ;;
    esac
  done

  local checkout units enabled programs
  case $machine in
    thuban)
      checkout=$HOME/dev/personal/vela-run
      units=(vela)
      enabled=(vela)
      programs=(vela)
      ;;
    *) usage ;;
  esac

  [ "$(cd "$(dirname "$0")/.." && pwd -P)" = "$(cd "$checkout" && pwd -P)" ] || { echo "install.sh: run it from $checkout/deploy: the units run the programs from there" >&2; exit 1; }

  git -C "$checkout" fetch --quiet origin
  git -C "$checkout" checkout --quiet --detach "$commit"
  echo "install: $machine at $(git -C "$checkout" rev-parse --short HEAD)"

  (cd "$checkout" && pnpm install --frozen-lockfile --prod)

  mkdir -p "$HOME/.config/systemd/user"
  local unit source target
  for unit in "${units[@]}"; do
    source=$checkout/deploy/$unit.service
    target=$HOME/.config/systemd/user/$unit.service
    [ "$(readlink "$target" || true)" = "$source" ] || rm -f "$target"
    systemctl --user link "$source"
  done
  systemctl --user enable "${enabled[@]}"
  systemctl --user daemon-reload

  for unit in "${programs[@]}"; do
    systemctl --user restart "$unit"
    echo "install: restarted $unit"
  done
}

main "$@"
