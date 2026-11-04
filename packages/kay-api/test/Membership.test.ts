import assert from "node:assert/strict"
import { once } from "node:events"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { test } from "node:test"
import { Pool } from "pg"
import {
	makeMembership,
	MembershipFailure,
	addMembershipMonths,
} from "../src/Membership.ts"
import { runtime } from "../src/Database.ts"
import { handleProductRequest } from "../src/ProductGateway.ts"
import type { Configuration } from "../src/Configuration.ts"
import { start } from "./PostgresTest.ts"

const failure = (code: string) => (error: unknown) =>
	error instanceof MembershipFailure && error.code === code

test("membership terms use UTC natural months at month end and leap years", () => {
	for (const [date, months, expected] of [
		["2027-01-31T12:34:56.789Z", 1, "2027-02-28T12:34:56.789Z"],
		["2028-01-31T12:34:56.789Z", 1, "2028-02-29T12:34:56.789Z"],
		["2028-02-29T01:00:00.000Z", 12, "2029-02-28T01:00:00.000Z"],
		["2026-12-31T23:59:59.000Z", 2, "2027-02-28T23:59:59.000Z"],
	] as const)
		assert.equal(
			new Date(
				addMembershipMonths({ timestamp: Date.parse(date), months }),
			).toISOString(),
			expected,
		)
})

test(
	"membership codes consume atomically and preserve account rights in real PostgreSQL",
	{ timeout: 60000 },
	async (t) => {
		const postgres = await start()
		const pool = new Pool({ connectionString: postgres.url })
		const config: Configuration = {
			databaseUrl: postgres.url,
			port: 3100,
			internalPort: 3101,
			internalToken: "fixture-internal-token-at-least-32-characters",
			publicOrigin: "https://kay.example",
			eOrigin: "http://127.0.0.1:1",
			openbotOrigin: "http://127.0.0.1:1",
			authBackend: "openbot",
			backendRouting: "ledger",
		}
		const db = runtime(config)
		t.after(async () => {
			await db.dispose()
			await pool.end()
			await postgres.close()
		})
		const migration = await readFile(
			new URL("../migrations/003_membership.sql", import.meta.url),
			"utf8",
		)
		await pool.query(migration)
		await pool.query(migration)
		const manager = makeMembership({ db, canManageCodes: true })
		const member = makeMembership({ db })
		const create = async (
			requestId: string,
			planId: "precious" | "flawless" = "precious",
			months = 1,
		) => {
			const result = await manager.createCode({
				actorId: "manager",
				command: { requestId, planId, months },
			})
			assert.ok(result.code)
			return { code: result.code, record: result.record }
		}
		await t.test(
			"prices are public within the authenticated account and buying stays closed",
			async () => {
				const state = await member.get("any-member")
				assert.equal(state.canManageCodes, false)
				assert.equal(state.purchaseAvailable, false)
				assert.deepEqual(
					state.plans.map((plan) => [
						plan.id,
						plan.monthlyPriceCents,
						plan.currency,
						plan.purchasable,
					]),
					[
						["precious", 20000, "USD", false],
						["flawless", 200000, "USD", false],
					],
				)
				assert.equal(state.subscription, null)
				assert.equal(state.container.allowed, false)
				await assert.rejects(
					member.requireContainerEntitlement("any-member"),
					failure("membership_required"),
				)
				await assert.rejects(
					member.createCode({
						actorId: "any-member",
						command: { requestId: "blocked", planId: "precious" },
					}),
					failure("forbidden"),
				)
				await assert.rejects(member.listCodes(), failure("forbidden"))
			},
		)
		await t.test(
			"creation is idempotent, only its first response exposes the code, and storage contains only its digest",
			async () => {
				const command = {
					requestId: "create-once",
					planId: "precious" as const,
				}
				const results = await Promise.all([
					manager.createCode({ actorId: "manager", command }),
					manager.createCode({ actorId: "manager", command }),
				])
				assert.equal(results.filter((item) => item.code !== null).length, 1)
				assert.equal(results[0]!.record.id, results[1]!.record.id)
				const code = results.find((item) => item.code !== null)!.code!
				assert.match(code, /^KAY-[A-Za-z0-9_-]{43}$/)
				const stored = await pool.query(
					"SELECT * FROM kay_membership_codes WHERE request_id='create-once'",
				)
				assert.equal(stored.rowCount, 1)
				assert.equal(
					stored.rows[0].code_hash,
					createHash("sha256").update(code).digest("hex"),
				)
				assert.equal(stored.rows[0].account_id, null)
				assert.ok(!JSON.stringify(stored.rows).includes(code))
				assert.ok(!JSON.stringify(await manager.listCodes()).includes(code))
				assert.deepEqual(
					await manager.codeRequest({
						actorId: "manager",
						requestId: command.requestId,
					}),
					results[0]!.record,
				)
				assert.equal(
					await manager.codeRequest({
						actorId: "other",
						requestId: command.requestId,
					}),
					null,
				)
				await assert.rejects(
					manager.createCode({
						actorId: "manager",
						command: { ...command, months: 2 },
					}),
					failure("conflict"),
				)
			},
		)
		await t.test(
			"two accounts cannot consume one code, and the successful owner may recover without adding time",
			async () => {
				const code = await create("account-race")
				const contenders = ["member-a", "member-b"]
				const results = await Promise.allSettled(
					contenders.map((accountId) =>
						member.redeem({
							accountId,
							displayName: accountId,
							command: { requestId: "shared-request", code: code.code },
						}),
					),
				)
				assert.equal(
					results.filter((result) => result.status === "fulfilled").length,
					1,
				)
				const winnerIndex = results.findIndex(
					(result) => result.status === "fulfilled",
				)
				const accountId = contenders[winnerIndex]!
				const rejected = results.find((result) => result.status === "rejected")
				assert.ok(
					rejected?.status === "rejected" &&
						failure("membership_code_used")(rejected.reason),
				)
				const first = await member.redemption({
					accountId,
					requestId: "shared-request",
				})
				assert.ok(first)
				const repeated = await member.redeem({
					accountId,
					displayName: accountId,
					command: { requestId: "shared-request", code: code.code },
				})
				assert.deepEqual(repeated, first)
				const secondRequest = await member.redeem({
					accountId,
					displayName: accountId,
					command: { requestId: "new-request-same-code", code: code.code },
				})
				assert.equal(secondRequest.expiresAt, first.expiresAt)
				assert.equal(secondRequest.membership.subscription?.revision, 1)
				assert.equal(
					(await member.requireContainerEntitlement(accountId)).revision,
					1,
				)
				assert.equal(
					await member.redemption({
						accountId: "unrelated",
						requestId: "shared-request",
					}),
					null,
				)
				const record = (await manager.listCodes()).items.find(
					(row) => row.id === code.record.id,
				)
				assert.equal(record?.accountId, accountId)
				assert.deepEqual(record?.redeemedBy, { displayName: accountId })
			},
		)
		await t.test(
			"concurrent renewals preserve both terms and an active plan cannot be silently replaced",
			async () => {
				const first = await create("renew-first")
				const second = await create("renew-second")
				const results = await Promise.all(
					[first, second].map((code, i) =>
						member.redeem({
							accountId: "renewing",
							displayName: "Renewing member",
							command: { requestId: `renew-${i}`, code: code.code },
						}),
					),
				)
				const ordered = [...results].sort((a, b) => a.expiresAt - b.expiresAt)
				assert.equal(ordered[1]!.startsAt, ordered[0]!.expiresAt)
				assert.equal(
					ordered[1]!.expiresAt,
					addMembershipMonths({ timestamp: ordered[0]!.expiresAt, months: 1 }),
				)
				assert.equal((await member.get("renewing")).subscription?.revision, 2)
				await assert.rejects(
					member.redeem({
						accountId: "renewing",
						displayName: "Member",
						command: { requestId: "renew-0", code: second.code },
					}),
					failure("conflict"),
				)
				const different = await create("different-plan", "flawless")
				await assert.rejects(
					member.redeem({
						accountId: "renewing",
						displayName: "Member",
						command: { requestId: "switch", code: different.code },
					}),
					failure("membership_plan_conflict"),
				)
				assert.equal(
					(
						await manager.codeRequest({
							actorId: "manager",
							requestId: "different-plan",
						})
					)?.status,
					"available",
				)
				await pool.query(
					"UPDATE kay_subscriptions SET starts_at=1,expires_at=2 WHERE account_id='renewing'",
				)
				assert.equal(
					(await member.get("renewing")).container.reason,
					"subscription_expired",
				)
				await assert.rejects(
					member.requireContainerEntitlement("renewing"),
					failure("membership_expired"),
				)
				const switched = await member.redeem({
					accountId: "renewing",
					displayName: "Member",
					command: { requestId: "switch", code: different.code },
				})
				assert.equal(switched.membership.subscription?.planId, "flawless")
				assert.equal(switched.membership.container.allowed, true)
			},
		)
		await t.test(
			"revocation races atomically with redemption and invalid codes grant nothing",
			async () => {
				const code = await create("revoke-race")
				const results = await Promise.allSettled([
					manager.revokeCode({ actorId: "manager", codeId: code.record.id }),
					member.redeem({
						accountId: "revocation-racer",
						displayName: "Member",
						command: { requestId: "revocation-racer", code: code.code },
					}),
				])
				assert.equal(
					results.filter((result) => result.status === "fulfilled").length,
					1,
				)
				const revoked = await create("revoked")
				const record = await manager.revokeCode({
					actorId: "manager",
					codeId: revoked.record.id,
				})
				assert.deepEqual(
					await manager.revokeCode({
						actorId: "manager",
						codeId: revoked.record.id,
					}),
					record,
				)
				await assert.rejects(
					member.redeem({
						accountId: "member-x",
						displayName: "Member",
						command: { requestId: "revoked", code: revoked.code },
					}),
					failure("membership_code_revoked"),
				)
				await assert.rejects(
					member.redeem({
						accountId: "member-x",
						displayName: "Member",
						command: { requestId: "invalid", code: "not-a-real-code" },
					}),
					failure("membership_invalid_code"),
				)
				assert.equal((await member.get("member-x")).subscription, null)
			},
		)
		await t.test(
			"HTTP code administration requires both the designated account and current native administrator permission",
			async () => {
				let actor = "manager"
				let platformAdmin = false
				let configuredManager: string | undefined = "manager"
				const server = createServer((req, res) => {
					void (async () => {
						const chunks: Buffer[] = []
						for await (const chunk of req) chunks.push(Buffer.from(chunk))
						const raw = Buffer.concat(chunks).toString()
						await handleProductRequest({
							req,
							res,
							url: new URL(req.url ?? "/", "http://fixture"),
							payload: raw === "" ? undefined : JSON.parse(raw),
							identity: {
								userId: actor,
								organizationId: "org",
								displayName: "Fixture member",
							},
							requestId: "http-fixture",
							db,
							...(configuredManager === undefined
								? {}
								: { membershipCodeManagerAccountId: configuredManager }),
							client: {
								request: async () =>
									Response.json({ adminConsole: platformAdmin }),
							},
						})
					})().catch(() => {
						res.writeHead(500)
						res.end()
					})
				})
				server.listen(0, "127.0.0.1")
				await once(server, "listening")
				const address = server.address()
				assert.ok(address !== null && typeof address !== "string")
				const origin = `http://127.0.0.1:${address.port}/api/kay/v1`
				const post = (path: string, body: unknown) =>
					fetch(origin + path, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					})
				try {
					assert.equal(
						(await fetch(origin + "/admin/membership/codes")).status,
						403,
					)
					platformAdmin = true
					actor = "another-admin"
					assert.equal(
						(await fetch(origin + "/admin/membership/codes")).status,
						403,
					)
					actor = "manager"
					configuredManager = undefined
					assert.equal(
						(await fetch(origin + "/admin/membership/codes")).status,
						403,
					)
					configuredManager = "manager"
					assert.equal(
						(await (await fetch(origin + "/membership")).json()).canManageCodes,
						true,
					)
					const created = await post("/admin/membership/codes", {
						requestId: "http-create",
						planId: "precious",
					})
					assert.equal(created.status, 200)
					const result = await created.json()
					assert.ok(result.code)
					assert.equal(
						(
							await (
								await fetch(
									origin + "/admin/membership/code-requests/http-create",
								)
							).json()
						).id,
						result.record.id,
					)
					assert.equal(
						(
							await post("/admin/membership/codes", {
								requestId: "http-create-invalid",
								planId: "precious",
								accountId: "forged",
							})
						).status,
						400,
					)
					actor = "ordinary-member"
					platformAdmin = false
					assert.equal(
						(await (await fetch(origin + "/membership")).json()).canManageCodes,
						false,
					)
					const redeemed = await post("/membership/redeem", {
						requestId: "http-redeem",
						code: result.code,
					})
					assert.equal(redeemed.status, 200)
					assert.equal(
						(await redeemed.json()).membership.container.allowed,
						true,
					)
					assert.equal(
						(
							await (
								await fetch(origin + "/membership/redemptions/http-redeem")
							).json()
						).codeId,
						result.record.id,
					)
					actor = "other-member"
					assert.equal(
						await (
							await fetch(origin + "/membership/redemptions/http-redeem")
						).json(),
						null,
					)
					const rejected = await post("/membership/redeem", {
						requestId: "steal",
						code: result.code,
					})
					assert.equal(rejected.status, 409)
					assert.equal((await rejected.json()).code, "membership_code_used")
					assert.equal(
						(
							await post(
								`/admin/membership/codes/${result.record.id}/revoke`,
								{},
							)
						).status,
						403,
					)
				} finally {
					server.closeAllConnections()
					await new Promise<void>((resolve, reject) =>
						server.close((error) =>
							error === undefined ? resolve() : reject(error),
						),
					)
				}
			},
		)
	},
)
