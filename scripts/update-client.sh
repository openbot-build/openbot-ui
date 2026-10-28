#!/usr/bin/env bash
set -euo pipefail
ui_root="$(cd "$(dirname "$0")/.." && pwd)"
source_root="$(cd "${1:-$ui_root/../openbot}" && pwd)"
pnpm --dir "$source_root" --filter @openbot-build/client... build
pnpm --dir "$source_root/packages/client" pack --pack-destination "$ui_root/vendor"
node --input-type=module - "$source_root" "$ui_root" <<'JS'
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
const [sourceRoot, uiRoot] = process.argv.slice(2)
const pkg = JSON.parse(readFileSync(join(sourceRoot, "packages/client/package.json"), "utf8"))
const file = `openbot-build-client-${pkg.version}.tgz`
const appPath = join(uiRoot, "package.json")
const app = JSON.parse(readFileSync(appPath, "utf8"))
app.dependencies["@openbot-build/client"] = `file:vendor/${file}`
writeFileSync(appPath, JSON.stringify(app, null, "\t") + "\n")
writeFileSync(join(uiRoot, "vendor/client.json"), JSON.stringify({
  repository: "https://github.com/openbot-build/openbot",
  commit: execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  localChanges: execFileSync("git", ["-C", sourceRoot, "status", "--porcelain"], { encoding: "utf8" }).length > 0,
  file,
  sha256: createHash("sha256").update(readFileSync(join(uiRoot, "vendor", file))).digest("hex"),
}, null, "\t") + "\n")
JS
pnpm --dir "$ui_root" update @openbot-build/client
