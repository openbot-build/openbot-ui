import { createHmac, randomUUID } from "node:crypto"
import { PgClient } from "@effect/sql-pg"
import { Effect, Schema } from "effect"
import type { Configuration } from "./Configuration.ts"
import type { DatabaseRuntime } from "./Database.ts"

const Verified = Schema.Struct({
	accountId: Schema.NullOr(Schema.NonEmptyString),
})
interface Authority {
	readonly active_backend: "e" | "openbot"
	readonly epoch: string
	readonly phase: string
}

interface Revocation {
	readonly id: string
	readonly credential_digest: string
	readonly account_id: string
	readonly backend: "e" | "openbot"
	readonly epoch: string
	readonly phase: "Pending" | "Completed"
}
const Reconciled = Schema.Struct({ revoked: Schema.Boolean })
const fingerprint = (config: Configuration, headers: Headers) => {
	const cookie = (headers.get("cookie") ?? "")
		.split(";")
		.map((value) => value.trim())
		.find((value) => value.startsWith("__Host-e-session="))
		?.slice("__Host-e-session=".length)
	if (cookie === undefined) return null
	try {
		const value = decodeURIComponent(cookie),
			dot = value.lastIndexOf(".")
		return dot < 1
			? null
			: createHmac("sha256", config.internalToken)
					.update(value.slice(0, dot))
					.digest("hex")
	} catch {
		return null
	}
}
const complete = async (
	config: Configuration,
	db: DatabaseRuntime,
	record: Revocation,
) =>
	db.runPromise(
		Effect.flatMap(PgClient.PgClient, (sql) =>
			sql.withTransaction(
				Effect.gen(function* () {
					if (config.backendRouting === "ledger")
						yield* sql`UPDATE kay_migration_accounts SET phase='E_ACTIVE',epoch=epoch+1,freeze_deadline_at=NULL,last_error='Authentication revoked during migration',validation_result=NULL,updated_at=now() WHERE active_backend='e' AND phase<>'E_ACTIVE' AND (account_id=${record.account_id} OR account_id IN (SELECT unnest(cohort.account_ids) FROM kay_migration_cohorts cohort JOIN kay_migration_accounts anchor ON anchor.migration_id=cohort.migration_id WHERE anchor.account_id=${record.account_id}))`
					yield* sql`UPDATE kay_auth_revocations SET phase='Completed',updated_at=now() WHERE id=${record.id}`
					yield* sql`DELETE FROM kay_auth_write_leases WHERE request_id=${record.id} AND backend=${record.backend} AND epoch=${record.epoch}`
				}),
			),
		),
	)

/** An internal operator can reconcile a receipt without retaining its browser cookie. */
export const reconcileRevocation = async ({
	config,
	db,
	id,
}: {
	readonly config: Configuration
	readonly db: DatabaseRuntime
	readonly id: string
}) => {
	const records = await db.runPromise(
		Effect.flatMap(
			PgClient.PgClient,
			(sql) =>
				sql<Revocation>`SELECT * FROM kay_auth_revocations WHERE id=${id}`,
		),
	)
	const record = records[0]
	if (record === undefined) return { found: false, completed: false }
	if (record.phase === "Completed") return { found: true, completed: true }
	const origin = record.backend === "e" ? config.eOrigin : config.openbotOrigin
	const response = await fetch(
		new URL("/internal/auth/revocation-status", origin),
		{
			method: "POST",
			headers: {
				authorization: "Bearer " + config.internalToken,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				leaseId: record.id,
				epoch: Number(record.epoch),
				retry: true,
			}),
			redirect: "error",
			signal: AbortSignal.timeout(10000),
		},
	)
	if (!response.ok) throw new Error("Revocation reconciliation unavailable")
	const result = Schema.decodeUnknownSync(Reconciled)(await response.json())
	if (result.revoked) await complete(config, db, record)
	return { found: true, completed: result.revoked }
}

/** Real cookie proof precedes any ledger change. The durable lease spans the
 * confirmed SDK removal, so a concurrent copy/activation cannot retain it. */
export const logout = async ({
	config,
	db,
	headers,
}: {
	readonly config: Configuration
	readonly db: DatabaseRuntime
	readonly headers: Headers
}): Promise<Response> => {
	const query = <A, E>(f: (sql: PgClient.PgClient) => Effect.Effect<A, E>) =>
		db.runPromise(Effect.flatMap(PgClient.PgClient, f))
	const privateHeaders = new Headers({
		authorization: "Bearer " + config.internalToken,
		"content-type": "application/json",
		cookie: headers.get("cookie") ?? "",
	})
	const originFor = (backend: Authority["active_backend"]) =>
		backend === "e" ? config.eOrigin : config.openbotOrigin
	const digest = fingerprint(config, headers)
	if (digest !== null) {
		const pending = await query(
			(sql) =>
				sql<Revocation>`SELECT * FROM kay_auth_revocations WHERE credential_digest=${digest} AND phase='Pending'`,
		)
		for (const record of pending)
			await reconcileRevocation({ config, db, id: record.id })
	}
	for (let attempt = 0; attempt < 3; attempt++) {
		const rows = await query(
			(sql) =>
				sql<Authority>`SELECT active_backend,epoch,phase FROM kay_auth_migration WHERE id='global'`,
		)
		const previous = rows[0]
		if (previous === undefined)
			throw new Error("Authentication authority unavailable")
		const verified = await fetch(
			new URL("/internal/auth/session", originFor(previous.active_backend)),
			{
				method: "POST",
				headers: privateHeaders,
				redirect: "error",
				signal: AbortSignal.timeout(5000),
			},
		)
		if (!verified.ok) throw new Error("Session verification unavailable")
		const proof = Schema.decodeUnknownSync(Verified)(await verified.json())
		if (proof.accountId === null)
			return new Response(null, {
				status: 204,
				headers: verified.headers
					.getSetCookie()
					.map((value) => ["set-cookie", value]),
			})
		if (digest === null)
			throw new Error("A verified session cookie is required")
		const accountId = proof.accountId
		const leaseId = randomUUID()
		const lease = await query((sql) =>
			sql.withTransaction(
				Effect.gen(function* () {
					const locked =
						yield* sql<Authority>`SELECT active_backend,epoch,phase FROM kay_auth_migration WHERE id='global' FOR UPDATE`
					const current = locked[0]
					if (
						current === undefined ||
						current.active_backend !== previous.active_backend ||
						current.epoch !== previous.epoch
					)
						return null
					const cancelled = ["DRAINING", "COPIED", "VALIDATED"].includes(
						current.phase,
					)
					const epoch = Number(current.epoch) + (cancelled ? 1 : 0)
					if (cancelled)
						yield* sql`UPDATE kay_auth_migration SET phase='E_ACTIVE',active_backend='e',epoch=${epoch},freeze_deadline_at=NULL,validation_result=NULL,last_error='Verified sign-out interrupted identity migration',updated_at=now() WHERE id='global'`
					yield* sql`INSERT INTO kay_auth_write_leases(request_id,backend,epoch) VALUES(${leaseId},${current.active_backend},${epoch})`
					yield* sql`INSERT INTO kay_auth_revocations(id,credential_digest,account_id,backend,epoch,phase) VALUES(${leaseId},${digest},${accountId},${current.active_backend},${epoch},'Pending')`
					return { backend: current.active_backend, epoch, leaseId }
				}),
			),
		)
		if (lease === null) continue
		// Uncertain responses retain the receipt and durable lease. A retry or the
		// private reconciliation route checks the authoritative store before release.
		const revoked = await fetch(
			new URL("/internal/auth/revoke", originFor(lease.backend)),
			{
				method: "POST",
				headers: privateHeaders,
				body: JSON.stringify({ leaseId: lease.leaseId, epoch: lease.epoch }),
				redirect: "error",
				signal: AbortSignal.timeout(10000),
			},
		)
		if (revoked.status !== 204)
			throw new Error("Session revocation not confirmed")
		await revoked.arrayBuffer()
		await complete(config, db, {
			id: lease.leaseId,
			credential_digest: digest,
			account_id: accountId,
			backend: lease.backend,
			epoch: String(lease.epoch),
			phase: "Pending",
		})
		// A preceding attempt may have timed out after committing its removal.
		const pending = await query(
			(sql) =>
				sql<Revocation>`SELECT * FROM kay_auth_revocations WHERE credential_digest=${digest} AND phase='Pending'`,
		)
		for (const record of pending)
			await reconcileRevocation({ config, db, id: record.id })
		return new Response(null, {
			status: 204,
			headers: revoked.headers
				.getSetCookie()
				.map((value) => ["set-cookie", value]),
		})
	}
	throw new Error("Authentication authority changed; retry sign-out")
}
