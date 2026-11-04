import { isAbsolute } from "node:path"
import { databaseFromEnvironment } from "./Configuration.ts"
import { runtime } from "./Database.ts"
import {
	recoverBasicComputeBroker,
	startBasicComputeBroker,
} from "./BasicComputeBroker.ts"

const required = (name: string) => {
	const value = process.env[name]
	if (value === undefined || value === "")
		throw new Error(`Set ${name} before starting the basic task broker.`)
	return value
}

const recovering = process.argv.length === 3 && process.argv[2] === "--recover"
const main = async () => {
	if (process.argv.length !== 2 && !recovering)
		throw new Error("The basic task broker accepts only --recover.")
	const database = databaseFromEnvironment(process.env)
	const origin = new URL(required("KAY_OPENBOT_ORIGIN"))
	if (
		!["http:", "https:"].includes(origin.protocol) ||
		origin.username !== "" ||
		origin.password !== "" ||
		origin.pathname !== "/" ||
		origin.search !== "" ||
		origin.hash !== ""
	)
		throw new Error("Use a plain private OpenBot HTTP origin.")
	const socketPath = required("KAY_BASIC_COMPUTE_SOCKET")
	const keyFile = required("KAY_BASIC_COMPUTE_KEY_FILE")
	for (const value of [socketPath, keyFile])
		if (!isAbsolute(value) || value.includes("\0"))
			throw new Error("Basic compute paths must be absolute local paths.")
	if (socketPath === keyFile)
		throw new Error("The compute socket and key require separate paths.")

	const db = runtime(database)
	if (recovering) {
		try {
			await recoverBasicComputeBroker({ db, origin: origin.origin, keyFile })
			process.stdout.write(
				"Saved basic task workspace cleanup completed. No service was started.\n",
			)
		} finally {
			await db.dispose()
		}
		return
	}
	const starting = startBasicComputeBroker({
		db,
		origin: origin.origin,
		socketPath,
		keyFile,
	})
	let stopping: Promise<void> | undefined
	const removeHandlers = () => {
		process.off("SIGTERM", stop)
		process.off("SIGINT", stop)
	}
	const stop = () => {
		if (stopping !== undefined) return
		stopping = starting
			.then((broker) => broker.close())
			.finally(() => db.dispose())
		void stopping.then(removeHandlers, () => {
			removeHandlers()
			// Keep credentials and task output out of process-level error reports.
			process.stderr.write(
				"Basic task broker shutdown failed. Retain its saved lease and check container removal before restarting.\n",
			)
			process.exit(1)
		})
	}
	process.once("SIGTERM", stop)
	process.once("SIGINT", stop)
	try {
		await starting
		if (stopping === undefined)
			process.stdout.write("Basic task broker ready on its private socket.\n")
	} catch {
		removeHandlers()
		await db.dispose()
		throw new Error("Basic task broker startup failed.")
	}
}

void main().catch(() => {
	process.stderr.write(
		recovering
			? "Basic task recovery failed. Retain the saved lease and inspect container removal before restarting. No service was started.\n"
			: "Basic task broker startup failed. Check its private configuration, database migrations, key permissions and pinned Docker image.\n",
	)
	process.exit(1)
})
