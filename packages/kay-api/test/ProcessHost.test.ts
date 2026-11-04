import assert from "node:assert/strict"
import { test } from "node:test"
import { closeAll, startGatewayProcess } from "./ProcessHost.ts"

test(
	"an abnormal fixture exit fails cleanup without skipping other resources",
	{ timeout: 15000 },
	async (t) => {
		const config = {
			port: 0,
			internalPort: 0,
			internalToken: "fixture-cleanup-token-with-32-characters",
			publicOrigin: "https://cleanup.integration.test",
			eOrigin: "http://legacy.invalid",
			openbotOrigin: "http://not-started.invalid",
			authBackend: "ledger" as const,
			backendRouting: "ledger" as const,
			// No HTTP requests are served; this lifecycle check does not need a database.
			databaseUrl: "postgres://unused@127.0.0.1:1/unused",
		}
		const broken = await startGatewayProcess({ config })
		t.after(async () => {
			await broken.close().catch(() => undefined)
		})
		const healthy = await startGatewayProcess({ config })
		t.after(() => healthy.close())
		assert.notEqual(broken.pid, healthy.pid)
		assert.notEqual(broken.pid, process.pid)
		process.kill(broken.pid, "SIGKILL")
		let lastResourceClosed = false
		await assert.rejects(
			closeAll([
				async () => {
					lastResourceClosed = true
				},
				() => healthy.close(),
				() => broken.close(),
			]),
			(error: unknown) =>
				error instanceof AggregateError &&
				error.errors.some(
					(error: unknown) =>
						error instanceof Error && error.message.includes("SIGKILL"),
				),
		)
		assert.equal(lastResourceClosed, true)
		await assert.rejects(healthy.stats(), /closed/)
		await assert.rejects(broken.close(), /SIGKILL/)
	},
)
