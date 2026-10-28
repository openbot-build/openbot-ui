#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# The first registry release has no lockfile yet. Save it after that install.
if [ -f "$root/pnpm-lock.yaml" ]; then
  pnpm --dir "$root" install --frozen-lockfile --store-dir "$root/.cache/pnpm"
else
  pnpm --dir "$root" install --no-frozen-lockfile --store-dir "$root/.cache/pnpm"
fi
