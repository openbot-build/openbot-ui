import { readFile, readdir } from "node:fs/promises"
import { Client } from "pg"
import { databaseFromEnvironment } from "./Configuration.ts"

const client = new Client({
	connectionString: databaseFromEnvironment(process.env).databaseUrl,
})
try {
	const directory = new URL("../migrations/", import.meta.url)
	const names = (await readdir(directory))
		.filter((name) => /^\d+_.*\.sql$/.test(name))
		.sort()
	const migrations = await Promise.all(
		names.map((name) => readFile(new URL(name, directory), "utf8")),
	)
	await client.connect()
	await client.query("BEGIN")
	try {
		// A parameterless pg query uses the simple-query protocol for the whole SQL file.
		for (const sql of migrations) await client.query(sql)
		await client.query("COMMIT")
	} catch (error) {
		await client.query("ROLLBACK")
		throw error
	}
} finally {
	await client.end()
}
