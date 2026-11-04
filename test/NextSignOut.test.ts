import assert from "node:assert/strict"
import test from "node:test"
import {
	clearPrivateViewStorage,
	requestSignOut,
	signOutWorkspace,
} from "../src/next/SignOut.ts"

test("confirmed logout clears private state before returning to the entry page", async () => {
	const steps: string[] = []
	await signOutWorkspace({
		request: async () => {
			steps.push("revoke")
		},
		clear: () => {
			steps.push("clear")
		},
		navigate: () => {
			steps.push("navigate")
		},
	})
	assert.deepEqual(steps, ["revoke", "clear", "navigate"])
})

test("failed or uncertain logout preserves the current workspace without retrying", async () => {
	const steps: string[] = []
	await assert.rejects(
		signOutWorkspace({
			request: async () => {
				steps.push("revoke")
				throw new Error("Connection lost")
			},
			clear: () => {
				steps.push("clear")
			},
			navigate: () => {
				steps.push("navigate")
			},
		}),
	)
	assert.deepEqual(steps, ["revoke"])
})

test("logout clears private view caches while retaining account-scoped operation recovery", () => {
	const state = new Map([
		["kay:drafts:v1", "private draft"],
		["kay:surface:v1", "private location"],
		["kay:reading-position:v1", "private message"],
		["kay:conversation-operation:owner", "pending operation"],
		["kay:unconfirmed-change:user:org", "pending operation"],
		["e-theme", "dark"],
	])
	clearPrivateViewStorage({
		removeItem: (key) => {
			state.delete(key)
		},
	})
	assert.deepEqual(
		[...state.keys()],
		[
			"kay:conversation-operation:owner",
			"kay:unconfirmed-change:user:org",
			"e-theme",
		],
	)
	assert.doesNotThrow(() =>
		clearPrivateViewStorage({
			removeItem: () => {
				throw new Error("Storage denied")
			},
		}),
	)
})

test("logout reuses the authenticated client endpoint and same-origin cookies", async (context) => {
	const requests: {
		url: string
		method: string
		credentials: RequestCredentials | undefined
	}[] = []
	context.mock.method(
		globalThis,
		"fetch",
		async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push({
				url: String(input),
				method: init?.method ?? "GET",
				credentials: init?.credentials,
			})
			return new Response(null, { status: 204 })
		},
	)
	await requestSignOut("http://localhost")
	assert.deepEqual(requests, [
		{
			url: "http://localhost/auth/sign-out",
			method: "POST",
			credentials: "same-origin",
		},
	])
})
