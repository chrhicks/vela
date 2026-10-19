#!/usr/bin/env bash
set -euo pipefail
umask 077

if ! command -v jq >/dev/null 2>&1; then
  printf 'jq is required to preserve the existing alerts configuration.\n' >&2
  exit 1
fi

read -rs -p 'Pushover application token: ' pushover_token
printf '\n'
if [[ ! "$pushover_token" =~ ^[A-Za-z0-9]{20,64}$ ]]; then
  printf 'The application token must contain 20 to 64 letters or digits.\n' >&2
  exit 1
fi

read -rs -p 'Pushover user key: ' pushover_user
printf '\n'
if [[ ! "$pushover_user" =~ ^[A-Za-z0-9]{20,64}$ ]]; then
  printf 'The user key must contain 20 to 64 letters or digits.\n' >&2
  exit 1
fi

config_dir="${VELA_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/vela}"
mkdir -p "$config_dir"
configuration="$config_dir/alerts.json"
temporary=$(mktemp "$config_dir/.alerts.json.XXXXXX")
trap 'rm -f "$temporary"' EXIT

merge='.pushover = {token: env.PUSHOVER_TOKEN, user: env.PUSHOVER_USER}'
if [[ -e "$configuration" ]]; then
  PUSHOVER_TOKEN="$pushover_token" PUSHOVER_USER="$pushover_user" \
    jq -e "if type == \"object\" then $merge else error(\"Alerts configuration must be an object\") end" \
    "$configuration" >"$temporary"
else
  PUSHOVER_TOKEN="$pushover_token" PUSHOVER_USER="$pushover_user" \
    jq -n "$merge" >"$temporary"
fi

mv "$temporary" "$configuration"
chmod 600 "$configuration"
printf 'Wrote %s with mode 600.\n' "$configuration"
printf 'Restart the server with docker compose restart server.\n'
