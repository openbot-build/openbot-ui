import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import {
	spawnSync,
	type ChildProcessWithoutNullStreams,
} from "node:child_process"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import { constants } from "node:fs"
import path from "node:path"
import { mkdtemp, rm, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import {
	basicComputeImage,
	basicComputeLimits,
	BasicComputeFailure,
	makeBasicComputeDocker,
	type LeaseRef,
	type DockerDependencies,
} from "../src/BasicComputeDocker.ts"
import { basicComputeWorker } from "../src/BasicComputeWorker.ts"

class Process extends EventEmitter {
	readonly stdin = new PassThrough()
	readonly stdout = new PassThrough()
	readonly stderr = new PassThrough()
	closed = false
	requests: Array<Record<string, unknown>> = []
	kill() {
		this.end(137)
		return true
	}
	end(code = 0) {
		if (this.closed) return
		this.closed = true
		this.stdout.end()
		this.stderr.end()
		queueMicrotask(() => this.emit("close", code))
	}
	event(event: unknown) {
		this.stdout.write(JSON.stringify(event) + "\n")
	}
}
const reference: LeaseRef = {
	leaseId: "lease-fixture-1234",
	containerName: "kay-basic-fixture-1234",
}
const other: LeaseRef = {
	leaseId: "lease-fixture-5678",
	containerName: "kay-basic-fixture-5678",
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const failure = (code: string) => (error: unknown) =>
	error instanceof BasicComputeFailure && error.code === code

const fixture = (internet?: DockerDependencies["internet"]) => {
	const calls: Array<ReadonlyArray<string>> = []
	const workers: Array<Process> = []
	let pendingCreate: Process | undefined
	const timers: Array<{
		milliseconds: number
		callback: () => void
		canceled: boolean
	}> = []
	const state = {
		present: false,
		blockedRemoval: false,
		malformed: false,
		cleanupFails: false,
		foreign: false,
		linux: true,
		daemon: true,
		holdCreate: false,
		fileValue: [] as unknown,
	}
	const driver = makeBasicComputeDocker({
		...(internet === undefined ? {} : { internet }),
		spawn: (args) => {
			calls.push(args)
			const child = new Process()
			if (args[0] === "exec") {
				workers.push(child)
				let buffer = ""
				child.stdin.on("data", (chunk: Buffer) => {
					buffer += chunk.toString("utf8")
					let newline: number
					while ((newline = buffer.indexOf("\n")) !== -1) {
						const request = JSON.parse(buffer.slice(0, newline)) as Record<
							string,
							unknown
						>
						buffer = buffer.slice(newline + 1)
						child.requests.push(request)
						queueMicrotask(() => {
							if (request["mode"] === "command") child.event({ event: "ready" })
							else if (request["mode"] === "health") {
								child.event({ event: "result", value: { idlePid: 7 } })
								child.end()
							} else if (request["mode"] === "cleanup") {
								child.event(
									state.cleanupFails
										? { event: "error", message: "Processes remain." }
										: { event: "result", value: null },
								)
								child.end()
							} else if (request["mode"] === "file") {
								if (state.malformed)
									child.stdout.write("invalid worker response\n")
								else child.event({ event: "result", value: state.fileValue })
								child.end()
							}
						})
					}
				})
			} else {
				child.stdin.on("finish", () =>
					queueMicrotask(() => {
						if (!state.daemon) {
							child.end(1)
							return
						}
						if (args[0] === "container")
							child.stdout.write(state.present ? "fixture-container-id\n" : "")
						if (args[0] === "create") {
							if (state.holdCreate) {
								pendingCreate = child
								return
							}
							state.present = true
							child.stdout.write("fixture-container-id\n")
						}
						if (args[0] === "inspect")
							child.stdout.write(
								JSON.stringify({
									"com.kai.purpose": state.foreign
										? "other"
										: "kay-basic-compute",
									"com.kai.lease": reference.leaseId,
								}),
							)
						if (args[0] === "rm") {
							if (state.blockedRemoval) {
								child.end(1)
								return
							}
							state.present = false
						}
						if (args[0] === "info")
							child.stdout.write(state.linux ? "linux\n" : "windows\n")
						if (args[0] === "image")
							child.stdout.write("sha256:" + "a".repeat(64) + "\n")
						child.end()
					}),
				)
			}
			return child as unknown as ChildProcessWithoutNullStreams
		},
		schedule: (callback, milliseconds) => {
			const timer = { callback, milliseconds, canceled: false }
			timers.push(timer)
			return () => {
				timer.canceled = true
			}
		},
	})
	const command = () => {
		const value = workers.findLast(
			(child) => child.requests[0]?.["mode"] === "command",
		)
		assert.ok(value)
		return value
	}
	const finishCreate = () => {
		assert.ok(pendingCreate)
		state.present = true
		if (!pendingCreate.closed) {
			pendingCreate.stdout.write("fixture-container-id\n")
			pendingCreate.end()
		}
	}
	return { driver, calls, state, workers, timers, command, finishCreate }
}

test("termination waits for an in-flight create before confirming absence", async () => {
	const f = fixture()
	f.state.holdCreate = true
	const created = f.driver.createLease(reference)
	const rejected = assert.rejects(created, failure("lease_lost"))
	await tick()
	let stopped = false
	const stopping = f.driver.terminateLease(reference).then(() => {
		stopped = true
	})
	await tick()
	assert.equal(stopped, false)
	await assert.rejects(f.driver.createLease(other), failure("busy"))
	f.finishCreate()
	await rejected
	await stopping
	assert.equal(f.state.present, false)
	assert.equal(
		f.calls.some((args) => args[0] === "start"),
		false,
	)
	assert.equal(f.calls.at(-1)?.[0], "container")
})

test("an uncertain create cannot release a lease merely because the container is not yet visible", async () => {
	const f = fixture()
	f.state.holdCreate = true
	const created = f.driver.createLease(reference)
	const rejected = assert.rejects(created, failure("cleanup_failed"))
	await tick()
	const timer = f.timers.findLast(
		(value) => !value.canceled && value.milliseconds === 20_000,
	)
	assert.ok(timer)
	timer.callback()
	await rejected
	await assert.rejects(
		f.driver.terminateLease(reference),
		failure("cleanup_failed"),
	)
	await assert.rejects(f.driver.createLease(other), failure("busy"))
	f.finishCreate()
	await f.driver.terminateLease(reference)
	assert.equal(f.state.present, false)
})

test("a fresh controller preserves an uncertain creation recorded before a restart", async () => {
	const f = fixture()
	await assert.rejects(
		f.driver.terminateLease({ ...reference, creationUncertain: true }),
		failure("cleanup_failed"),
	)
	await assert.rejects(f.driver.createLease(other), failure("busy"))
	f.state.present = true
	await f.driver.terminateLease({ ...reference, creationUncertain: true })
	assert.equal(f.state.present, false)
	// The database may still hold the old flag until its next transaction commits.
	await f.driver.terminateLease({ ...reference, creationUncertain: true })
})

test("task image health is read only and fails closed without a Linux daemon", async () => {
	const f = fixture()
	await f.driver.health()
	assert.deepEqual(f.calls, [
		["info", "--format={{.OSType}}"],
		["image", "inspect", "--format={{.Id}}", basicComputeImage],
	])
	f.state.linux = false
	await assert.rejects(f.driver.health(), failure("unavailable"))
	f.state.daemon = false
	await assert.rejects(f.driver.health(), failure("unavailable"))
})

test("task creation pins isolation limits and never mounts host files or credentials", async () => {
	const f = fixture()
	const lease = await f.driver.createLease(reference)
	assert.equal(lease.idlePid, 7)
	const args = f.calls.find((call) => call[0] === "create")!
	for (const value of [
		"--read-only",
		"--user=65532:65532",
		"--cap-drop=ALL",
		"--security-opt=no-new-privileges=true",
		"--security-opt=apparmor=docker-default",
		"--network=none",
		"--cpus=0.5",
		"--memory=512m",
		"--memory-swap=512m",
		"--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=67108864,uid=65532,gid=65532,mode=0700",
		"--pids-limit=32",
		"--pull=never",
		"--restart=no",
		"--init",
		"--log-driver=none",
		basicComputeImage,
	])
		assert.ok(args.includes(value), value)
	assert.equal(args.filter((arg) => arg.startsWith("--tmpfs")).length, 2)
	assert.equal(
		args.some((arg) =>
			/--mount|--volume|--publish|docker\.sock|--env-file/.test(arg),
		),
		false,
	)
	assert.deepEqual(
		args.filter((arg) => arg.startsWith("--env=")),
		["--env=HOME=/workspace"],
	)
	await assert.rejects(f.driver.createLease(other), failure("busy"))
	await f.driver.terminateLease(lease)
	assert.equal(f.state.present, false)
	assert.equal(f.calls.at(-1)?.[0], "container")
})

test("internet workspaces mount only their own socket and remove it with the lease", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "kay-internet-"))
	const f = fixture({ directory, authorize: async () => {} })
	try {
		const lease = await f.driver.createLease(reference)
		const socket = path.join(directory, reference.leaseId + ".sock")
		await access(socket)
		const args = f.calls.find((call) => call[0] === "create")!
		assert.deepEqual(
			args.filter((arg) => arg.startsWith("--mount")),
			[
				`--mount=type=bind,source=${socket},target=/run/kay-internet.sock,readonly`,
			],
		)
		assert.ok(args.includes("--network=none"))
		assert.ok(
			!args.some(
				(arg) => arg.includes("control.sock") || arg.includes("docker.sock"),
			),
		)
		await f.driver.terminateLease(lease)
		await assert.rejects(access(socket))
	} finally {
		await f.driver.terminateLease(reference)
		await rm(directory, { recursive: true, force: true })
	}
})

test("binary file responses use the download limit instead of the command log limit", async () => {
	const f = fixture()
	const lease = await f.driver.createLease(reference)
	const content = Buffer.alloc(1024 * 1024, 71).toString("base64")
	f.state.fileValue = { path: "result.pptx", encoding: "base64", content }
	const result = await f.driver.files({
		lease,
		operationId: "download-result",
		operation: { _tag: "Read", path: "result.pptx", encoding: "base64" },
	})
	assert.deepEqual(result, f.state.fileValue)
	assert.equal(f.state.present, true)
	await f.driver.terminateLease(lease)
})

test("identity input cannot become Docker arguments and foreign containers cannot be removed", async () => {
	const f = fixture()
	await assert.rejects(
		f.driver.createLease({ ...reference, containerName: "--privileged" }),
		failure("invalid"),
	)
	assert.equal(f.calls.length, 0)
	f.state.present = true
	f.state.foreign = true
	await assert.rejects(
		f.driver.terminateLease(reference),
		failure("cleanup_failed"),
	)
	assert.equal(
		f.calls.some((call) => call[0] === "rm"),
		false,
	)
	await assert.rejects(f.driver.createLease(other), failure("busy"))
})

test("commands, environment, input and paths travel only as container worker JSON", async () => {
	const f = fixture()
	const lease = await f.driver.createLease(reference)
	const output: Array<string> = []
	const command = "echo $(touch /host-never); printf -- --privileged"
	const running = f.driver.start({
		lease,
		operationId: "operation-1",
		command,
		cwd: "/workspace/a b",
		env: { TEST: "secret-test-value" },
		onOutput: (value) => {
			output.push(value)
		},
	})
	running.input(Buffer.from("hello").toString("base64"))
	await tick()
	const child = f.command()
	assert.equal(child.requests[0]?.["command"], command)
	assert.deepEqual(child.requests[1], { type: "input", data: "aGVsbG8=" })
	for (const args of f.calls) {
		assert.equal(args.includes(command), false)
		assert.equal(args.includes("secret-test-value"), false)
		assert.equal(args.includes("/workspace/a b"), false)
	}
	child.event({
		event: "output",
		data: Buffer.from("works").toString("base64"),
	})
	child.event({ event: "exit", code: 0, signal: null })
	child.end()
	assert.deepEqual(await running.done, {
		exitCode: 0,
		signal: null,
		reason: "finished",
		outputBytes: 5,
	})
	assert.equal(Buffer.from(output.join(""), "base64").toString(), "works")
	assert.equal(f.state.present, true)
	assert.throws(
		() =>
			f.driver.start({
				lease,
				operationId: "operation-1",
				command,
				onOutput: () => {},
			}),
		failure("duplicate_operation"),
	)
	await f.driver.files({
		lease,
		operationId: "file-1",
		operation: {
			_tag: "Write",
			file: {
				path: "/workspace/user file",
				content: "--mount=/",
				encoding: "utf8",
			},
		},
	})
	assert.equal(
		f.calls.some(
			(args) =>
				args.includes("--mount=/") || args.includes("/workspace/user file"),
		),
		false,
	)
	await f.driver.terminateLease(lease)
})

test("output over 64 KiB discards the lease and cannot leak background processes", async () => {
	const f = fixture()
	const lease = await f.driver.createLease(reference)
	let bytes = 0
	const running = f.driver.start({
		lease,
		operationId: "output-limit",
		command: "flood",
		onOutput: (value) => {
			bytes += Buffer.from(value, "base64").length
		},
	})
	await tick()
	f.command().event({
		event: "output",
		data: Buffer.alloc(basicComputeLimits.outputBytes + 1, 65).toString(
			"base64",
		),
	})
	assert.equal((await running.done).reason, "output_limit")
	assert.equal(bytes, basicComputeLimits.outputBytes)
	assert.equal(f.state.present, false)
	assert.throws(
		() =>
			f.driver.start({
				lease,
				operationId: "stale",
				command: "never",
				onOutput: () => {},
			}),
		failure("lease_lost"),
	)
})

test("120 second watchdog and explicit close terminate the full lease", async () => {
	for (const stopped of [false, true]) {
		const f = fixture()
		const lease = await f.driver.createLease(reference)
		const running = f.driver.start({
			lease,
			operationId: "time-limit",
			command: "background work",
			onOutput: () => {},
		})
		await tick()
		if (stopped) await running.close()
		else {
			const timer = f.timers.findLast(
				(value) => !value.canceled && value.milliseconds === 120_000,
			)
			assert.ok(timer)
			timer.callback()
		}
		assert.equal(
			(await running.done).reason,
			stopped ? "stopped" : "time_limit",
		)
		assert.equal(f.state.present, false)
	}
})

test("failed process cleanup discards the lease; unconfirmed removal keeps other users blocked", async () => {
	const f = fixture()
	const lease = await f.driver.createLease(reference)
	const running = f.driver.start({
		lease,
		operationId: "cleanup-failure",
		command: "task",
		onOutput: () => {},
	})
	await tick()
	f.state.cleanupFails = true
	f.state.blockedRemoval = true
	f.command().event({ event: "exit", code: 0, signal: null })
	f.command().end()
	await assert.rejects(running.done, failure("cleanup_failed"))
	await assert.rejects(f.driver.createLease(other), failure("busy"))
	f.state.blockedRemoval = false
	await f.driver.terminateLease(lease)
	assert.equal(f.state.present, false)
})

test("file calls reject concurrent tasks and malformed worker replies discard the lease", async () => {
	const f = fixture()
	const lease = await f.driver.createLease(reference)
	const running = f.driver.start({
		lease,
		operationId: "command",
		command: "task",
		onOutput: () => {},
	})
	await assert.rejects(
		f.driver.files({
			lease,
			operationId: "file",
			operation: { _tag: "List", path: "/workspace" },
		}),
		failure("busy"),
	)
	await tick()
	f.command().event({ event: "exit", code: 0, signal: null })
	f.command().end()
	await running.done
	f.state.malformed = true
	await assert.rejects(
		f.driver.files({
			lease,
			operationId: "file",
			operation: { _tag: "List", path: "/workspace" },
		}),
		failure("lease_lost"),
	)
	assert.equal(f.state.present, false)
})

test("static container worker parses as JavaScript without executing it on the host", () => {
	const result = spawnSync(
		process.execPath,
		["--input-type=module", "--check"],
		{ input: basicComputeWorker, encoding: "utf8" },
	)
	assert.equal(result.status, 0, result.stderr)
})

/** Exercise the worker with fake filesystem/process adapters; never run user code here. */
const workerFixture = (request: unknown, fs: unknown) => {
	const lines = new EventEmitter()
	const events: Array<Record<string, unknown>> = []
	const killed: Array<number> = []
	const state = { processes: [1, 7, 99, 200] }
	let resolve: () => void
	const done = new Promise<void>((value) => {
		resolve = value
	})
	const fakeProcess = {
		pid: 99,
		stdin: { destroy() {} },
		stdout: {
			write(text: string, callback?: () => void) {
				events.push(JSON.parse(text) as Record<string, unknown>)
				callback?.()
			},
		},
		exit() {
			resolve()
		},
		kill(pid: number) {
			killed.push(pid)
			state.processes = state.processes.filter((value) => value !== pid)
		},
	}
	runInNewContext(basicComputeWorker.replace(/^import .*;$/gm, ""), {
		fs: typeof fs === "function" ? fs(state) : fs,
		path,
		constants,
		Buffer,
		process: fakeProcess,
		createInterface: () => Object.assign(lines, { close() {} }),
		spawn: () => {
			throw new Error("No host execution is allowed in worker tests.")
		},
		setTimeout: (callback: () => void) => {
			queueMicrotask(callback)
			return { unref() {} }
		},
	})
	lines.emit("line", JSON.stringify(request))
	return { done, events, killed }
}

test("file worker rejects escaped paths and symbolic links before opening a file", async () => {
	for (const target of [
		"/etc/passwd",
		"../../etc/passwd",
		"/workspace/link/file",
	]) {
		let opened = false
		const f = workerFixture(
			{
				mode: "file",
				operation: { _tag: "Read", path: target, encoding: "utf8" },
			},
			{
				lstat: async () => ({
					isSymbolicLink: () => true,
					isDirectory: () => false,
				}),
				open: async () => {
					opened = true
					throw new Error("Unexpected open")
				},
			},
		)
		await f.done
		assert.equal(f.events[0]?.["event"], "error")
		assert.equal(opened, false)
	}
})

test("file worker bounds reads and preserves its workspace root", async () => {
	let read = false
	let removed = false
	const fs = {
		lstat: async () => ({
			isSymbolicLink: () => false,
			isDirectory: () => false,
		}),
		open: async () => ({
			stat: async () => ({ isFile: () => true, size: 10 * 1024 * 1024 + 1 }),
			readFile: async () => {
				read = true
				return Buffer.alloc(0)
			},
			close: async () => {},
		}),
		rm: async () => {
			removed = true
		},
	}
	const f = workerFixture(
		{
			mode: "file",
			operation: { _tag: "Read", path: "/workspace/large", encoding: "utf8" },
		},
		fs,
	)
	await f.done
	assert.equal(read, false)
	assert.equal(f.events[0]?.["event"], "error")
	const root = workerFixture(
		{ mode: "file", operation: { _tag: "Remove", path: "/workspace" } },
		fs,
	)
	await root.done
	assert.equal(removed, false)
	assert.equal(root.events[0]?.["event"], "error")
})

test("file worker returns a binary presentation larger than command output", async () => {
	const content = Buffer.alloc(600 * 1024, 91)
	const f = workerFixture(
		{
			mode: "file",
			operation: {
				_tag: "Read",
				path: "/workspace/result.pptx",
				encoding: "base64",
			},
		},
		{
			lstat: async () => ({
				isSymbolicLink: () => false,
				isDirectory: () => false,
			}),
			open: async () => ({
				stat: async () => ({ isFile: () => true, size: content.length }),
				readFile: async () => content,
				close: async () => {},
			}),
		},
	)
	await f.done
	assert.equal(f.events[0]?.["event"], "result")
	assert.deepEqual(f.events[0]?.["value"], {
		path: "/workspace/result.pptx",
		encoding: "base64",
		content: content.toString("base64"),
	})
})

test("process cleanup keeps only init, the verified idle process and its own helper", async () => {
	const f = workerFixture(
		{ mode: "cleanup", idlePid: 7 },
		(state: { processes: Array<number> }) => ({
			readFile: async () => "/usr/bin/sleep\0infinity\0",
			readdir: async () => state.processes.map(String),
		}),
	)
	await f.done
	assert.deepEqual(f.killed, [200])
	assert.equal(f.events[0]?.["event"], "result")
	const bad = workerFixture(
		{ mode: "cleanup", idlePid: 7 },
		{
			readFile: async () => "/usr/bin/other\0",
		},
	)
	await bad.done
	assert.equal(bad.events[0]?.["event"], "error")
	assert.deepEqual(bad.killed, [])
})
