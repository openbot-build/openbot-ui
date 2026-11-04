#!/usr/bin/env bash
set -euo pipefail
version="${1:?Give a version or sha-<full-commit-hash>}"
ui_root="$(cd "$(dirname "$0")/.." && pwd)"
pnpm --dir "$ui_root" add --save-exact "@openbot-build/client@$version"
pnpm --dir "$ui_root/packages/kay-openbot" add --save-exact "@openbot-build/client@$version"
