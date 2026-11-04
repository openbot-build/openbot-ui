import { createHash, randomBytes, randomUUID } from "node:crypto"
import { PgClient } from "@effect/sql-pg"
import { Effect, Schema, SchemaGetter } from "effect"
import * as Product from "@kaicom/kay-contracts"
import type { DatabaseRuntime } from "./Database.ts"

export class MembershipFailure extends Schema.TaggedError<MembershipFailure>()(
	"MembershipFailure",
	{ status: Schema.Natural, code: Product.ErrorCode, message: Schema.String },
) {}

export interface MembershipService {
	readonly get: (accountId: string) => Promise<Product.Membership>
	readonly requireContainerEntitlement: (accountId: string) => Promise<{
		readonly accountId: string
		readonly planId: Product.MembershipPlanId
		readonly expiresAt: number
		readonly revision: number
	}>
	readonly createCode: (input: {
		readonly actorId: string
		readonly command: Product.CreateMembershipCode
	}) => Promise<Product.CreatedMembershipCode>
	readonly listCodes: (before?: string) => Promise<Product.MembershipCodePage>
	readonly codeRequest: (input: {
		readonly actorId: string
		readonly requestId: string
	}) => Promise<Product.MembershipCode | null>
	readonly revokeCode: (input: {
		readonly actorId: string
		readonly codeId: string
	}) => Promise<Product.MembershipCode>
	readonly redeem: (input: {
		readonly accountId: string
		readonly displayName: string
		readonly command: Product.RedeemMembership
	}) => Promise<Product.MembershipRedemption>
	readonly redemption: (input: {
		readonly accountId: string
		readonly requestId: string
	}) => Promise<Product.MembershipRedemption | null>
}

const plans: ReadonlyArray<Product.MembershipPlan> = [
	{
		id: "precious",
		name: "Kay Precious",
		monthlyPriceCents: 20_000,
		currency: "USD",
		purchasable: false,
	},
	{
		id: "flawless",
		name: "Kay Flawless",
		monthlyPriceCents: 200_000,
		currency: "USD",
		purchasable: false,
	},
]
const storedNumber = Schema.Union([
	Schema.String,
	Schema.Finite,
	Schema.BigInt,
]).pipe(
	Schema.decodeTo(Schema.Int, {
		decode: SchemaGetter.transform((value) => Number(value)),
		encode: SchemaGetter.transform((value) => String(value)),
	}),
)
const subscriptionRow = Schema.Struct({
	account_id: Product.Id,
	plan_id: Product.MembershipPlanId,
	starts_at: storedNumber,
	expires_at: storedNumber,
	revision: storedNumber,
})
const codeRow = Schema.Struct({
	sequence: storedNumber,
	id: Product.Id,
	code_hash: Schema.String,
	account_id: Schema.NullOr(Product.Id),
	redeemed_name: Schema.NullOr(Schema.String),
	plan_id: Product.MembershipPlanId,
	months: Product.MembershipMonths,
	created_by: Product.Id,
	request_id: Product.RequestId,
	created_at: storedNumber,
	redeemed_at: Schema.NullOr(storedNumber),
	revoked_at: Schema.NullOr(storedNumber),
})
const redemptionRow = Schema.Struct({
	request_id: Product.RequestId,
	code_id: Product.Id,
	plan_id: Product.MembershipPlanId,
	starts_at: storedNumber,
	expires_at: storedNumber,
	redeemed_at: storedNumber,
})
const codeView = (value: unknown): Product.MembershipCode => {
	const row = Schema.decodeUnknownSync(codeRow)(value)
	return {
		id: row.id,
		requestId: row.request_id,
		planId: row.plan_id,
		months: row.months,
		accountId: row.account_id,
		redeemedBy:
			row.redeemed_name === null ? null : { displayName: row.redeemed_name },
		createdAt: row.created_at,
		createdBy: row.created_by,
		status:
			row.redeemed_at !== null
				? "redeemed"
				: row.revoked_at !== null
					? "revoked"
					: "available",
		redeemedAt: row.redeemed_at,
		revokedAt: row.revoked_at,
	}
}
/** UTC calendar months clamp the day at month end without changing the time of day. */
export const addMembershipMonths = ({
	timestamp,
	months,
}: {
	readonly timestamp: number
	readonly months: number
}): number => {
	const date = new Date(timestamp)
	const day = date.getUTCDate()
	date.setUTCDate(1)
	date.setUTCMonth(date.getUTCMonth() + months)
	const lastDay = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
	).getUTCDate()
	date.setUTCDate(Math.min(day, lastDay))
	return date.getTime()
}
const digest = (code: string): string =>
	createHash("sha256").update(code.trim()).digest("hex")
const denied = () =>
	MembershipFailure.make({
		status: 403,
		code: "forbidden",
		message: "Only the designated code manager can manage membership codes.",
	})
const now = Effect.gen(function* () {
	const sql = yield* PgClient.PgClient
	const rows =
		yield* sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS time`
	return (yield* Schema.decodeUnknownEffect(
		Schema.Struct({ time: storedNumber }),
	)(rows[0])).time
})

/** Only server-verified management permission may be supplied by the HTTP boundary. */
export const makeMembership = ({
	db,
	canManageCodes = false,
}: {
	readonly db: DatabaseRuntime
	readonly canManageCodes?: boolean
}): MembershipService => {
	const state = (accountId: string) =>
		Effect.gen(function* () {
			const sql = yield* PgClient.PgClient
			const rows =
				yield* sql`SELECT * FROM kay_subscriptions WHERE account_id=${accountId}`
			const at = yield* now
			const stored =
				rows[0] === undefined
					? null
					: yield* Schema.decodeUnknownEffect(subscriptionRow)(rows[0])
			const subscription: Product.Subscription | null =
				stored === null
					? null
					: {
							planId: stored.plan_id,
							status: stored.expires_at > at ? "active" : "expired",
							startsAt: stored.starts_at,
							expiresAt: stored.expires_at,
							revision: stored.revision,
						}
			return {
				plans,
				canManageCodes,
				purchaseAvailable: false,
				subscription,
				container: {
					allowed: subscription !== null && subscription.status === "active",
					reason:
						subscription === null
							? "subscription_required"
							: subscription.status === "expired"
								? "subscription_expired"
								: null,
				},
			} satisfies Product.Membership
		})
	const receipt = (input: {
		readonly row: unknown
		readonly accountId: string
	}) =>
		Effect.gen(function* () {
			const row = yield* Schema.decodeUnknownEffect(redemptionRow)(input.row)
			return {
				requestId: row.request_id,
				codeId: row.code_id,
				planId: row.plan_id,
				startsAt: row.starts_at,
				expiresAt: row.expires_at,
				redeemedAt: row.redeemed_at,
				membership: yield* state(input.accountId),
			} satisfies Product.MembershipRedemption
		})
	return {
		get: (accountId) => db.runPromise(state(accountId)),
		requireContainerEntitlement: async (accountId) => {
			const current = await db.runPromise(state(accountId))
			if (current.subscription === null)
				throw MembershipFailure.make({
					status: 403,
					code: "membership_required",
					message: "An active Kay membership is required to use containers.",
				})
			if (current.subscription.status !== "active")
				throw MembershipFailure.make({
					status: 403,
					code: "membership_expired",
					message:
						"Your Kay membership has expired. Redeem a code to use containers again.",
				})
			return {
				accountId,
				planId: current.subscription.planId,
				expiresAt: current.subscription.expiresAt,
				revision: current.subscription.revision,
			}
		},
		createCode: async ({ actorId, command }) => {
			if (!canManageCodes) throw denied()
			const decoded = Schema.decodeSync(Product.CreateMembershipCode)(command, {
				onExcessProperty: "error",
			})
			const months = decoded.months ?? 1
			return db.runPromise(
				Effect.gen(function* () {
					const sql = yield* PgClient.PgClient
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["kay-membership-code", actorId, decoded.requestId])},0))`
							const existing =
								yield* sql`SELECT * FROM kay_membership_codes WHERE created_by=${actorId} AND request_id=${decoded.requestId}`
							if (existing[0] !== undefined) {
								const record = codeView(existing[0])
								if (
									record.planId !== decoded.planId ||
									record.months !== months
								)
									return yield* MembershipFailure.make({
										status: 409,
										code: "conflict",
										message:
											"This request already created a different membership code.",
									})
								return { code: null, record }
							}
							const code = `KAY-${randomBytes(32).toString("base64url")}`
							const at = yield* now
							const rows =
								yield* sql`INSERT INTO kay_membership_codes(id,code_hash,plan_id,months,created_by,request_id,created_at) VALUES (${`mcode_${randomUUID()}`},${digest(code)},${decoded.planId},${months},${actorId},${decoded.requestId},${at}) RETURNING *`
							return { code, record: codeView(rows[0]) }
						}),
					)
				}),
			)
		},
		listCodes: async (before) => {
			if (!canManageCodes) throw denied()
			if (
				before !== undefined &&
				(!/^[1-9][0-9]{0,18}$/.test(before) ||
					BigInt(before) > 9223372036854775807n)
			)
				throw MembershipFailure.make({
					status: 400,
					code: "invalid_input",
					message: "This page cursor is not valid.",
				})
			return db.runPromise(
				Effect.gen(function* () {
					const sql = yield* PgClient.PgClient
					const rows =
						before === undefined
							? yield* sql`SELECT * FROM kay_membership_codes ORDER BY sequence DESC LIMIT 101`
							: yield* sql`SELECT * FROM kay_membership_codes WHERE sequence < ${before}::bigint ORDER BY sequence DESC LIMIT 101`
					const page = rows.slice(0, 100)
					const last =
						rows.length > 100
							? yield* Schema.decodeUnknownEffect(codeRow)(page[99])
							: null
					return {
						items: page.map(codeView),
						next: last === null ? null : String(last.sequence),
					}
				}),
			)
		},
		codeRequest: async ({ actorId, requestId }) => {
			if (!canManageCodes) throw denied()
			return db.runPromise(
				Effect.gen(function* () {
					const sql = yield* PgClient.PgClient
					const rows =
						yield* sql`SELECT * FROM kay_membership_codes WHERE created_by=${actorId} AND request_id=${requestId}`
					return rows[0] === undefined ? null : codeView(rows[0])
				}),
			)
		},
		revokeCode: async ({ actorId, codeId }) => {
			if (!canManageCodes) throw denied()
			return db.runPromise(
				Effect.gen(function* () {
					const sql = yield* PgClient.PgClient
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							const rows =
								yield* sql`SELECT * FROM kay_membership_codes WHERE id=${codeId} FOR UPDATE`
							if (rows[0] === undefined)
								return yield* MembershipFailure.make({
									status: 404,
									code: "not_found",
									message: "This membership code was not found.",
								})
							const record = codeView(rows[0])
							if (record.status === "redeemed")
								return yield* MembershipFailure.make({
									status: 409,
									code: "membership_code_used",
									message:
										"This code has already been redeemed. Revoking a code cannot remove an existing subscription.",
								})
							if (record.status === "revoked") return record
							const at = yield* now
							const changed =
								yield* sql`UPDATE kay_membership_codes SET revoked_at=${at},revoked_by=${actorId} WHERE id=${codeId} RETURNING *`
							return codeView(changed[0])
						}),
					)
				}),
			)
		},
		redeem: ({ accountId, displayName, command }) => {
			const decoded = Schema.decodeSync(Product.RedeemMembership)(command, {
				onExcessProperty: "error",
			})
			const hash = digest(decoded.code)
			return db.runPromise(
				Effect.gen(function* () {
					const sql = yield* PgClient.PgClient
					return yield* sql.withTransaction(
						Effect.gen(function* () {
							// One account lock prevents concurrent codes from losing subscription time.
							yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["kay-membership", accountId])},0))`
							const previous =
								yield* sql`SELECT r.*, c.code_hash FROM kay_membership_redemptions r JOIN kay_membership_codes c ON c.id=r.code_id WHERE r.account_id=${accountId} AND r.request_id=${decoded.requestId}`
							if (previous[0] !== undefined) {
								if (previous[0]["code_hash"] !== hash)
									return yield* MembershipFailure.make({
										status: 409,
										code: "conflict",
										message:
											"This redemption request already belongs to a different code.",
									})
								return yield* receipt({ row: previous[0], accountId })
							}
							const rows =
								yield* sql`SELECT * FROM kay_membership_codes WHERE code_hash=${hash} FOR UPDATE`
							if (rows[0] === undefined)
								return yield* MembershipFailure.make({
									status: 400,
									code: "membership_invalid_code",
									message: "This membership code is not valid.",
								})
							const code = yield* Schema.decodeUnknownEffect(codeRow)(rows[0])
							if (code.revoked_at !== null)
								return yield* MembershipFailure.make({
									status: 409,
									code: "membership_code_revoked",
									message: "This membership code has been revoked.",
								})
							if (code.redeemed_at !== null) {
								if (code.account_id !== accountId)
									return yield* MembershipFailure.make({
										status: 409,
										code: "membership_code_used",
										message: "This membership code has already been redeemed.",
									})
								const saved =
									yield* sql`INSERT INTO kay_membership_redemptions(account_id,request_id,code_id,plan_id,starts_at,expires_at,redeemed_at) SELECT account_id,${decoded.requestId},code_id,plan_id,starts_at,expires_at,redeemed_at FROM kay_membership_redemptions WHERE account_id=${accountId} AND code_id=${code.id} ORDER BY redeemed_at LIMIT 1 RETURNING *`
								if (saved[0] === undefined)
									return yield* MembershipFailure.make({
										status: 503,
										code: "unavailable",
										message:
											"The saved redemption needs to be checked before continuing.",
									})
								return yield* receipt({ row: saved[0], accountId })
							}
							const at = yield* now
							const subscriptions =
								yield* sql`SELECT * FROM kay_subscriptions WHERE account_id=${accountId} FOR UPDATE`
							const old =
								subscriptions[0] === undefined
									? null
									: yield* Schema.decodeUnknownEffect(subscriptionRow)(
											subscriptions[0],
										)
							const active = old !== null && old.expires_at > at
							if (active && old.plan_id !== code.plan_id)
								return yield* MembershipFailure.make({
									status: 409,
									code: "membership_plan_conflict",
									message:
										"Your current membership is still active. Redeem a code for the same plan, or wait until it expires before switching plans.",
								})
							const startsAt = active ? old.expires_at : at
							const expiresAt = addMembershipMonths({
								timestamp: startsAt,
								months: code.months,
							})
							yield* sql`INSERT INTO kay_subscriptions(account_id,plan_id,starts_at,expires_at,revision) VALUES (${accountId},${code.plan_id},${at},${expiresAt},1) ON CONFLICT(account_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,starts_at=${active ? old.starts_at : at},expires_at=EXCLUDED.expires_at,revision=kay_subscriptions.revision+1`
							yield* sql`UPDATE kay_membership_codes SET account_id=${accountId},redeemed_name=${displayName},redeemed_at=${at} WHERE id=${code.id}`
							const saved =
								yield* sql`INSERT INTO kay_membership_redemptions(account_id,request_id,code_id,plan_id,starts_at,expires_at,redeemed_at) VALUES (${accountId},${decoded.requestId},${code.id},${code.plan_id},${startsAt},${expiresAt},${at}) RETURNING *`
							return yield* receipt({ row: saved[0], accountId })
						}),
					)
				}),
			)
		},
		redemption: ({ accountId, requestId }) =>
			db.runPromise(
				Effect.gen(function* () {
					const sql = yield* PgClient.PgClient
					const rows =
						yield* sql`SELECT * FROM kay_membership_redemptions WHERE account_id=${accountId} AND request_id=${requestId}`
					return rows[0] === undefined
						? null
						: yield* receipt({ row: rows[0], accountId })
				}),
			),
	}
}
