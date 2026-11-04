import assert from "node:assert/strict"
import { test } from "node:test"
import { DevicesFailure, readDevices } from "../src/Devices.ts"
import type { NativeCall, NativeClient } from "@kaicom/kay-contracts/Native"

const computer = (id: string, overrides: Record<string, unknown> = {}) => ({
	id,
	name: id,
	version: 3,
	state: "offline",
	source: { _tag: "Connector" },
	owner: { _tag: "Member", userId: "member" },
	features: { pause: false, desktop: false, ports: false },
	lastActiveAt: null,
	...overrides,
})

test("device overview preserves reported states and whole-computer Kay access", async () => {
	const calls: NativeCall[] = []
	const records = [
		computer("laptop", {
			state: "running",
			features: { pause: false, desktop: true, ports: false },
			lastActiveAt: 100,
		}),
		computer("desktop"),
		computer("workspace", { state: "starting", executionId: "maintenance" }),
		computer("shared", {
			owner: { _tag: "Organization" },
			source: { _tag: "Provider", provider: "provider", template: null },
			state: "paused",
			features: { pause: true, desktop: false, ports: true },
		}),
	]
	const client: NativeClient = {
		request: async (call) => {
			calls.push(call)
			return Response.json(calls.length === 1 ? records : [records[0]])
		},
	}
	const overview = await readDevices({
		userId: "member",
		client,
		defaultBotId: "kay",
		isManaged: async (id) => id === "workspace",
		observedAt: 200,
	})
	assert.equal(overview.observedAt, 200)
	assert.deepEqual(calls, [
		{ operation: "feature", id: "computers.listComputers", payload: {} },
		{
			operation: "feature",
			id: "computers.listComputers",
			payload: { query: { bot: "kay" } },
		},
	])
	assert.deepEqual(
		overview.groups[0]?.devices.map((device) => ({
			id: device.id,
			state: device.state,
			access: device.kayAccess,
			management: device.management,
		})),
		[
			{
				id: "laptop",
				state: "running",
				access: "granted",
				management: "personal",
			},
			{
				id: "desktop",
				state: "offline",
				access: "not_granted",
				management: "personal",
			},
			{
				id: "workspace",
				state: "starting",
				access: "not_granted",
				management: "managed",
			},
			{
				id: "shared",
				state: "paused",
				access: "not_granted",
				management: "shared",
			},
		],
	)
	assert.deepEqual(overview.groups[0]?.devices[0]?.capabilities, {
		commands: true,
		files: true,
		desktop: true,
		pause: false,
		ports: false,
	})
	assert.equal(overview.groups[0]?.devices[2]?.executionId, "maintenance")
	assert.equal(overview.groups[0]?.devices[3]?.source, "provider")
	assert.deepEqual(overview.groups.slice(1), [
		{
			category: "phone",
			connection: {
				status: "unavailable",
				reason: "mobile_connector_unavailable",
				action: null,
			},
			devices: [],
		},
		{
			category: "smart",
			connection: {
				status: "unavailable",
				reason: "smart_device_adapter_unavailable",
				action: null,
			},
			devices: [],
		},
	])
})

test("an unconfigured Kay does not create a Bot or pretend that it has device access", async () => {
	const calls: NativeCall[] = []
	const overview = await readDevices({
		userId: "member",
		client: {
			request: async (call) => {
				calls.push(call)
				return Response.json([computer("saved", { state: "failed" })])
			},
		},
		defaultBotId: null,
		isManaged: async () => false,
	})
	assert.equal(calls.length, 1)
	assert.equal(overview.defaultBotId, null)
	assert.equal(overview.groups[0]?.devices[0]?.kayAccess, "unconfigured")
	assert.equal(overview.groups[0]?.devices[0]?.state, "failed")
})

test("an administrator's personal shelf excludes other members' private computers", async () => {
	const overview = await readDevices({
		userId: "member",
		client: {
			request: async () =>
				Response.json([
					computer("mine"),
					computer("another-member", {
						owner: { _tag: "Member", userId: "other" },
					}),
					computer("organization", { owner: { _tag: "Organization" } }),
				]),
		},
		defaultBotId: null,
		isManaged: async () => false,
	})
	assert.deepEqual(
		overview.groups[0]?.devices.map((device) => device.id),
		["mine", "organization"],
	)
})

test("a denied core read is not reported as an empty device list", async () => {
	for (const status of [401, 403, 503])
		await assert.rejects(
			readDevices({
				userId: "member",
				client: { request: async () => new Response(null, { status }) },
				defaultBotId: "kay",
				isManaged: async () => false,
			}),
			(error: unknown) =>
				error instanceof DevicesFailure && error.status === status,
		)
})

test("a failed access read cannot turn a device grant into a denied permission", async () => {
	let calls = 0
	await assert.rejects(
		readDevices({
			userId: "member",
			client: {
				request: async () =>
					++calls === 1
						? Response.json([computer("laptop")])
						: new Response(null, { status: 403 }),
			},
			defaultBotId: "kay",
			isManaged: async () => false,
		}),
		(error: unknown) => error instanceof DevicesFailure && error.status === 403,
	)
})

test("unknown native device state is rejected instead of shown as online", async () => {
	await assert.rejects(
		readDevices({
			userId: "member",
			client: {
				request: async () =>
					Response.json([computer("device", { state: "available" })]),
			},
			defaultBotId: null,
			isManaged: async () => false,
		}),
	)
})
