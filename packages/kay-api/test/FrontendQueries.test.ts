import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { test } from "node:test"
import { Schema } from "effect"
import { createNativeClient } from "@kaicom/kay-openbot"
import { filesPageInput } from "../../../src/next/features/FilesQuery.ts"

test("workspace file and generated form queries use the native SDK's decoded types", async () => {
	const paths: URL[] = []
	const server = createServer((req, res) => {
		paths.push(new URL(req.url ?? "/", "https://core.example"))
		res
			.writeHead(200, { "content-type": "application/json" })
			.end(JSON.stringify({ items: [], next: null }))
	})
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	try {
		const address = server.address()
		if (address === null || typeof address === "string")
			throw new Error("Expected TCP")
		const client = createNativeClient({
			origin: `http://127.0.0.1:${address.port}`,
		})({ headers: new Headers(), signal: AbortSignal.timeout(5000) })
		const catalog = Schema.decodeUnknownSync(
			Schema.Array(
				Schema.Struct({
					id: Schema.String,
					query: Schema.NullOr(Schema.JsonObject),
				}),
			),
		)(await (await client.request({ operation: "featureCatalog" })).json())
		const field = (id: string, name: string) => {
			const query = catalog.find((entry) => entry.id === id)?.query
			assert.deepEqual(
				query?.["required"],
				[],
				"Optional queries stay optional",
			)
			const fields = Schema.decodeUnknownSync(
				Schema.Record(Schema.String, Schema.JsonObject),
			)(query?.["properties"])
			return fields[name]!
		}
		assert.equal(field("files.listFiles", "limit")["type"], "integer")
		assert.equal(field("usage.listUsageEvents", "limit")["type"], "integer")
		assert.equal(field("chats.chatItems", "before")["type"], "integer")
		assert.equal(field("bots.listBots", "archived")["type"], "boolean")
		assert.equal(field("usage.listUsageEvents", "from")["type"], "string")
		for (const [id, input] of [
			["files.listFiles", filesPageInput()],
			["files.listFiles", filesPageInput("file-previous")],
			// These are the numeric values emitted by SchemaForm for integer metadata.
			[
				"usage.listUsageEvents",
				{ query: { limit: Number("25"), from: "2026-10-01T00:00:00Z" } },
			],
			[
				"chats.chatItems",
				{
					params: { chatId: "chat-a" },
					query: { before: Number("3"), limit: Number("20") },
				},
			],
			["bots.listBots", { query: { archived: false } }],
			["files.listFiles", {}],
		] as const) {
			const response = await client.request({
				operation: "feature",
				id,
				payload: input,
			})
			assert.equal(
				response.status,
				200,
				`${id} must pass FeatureDispatch before reaching HTTP`,
			)
			await response.body?.cancel()
		}
		assert.deepEqual(
			paths.map((url) => [url.pathname, Object.fromEntries(url.searchParams)]),
			[
				["/v1/files", { limit: "48" }],
				["/v1/files", { limit: "48", after: "file-previous" }],
				[
					"/v1/organization/usage/events",
					{ limit: "25", from: "2026-10-01T00:00:00Z" },
				],
				["/v1/chats/chat-a/items", { before: "3", limit: "20" }],
				["/v1/bots", { archived: "false" }],
				["/v1/files", {}],
			],
		)
		const rejected = await client.request({
			operation: "feature",
			id: "files.listFiles",
			payload: { query: { limit: "48" } },
		})
		assert.equal(rejected.status, 400)
		assert.equal(paths.length, 6)
	} finally {
		server.closeAllConnections()
		await new Promise<void>((resolve, reject) =>
			server.close((error) =>
				error === undefined ? resolve() : reject(error),
			),
		)
	}
})
