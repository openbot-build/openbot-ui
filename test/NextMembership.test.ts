import assert from "node:assert/strict"
import { test } from "node:test"
import { RequestFailed } from "@kaicom/kay-contracts/Client"
import {
	membershipRequestKey,
	membershipWriteRejected,
	readMembershipRequest,
	saveMembershipRequest,
} from "../src/next/features/MembershipState.ts"
import { routeSearch, searchFromView } from "../src/next/RouteSearch.ts"
import { initialView, reduceView } from "../src/next/Model.ts"
import {
	adminSections,
	adminDestination,
	personalSettingsDestination,
	personalSettingsRoute,
	personalSettingsSections,
} from "../src/next/features/SettingsData.ts"

const storage = () => {
	const values = new Map<string, string>()
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value)
		},
		removeItem: (key: string) => {
			values.delete(key)
		},
	}
}

test("membership recovery keeps only account-scoped receipt identity across navigation", () => {
	const saved = storage()
	const first = membershipRequestKey({
		userId: "account-a",
		organizationId: "organization",
		kind: "redeem",
	})
	const second = membershipRequestKey({
		userId: "account-b",
		organizationId: "organization",
		kind: "redeem",
	})
	const otherOrganization = membershipRequestKey({
		userId: "account-a",
		organizationId: "other",
		kind: "redeem",
	})
	const creation = membershipRequestKey({
		userId: "account-a",
		organizationId: "organization",
		kind: "create",
	})
	saveMembershipRequest({
		storage: saved,
		key: first,
		value: { kind: "redeem", requestId: "request-1" },
	})
	assert.deepEqual(readMembershipRequest({ storage: saved, key: first }), {
		kind: "redeem",
		requestId: "request-1",
	})
	assert.equal(readMembershipRequest({ storage: saved, key: second }), null)
	assert.equal(
		readMembershipRequest({ storage: saved, key: otherOrganization }),
		null,
	)
	assert.equal(readMembershipRequest({ storage: saved, key: creation }), null)
	assert.equal(
		saved.getItem(first),
		'{"kind":"redeem","requestId":"request-1"}',
	)
	saveMembershipRequest({ storage: saved, key: first, value: null })
	assert.equal(readMembershipRequest({ storage: saved, key: first }), null)
})

test("invalid saved requests cannot restore secret payloads or arbitrary command identities", () => {
	const saved = storage()
	for (const value of [
		"not json",
		"{}",
		'{"kind":"redeem","requestId":"https://example.com"}',
		'{"kind":"redeem","requestId":"request-1","code":"secret"}',
		'{"kind":"revoke","requestId":"request-1"}',
	]) {
		saved.setItem("key", value)
		assert.equal(readMembershipRequest({ storage: saved, key: "key" }), null)
	}
})

test("only definite membership refusals unlock a new write without receipt reconciliation", () => {
	for (const status of [400, 403, 404, 409, 422])
		assert.equal(
			membershipWriteRejected(
				new RequestFailed(status, {
					code: "invalid_input",
					message: "Rejected",
				}),
			),
			true,
		)
	for (const status of [0, 200, 408, 500, 503])
		assert.equal(
			membershipWriteRejected(
				new RequestFailed(status, {
					code: "outcome_unknown",
					message: "Unknown",
				}),
			),
			false,
		)
	assert.equal(
		membershipWriteRejected(
			new RequestFailed(503, { code: "unavailable", message: "Unavailable" }),
		),
		false,
	)
	assert.equal(membershipWriteRejected(new Error("Disconnected")), false)
})

test("Treasure stays personal while code management opens inside the administrator console", () => {
	assert.equal(
		adminSections.filter((section) => section === "memberships").length,
		1,
	)
	assert.equal(adminDestination("admin:memberships"), "memberships")
	assert.equal(adminDestination("membership"), undefined)
	for (const section of personalSettingsSections) {
		const id = personalSettingsRoute(section)
		const view = reduceView(initialView, {
			type: "navigate",
			destination: { kind: "feature", id, title: "Settings" },
		})
		assert.deepEqual(
			routeSearch({
				...searchFromView(view),
				code: "private-code",
				requestId: "private-request",
			}),
			{ feature: id },
		)
		assert.equal(personalSettingsDestination(id), section)
	}
	assert.deepEqual(
		routeSearch({ feature: "admin:memberships", code: "private-code" }),
		{ feature: "admin:memberships" },
	)
	assert.deepEqual(routeSearch({ feature: "admin:memberships:secrets" }), {})
	assert.deepEqual(routeSearch({ feature: "settings:unknown" }), {})
})

test("an undelivered creation preserves its original id, plan and duration for an explicit retry", () => {
	const saved = storage()
	const original = {
		kind: "create" as const,
		requestId: "creation-retry",
		planId: "flawless" as const,
		months: 3,
	}
	saveMembershipRequest({ storage: saved, key: "create", value: original })
	const restored = readMembershipRequest({ storage: saved, key: "create" })
	assert.deepEqual(restored, original)
	for (const months of [0, 13, 1.5]) {
		saved.setItem("create", JSON.stringify({ ...original, months }))
		assert.equal(readMembershipRequest({ storage: saved, key: "create" }), null)
	}
})
