import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

/**
 * The OpenBot server that the development server sends API calls to. The devenv
 * proxy serves it at http://localhost. Browsers treat localhost as a secure
 * place, so the `__Host-` session cookie works without HTTPS.
 */
const apiOrigin = process.env.OPENBOT_DEV_PUBLIC_ORIGIN ?? "http://localhost"

const proxy = {
	target: apiOrigin,
	// The devenv proxy finds the server by the host name.
	changeOrigin: true,
	// OpenBot accepts writes and WebSockets with the session cookie only from its
	// exact public origin. The page and the API look like one origin to the browser.
	headers: { origin: apiOrigin },
}

export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [tailwindcss(), react()],
	server: {
		port: 5173,
		// `ws` also sends the Live WebSocket of a live Chat to OpenBot.
		proxy: { "/v1": { ...proxy, ws: true }, "/auth": proxy, "/health": proxy },
	},
	preview: { port: 5173 },
})
