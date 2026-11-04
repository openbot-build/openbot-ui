import assert from "node:assert/strict"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { test } from "node:test"
import { Pool } from "pg"
import type { Configuration } from "../src/Configuration.ts"
import { runtime } from "../src/Database.ts"
import { createGateway } from "../src/Gateway.ts"
import { checkReadiness } from "../src/Readiness.ts"
import { start } from "./PostgresTest.ts"

const listen = async (server: Server) => {
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	const address = server.address()
	if (address === null || typeof address === "string")
		throw new Error("Expected TCP")
	return `http://127.0.0.1:${address.port}`
}
const close = (server: Server) => {
	server.closeAllConnections()
	return new Promise<void>((resolve, reject) =>
		server.close((error) => (error === undefined ? resolve() : reject(error))),
	)
}

test(
	"release readiness reads real PostgreSQL and rejects an unhealthy executor or broken gateway contract",
	{ timeout: 30000 },
	async () => {
		const database = await start()
		const pool = new Pool({ connectionString: database.url })
		let healthy = true,
			signedOut = true,
			schemaAvailable = true
		const requests: string[] = []
		const platform = createServer((req, res) => {
			requests.push(req.method ?? "")
			res.setHeader("content-type", "application/json")
			if (req.url === "/health") {
				res.writeHead(healthy ? 200 : 503)
				res.end(JSON.stringify({ status: healthy ? "ok" : "unavailable" }))
			} else if (req.url === "/auth/session") {
				res.writeHead(signedOut ? 401 : 500)
				res.end('{"_tag":"AuthenticationRequired"}')
			} else if (req.url === "/openapi.json") {
				res.end(
					JSON.stringify(
						schemaAvailable
							? { openapi: "3.1.0", paths: { "/v1/sessions": {} } }
							: { status: "ok" },
					),
				)
			} else {
				res.writeHead(404)
				res.end("{}")
			}
		})
		const platformOrigin = await listen(platform)
		const config: Configuration = {
			port: 3100,
			internalPort: 3101,
			internalToken: "test-internal-key-32-characters-long",
			publicOrigin: "https://kay.example",
			eOrigin: platformOrigin,
			openbotOrigin: "http://127.0.0.1:1",
			authBackend: "e",
			backendRouting: "e",
			databaseUrl: database.url,
		}
		const db = runtime(config)
		const gateway = createGateway({ config, db })
		const origin = await listen(gateway)
		try {
			await assert.rejects(
				checkReadiness({ config, db, origin }),
				/database readiness failed/,
			)
			assert.equal(requests.length, 0)
			await pool.query(
				await readFile(
					new URL("../migrations/001_business.sql", import.meta.url),
					"utf8",
				),
			)
			await checkReadiness({ config, db, origin })
			await assert.rejects(
				checkReadiness({ config, db, origin: platformOrigin }),
				/health/,
			)
			healthy = false
			assert.equal((await fetch(origin + "/health")).status, 200)
			await assert.rejects(
				checkReadiness({ config, db, origin }),
				/e runtime is unavailable/,
			)
			healthy = true
			signedOut = false
			await assert.rejects(
				checkReadiness({ config, db, origin }),
				/auth\/session/,
			)
			signedOut = true
			schemaAvailable = false
			await assert.rejects(
				checkReadiness({ config, db, origin }),
				/Platform API/,
			)
			schemaAvailable = true
			await checkReadiness({ config, db, origin })
			await pool.query("DROP TABLE kay_preferences")
			await assert.rejects(
				checkReadiness({ config, db, origin }),
				/database readiness failed/,
			)
			assert.ok(requests.length > 0)
			assert.ok(requests.every((method) => method === "GET"))
		} finally {
			await close(gateway)
			await close(platform)
			await db.dispose()
			await pool.end()
			await database.close()
		}
	},
)
