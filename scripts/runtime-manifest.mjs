import { writeFile, readFile } from "node:fs/promises"

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
await writeFile(new URL("../dist/openbot-runtime.json", import.meta.url), JSON.stringify({
	version: 1,
	package: manifest.name,
	packageVersion: manifest.version,
	entry: "index.html",
}, null, 2) + "\n")
