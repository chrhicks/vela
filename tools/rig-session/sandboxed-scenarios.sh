#!/usr/bin/env bash
# Runs the scenarios with the whole file system read-only except one fresh temporary folder, so a
# write anywhere else fails instead of going unnoticed. Needs bubblewrap (bwrap) and CRIA_CHECKOUT.
set -euo pipefail
cd "$(dirname "$0")/../.."

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT

TMPDIR=$temporary bwrap --ro-bind / / --dev /dev --proc /proc --bind "$temporary" "$temporary" \
  node node_modules/vitest/vitest.mjs run --configLoader runner --config tools/rig-session/vitest.scenarios.mts "$@"
