import { defineConfig } from "vite"
import { readFileSync } from "node:fs"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { lingui } from "@lingui/vite-plugin"

const origin = process.env.OPENBOT_DEV_PUBLIC_ORIGIN ?? "http://localhost:5180"
const target = process.env.OPENBOT_DEV_API_ORIGIN ?? "http://127.0.0.1:3000"
const productOrigin = process.env.OPENBOT_UI_GATEWAY ?? "http://127.0.0.1:3100"
const api = { target, changeOrigin: true, headers: { origin }, ws: true }

export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
		lingui({
			macroTransform: true,
			failOnMissing: "catalog",
			failOnCompileError: true,
		}),
		{
			name: "third-party-notices",
			generateBundle() {
				this.emitFile({
					type: "asset",
					fileName: "THIRD_PARTY_NOTICES.txt",
					source: readFileSync(
						new URL("./THIRD_PARTY_NOTICES.md", import.meta.url),
						"utf8",
					),
				})
			},
		},
		tailwindcss(),
		react(),
	],
	build: { license: { fileName: "licenses/dependencies.md" } },
	server: {
		port: 5180,
		proxy: {
			"/api/kay": {
				target: productOrigin,
				changeOrigin: false,
				headers: { origin },
				ws: true,
			},
			"/v1": api,
			"/auth": api,
			"/health": api,
		},
	},
	preview: { port: 5180 },
})
