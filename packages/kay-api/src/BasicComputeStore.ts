import { PgClient, PgConnection } from "@effect/sql-pg"
import { Effect, Match, Schema, SchemaGetter } from "effect"
import * as Product from "@kaicom/kay-contracts"
import type { DatabaseRuntime } from "./Database.ts"

export interface ComputeOwner {
	readonly accountId: string
	readonly organizationId: string
}
const number = Schema.Union([Schema.String, Schema.Finite, Schema.BigInt]).pipe(
	Schema.decodeTo(Schema.Int, {
		decode: SchemaGetter.transform((value) => Number(value)),
		encode: SchemaGetter.transform((value) => String(value)),
	}),
)
const Account = Schema.Struct({
	account_id: Product.Id,
	organization_id: Product.Id,
	computer_id: Schema.NullOr(Product.Id),
	bot_id: Schema.NullOr(Product.Id),
	generation: number,
	token_ciphertext: Schema.NullOr(Schema.String),
	state: Schema.Literals([
		"provisioning",
		"needs_repair",
		"connecting",
		"ready",
	]),
	last_request_id: Schema.NullOr(Product.RequestId),
	connected_at: Schema.NullOr(number),
	updated_at: number,
})
const Operation = Schema.Struct({
	account_id: Product.Id,
	organization_id: Product.Id,
	request_id: Product.RequestId,
	action: Product.BasicComputeOperation.fields.action,
	phase: Product.BasicComputeOperation.fields.phase,
	computer_id: Schema.NullOr(Product.Id),
	command_key: Schema.String,
	execution_id: Schema.NullOr(Product.Id),
	retired_computer_id: Schema.NullOr(Product.Id),
	retired_execution_id: Schema.NullOr(Product.Id),
	create_sent: Schema.Boolean,
	grant_sent: Schema.Boolean,
	token_sent: Schema.Boolean,
	generation: number,
	revision: number,
	message: Schema.NullOr(Schema.String),
	updated_at: number,
})
const Lease = Schema.Struct({
	lease_id: Product.Id,
	account_id: Product.Id,
	organization_id: Product.Id,
	computer_id: Product.Id,
	generation: number,
	connection_nonce: Schema.String,
	creation_confirmed: Schema.Boolean,
	container_name: Schema.String,
	expires_at: number,
	activity: Schema.Literals(["working", "idle", "unknown"]),
	activity_at: Schema.NullOr(number),
	idle_since: Schema.NullOr(number),
	state: Schema.Literals(["starting", "active", "cleanup_pending"]),
})
export type ComputeAccount = typeof Account.Type
export type ComputeOperation = typeof Operation.Type
export type ComputeLease = typeof Lease.Type
export const operationView = (
	row: ComputeOperation,
): Product.BasicComputeOperation => ({
	requestId: row.request_id,
	action: row.action,
	phase: row.phase,
	computerId: row.computer_id,
	message: row.message,
})

export const makeComputeStore = (db: DatabaseRuntime) => {
	const run = <A, E>(body: (sql: PgClient.PgClient) => Effect.Effect<A, E>) =>
		db.runPromise(
			Effect.gen(function* () {
				return yield* body(yield* PgClient.PgClient)
			}),
		)
	return {
		withOperationLock: <A>(
			input: ComputeOwner & { readonly requestId: string },
			work: () => Promise<A>,
		) =>
			run((sql) =>
				Effect.scoped(
					Effect.gen(function* () {
						// This session is closed, never returned to a pool with a session lock.
						const connection = yield* PgConnection.make({
							...sql.config,
							applicationName: "kay-basic-compute-setup",
						})
						const key = JSON.stringify([
							"basic-compute-operation",
							input.accountId,
							input.organizationId,
							input.requestId,
						])
						const result = yield* connection.query(
							"SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired",
							[key],
						)
						if (result.rows[0]?.["acquired"] !== true)
							return { acquired: false } as const
						yield* Effect.addFinalizer(() =>
							connection
								.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
									key,
								])
								.pipe(
									Effect.timeout("5 seconds"),
									Effect.asVoid,
									Effect.catchCause((cause) =>
										Effect.logError(
											"The setup lock session will close after an unlock failure.",
											cause,
										),
									),
								),
						)
						// A sent HTTP request can outlive cancellation. Keep its lock until it settles.
						const outcome = yield* Effect.promise(async () => {
							try {
								return { ok: true, value: await work() } as const
							} catch (error) {
								return { ok: false, error } as const
							}
						}).pipe(Effect.uninterruptible)
						return { acquired: true, outcome } as const
					}),
				),
			).then((result) => {
				if (!result.acquired) return result
				if (!result.outcome.ok) throw result.outcome.error
				return { acquired: true, value: result.outcome.value } as const
			}),
		isManaged: (computerId: string) =>
			run((sql) =>
				sql`SELECT computer_id FROM kay_basic_compute_accounts WHERE lower(computer_id)=lower(${computerId}) UNION SELECT computer_id FROM kay_basic_compute_operations WHERE lower(computer_id)=lower(${computerId})`.pipe(
					Effect.map((rows) => rows.length !== 0),
				),
			),
		pendingCreation: (owner: ComputeOwner) =>
			run((sql) =>
				sql`SELECT request_id FROM kay_basic_compute_operations WHERE account_id=${owner.accountId} AND organization_id=${owner.organizationId} AND create_sent=true AND computer_id IS NULL AND phase='creating'`.pipe(
					Effect.map((rows) => rows.length !== 0),
				),
			),
		// Only the session-lock holder may resume a stale owner. A timed-out token is still fenced.
		acquireOperation: (
			input: ComputeOwner & {
				readonly requestId: string
				readonly lockId: string
				readonly repair: boolean
			},
		) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_accounts a SET operation_lock_owner=${input.lockId},operation_lock_request_id=${input.requestId},operation_lock_until=NULL,generation=CASE WHEN ${input.repair} THEN generation+1 ELSE generation END,token_ciphertext=CASE WHEN ${input.repair} THEN NULL ELSE token_ciphertext END,state=CASE WHEN ${input.repair} THEN 'needs_repair' ELSE state END WHERE account_id=${input.accountId} AND organization_id=${input.organizationId} AND (operation_lock_owner IS NULL OR (operation_lock_request_id=${input.requestId} AND EXISTS (SELECT 1 FROM kay_basic_compute_operations o WHERE o.account_id=a.account_id AND o.organization_id=a.organization_id AND o.request_id=a.operation_lock_request_id AND o.token_sent=false)) OR (${input.repair} AND operation_lock_request_id<>${input.requestId} AND EXISTS (SELECT 1 FROM kay_basic_compute_operations o WHERE o.account_id=a.account_id AND o.organization_id=a.organization_id AND o.request_id=a.operation_lock_request_id AND o.token_sent=true AND o.generation=a.generation))) RETURNING account_id`.pipe(
					Effect.map((rows) => rows.length === 1),
				),
			),
		holdsOperation: (input: ComputeOwner & { readonly lockId: string }) =>
			run((sql) =>
				sql`SELECT account_id FROM kay_basic_compute_accounts WHERE account_id=${input.accountId} AND organization_id=${input.organizationId} AND operation_lock_owner=${input.lockId}`.pipe(
					Effect.map((rows) => rows.length === 1),
				),
			),
		releaseOperation: (
			input: ComputeOwner & {
				readonly requestId: string
				readonly lockId: string
			},
		) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_accounts SET operation_lock_owner=NULL,operation_lock_request_id=NULL,operation_lock_until=NULL WHERE account_id=${input.accountId} AND organization_id=${input.organizationId} AND operation_lock_owner=${input.lockId}`.pipe(
					Effect.asVoid,
				),
			),
		replacement: (input: {
			readonly operation: ComputeOperation
			readonly computerId: string
		}) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_operations SET retired_computer_id=${input.computerId},computer_id=NULL,phase='pending',revision=revision+1,updated_at=${Date.now()} WHERE account_id=${input.operation.account_id} AND organization_id=${input.operation.organization_id} AND request_id=${input.operation.request_id} AND retired_computer_id IS NULL RETURNING *`.pipe(
					Effect.map((rows) => Schema.decodeUnknownSync(Operation)(rows[0])),
				),
			),
		retirementReceipt: (input: {
			readonly operation: ComputeOperation
			readonly executionId: string
		}) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_operations SET retired_execution_id=${input.executionId},revision=revision+1,updated_at=${Date.now()} WHERE account_id=${input.operation.account_id} AND organization_id=${input.operation.organization_id} AND request_id=${input.operation.request_id} RETURNING *`.pipe(
					Effect.map((rows) => Schema.decodeUnknownSync(Operation)(rows[0])),
				),
			),
		detachRetired: (
			input: ComputeOwner & {
				readonly computerId: string
				readonly lockId: string
			},
		) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_accounts SET computer_id=NULL,bot_id=NULL,token_ciphertext=NULL,connected_at=NULL,state='provisioning',updated_at=${Date.now()} WHERE account_id=${input.accountId} AND organization_id=${input.organizationId} AND computer_id=${input.computerId} AND operation_lock_owner=${input.lockId}`.pipe(
					Effect.asVoid,
				),
			),
		account: (owner: ComputeOwner) =>
			run((sql) =>
				sql`SELECT * FROM kay_basic_compute_accounts WHERE account_id=${owner.accountId} AND organization_id=${owner.organizationId}`.pipe(
					Effect.map((rows) =>
						rows[0] === undefined
							? null
							: Schema.decodeUnknownSync(Account)(rows[0]),
					),
				),
			),
		accounts: () =>
			run((sql) =>
				sql`SELECT * FROM kay_basic_compute_accounts WHERE token_ciphertext IS NOT NULL`.pipe(
					Effect.map(Schema.decodeUnknownSync(Schema.Array(Account))),
				),
			),
		operation: (input: ComputeOwner & { readonly requestId: string }) =>
			run((sql) =>
				sql`SELECT * FROM kay_basic_compute_operations WHERE account_id=${input.accountId} AND organization_id=${input.organizationId} AND request_id=${input.requestId}`.pipe(
					Effect.map((rows) =>
						rows[0] === undefined
							? null
							: Schema.decodeUnknownSync(Operation)(rows[0]),
					),
				),
			),
		claim: (
			input: ComputeOwner & {
				readonly requestId: string
				readonly action: Product.BasicComputeOperation["action"]
				readonly commandKey: string
			},
		) =>
			run((sql) =>
				sql.withTransaction(
					Effect.gen(function* () {
						yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["basic-compute", input.accountId, input.organizationId])},0))`
						const existing =
							yield* sql`SELECT * FROM kay_basic_compute_operations WHERE account_id=${input.accountId} AND organization_id=${input.organizationId} AND request_id=${input.requestId}`
						if (existing[0] !== undefined)
							return {
								created: false,
								operation: yield* Schema.decodeUnknownEffect(Operation)(
									existing[0],
								),
							}
						yield* sql`INSERT INTO kay_basic_compute_accounts(account_id,organization_id,updated_at) VALUES(${input.accountId},${input.organizationId},${Date.now()}) ON CONFLICT DO NOTHING`
						const account = yield* Schema.decodeUnknownEffect(Account)(
							(yield* sql`SELECT * FROM kay_basic_compute_accounts WHERE account_id=${input.accountId} AND organization_id=${input.organizationId}`)[0],
						)
						if (
							input.action === "provision" &&
							account.last_request_id !== null &&
							account.state === "provisioning"
						) {
							const previous =
								yield* sql`SELECT * FROM kay_basic_compute_operations WHERE account_id=${input.accountId} AND organization_id=${input.organizationId} AND request_id=${account.last_request_id}`
							if (previous[0] !== undefined) {
								const pending = yield* Schema.decodeUnknownEffect(Operation)(
									previous[0],
								)
								if (
									pending.action !== "release" &&
									!["ready", "failed", "needs_repair"].includes(pending.phase)
								)
									return { created: false, operation: pending }
							}
						}
						const rows =
							yield* sql`INSERT INTO kay_basic_compute_operations(account_id,organization_id,request_id,action,phase,computer_id,command_key,generation,updated_at) VALUES(${input.accountId},${input.organizationId},${input.requestId},${input.action},'pending',${account.computer_id},${input.commandKey},${account.generation},${Date.now()}) RETURNING *`
						yield* sql`UPDATE kay_basic_compute_accounts SET last_request_id=${input.requestId},updated_at=${Date.now()} WHERE account_id=${input.accountId} AND organization_id=${input.organizationId}`
						return {
							created: true,
							operation: yield* Schema.decodeUnknownEffect(Operation)(rows[0]),
						}
					}),
				),
			),
		updateOperation: (input: {
			readonly operation: ComputeOperation
			readonly lockId?: string
			readonly phase?: ComputeOperation["phase"]
			readonly computerId?: string
			readonly executionId?: string
			readonly createSent?: boolean
			readonly grantSent?: boolean
			readonly tokenSent?: boolean
			readonly generation?: number
			readonly message?: string | null
		}) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_operations SET revision=revision+1,phase=${input.phase ?? input.operation.phase},computer_id=${input.computerId ?? input.operation.computer_id},execution_id=${input.executionId ?? input.operation.execution_id},create_sent=${input.createSent ?? input.operation.create_sent},grant_sent=${input.grantSent ?? input.operation.grant_sent},token_sent=${input.tokenSent ?? input.operation.token_sent},generation=${input.generation ?? input.operation.generation},message=${input.message === undefined ? input.operation.message : input.message},updated_at=${Date.now()} WHERE account_id=${input.operation.account_id} AND organization_id=${input.operation.organization_id} AND request_id=${input.operation.request_id} AND revision=${input.operation.revision} AND (${input.lockId ?? null}::text IS NULL OR EXISTS (SELECT 1 FROM kay_basic_compute_accounts a WHERE a.account_id=${input.operation.account_id} AND a.organization_id=${input.operation.organization_id} AND a.operation_lock_owner=${input.lockId ?? null})) RETURNING *`.pipe(
					Effect.flatMap((rows) =>
						rows[0] === undefined
							? sql`SELECT * FROM kay_basic_compute_operations WHERE account_id=${input.operation.account_id} AND organization_id=${input.operation.organization_id} AND request_id=${input.operation.request_id}`.pipe(
									Effect.map((current) =>
										Schema.decodeUnknownSync(Operation)(current[0]),
									),
								)
							: Effect.succeed(Schema.decodeUnknownSync(Operation)(rows[0])),
					),
				),
			),
		claimSend: (input: {
			readonly operation: ComputeOperation
			readonly lockId: string
			readonly kind: "create" | "grant"
			readonly message: string
		}) =>
			run((sql) => {
				const step = Match.value(input.kind).pipe(
					Match.when("create", () => ({
						phase: "creating",
						createSent: true,
						grantSent: input.operation.grant_sent,
						unsent: sql`create_sent=false`,
					})),
					Match.when("grant", () => ({
						phase: "granting",
						createSent: input.operation.create_sent,
						grantSent: true,
						unsent: sql`grant_sent=false`,
					})),
					Match.exhaustive,
				)
				return sql`UPDATE kay_basic_compute_operations SET revision=revision+1,phase=${step.phase},create_sent=${step.createSent},grant_sent=${step.grantSent},message=${input.message},updated_at=${Date.now()} WHERE account_id=${input.operation.account_id} AND organization_id=${input.operation.organization_id} AND request_id=${input.operation.request_id} AND revision=${input.operation.revision} AND ${step.unsent} AND EXISTS (SELECT 1 FROM kay_basic_compute_accounts a WHERE a.account_id=${input.operation.account_id} AND a.organization_id=${input.operation.organization_id} AND a.operation_lock_owner=${input.lockId}) RETURNING *`.pipe(
					Effect.map((rows) =>
						rows[0] === undefined
							? null
							: Schema.decodeUnknownSync(Operation)(rows[0]),
					),
				)
			}),
		attachComputer: (
			input: ComputeOwner & {
				readonly computerId: string
				readonly botId: string
				readonly lockId: string
			},
		) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_accounts SET computer_id=${input.computerId},bot_id=${input.botId},updated_at=${Date.now()} WHERE account_id=${input.accountId} AND organization_id=${input.organizationId} AND operation_lock_owner=${input.lockId} AND (computer_id IS NULL OR computer_id=${input.computerId}) RETURNING *`.pipe(
					Effect.map((rows) =>
						rows[0] === undefined
							? null
							: Schema.decodeUnknownSync(Account)(rows[0]),
					),
				),
			),
		beginToken: (
			owner: ComputeOwner & {
				readonly computerId: string
				readonly lockId: string
				readonly requestId: string
			},
		) =>
			run((sql) =>
				sql.withTransaction(
					Effect.gen(function* () {
						const rows =
							yield* sql`UPDATE kay_basic_compute_accounts SET generation=generation+1,token_ciphertext=NULL,state='needs_repair',connected_at=NULL,updated_at=${Date.now()} WHERE account_id=${owner.accountId} AND organization_id=${owner.organizationId} AND computer_id=${owner.computerId} AND operation_lock_owner=${owner.lockId} RETURNING *`
						if (rows[0] === undefined) return null
						const account = yield* Schema.decodeUnknownEffect(Account)(rows[0])
						const operations =
							yield* sql`UPDATE kay_basic_compute_operations SET phase='issuing_token',token_sent=true,generation=${account.generation},revision=revision+1,message=NULL,updated_at=${Date.now()} WHERE account_id=${owner.accountId} AND organization_id=${owner.organizationId} AND request_id=${owner.requestId} RETURNING *`
						return {
							account,
							operation: yield* Schema.decodeUnknownEffect(Operation)(
								operations[0],
							),
						}
					}),
				),
			),
		saveToken: (
			input: ComputeOwner & {
				readonly generation: number
				readonly ciphertext: string
			},
		) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_accounts SET token_ciphertext=${input.ciphertext},state='connecting',updated_at=${Date.now()} WHERE account_id=${input.accountId} AND organization_id=${input.organizationId} AND generation=${input.generation} RETURNING account_id`.pipe(
					Effect.map((rows) => rows.length === 1),
				),
			),
		connection: (
			input: ComputeOwner & {
				readonly generation: number
				readonly connected: boolean
			},
		) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_accounts SET state=${input.connected ? "ready" : "connecting"},connected_at=${input.connected ? Date.now() : null},updated_at=${Date.now()} WHERE account_id=${input.accountId} AND organization_id=${input.organizationId} AND generation=${input.generation} AND token_ciphertext IS NOT NULL`.pipe(
					Effect.asVoid,
				),
			),
		lease: () =>
			run((sql) =>
				sql`SELECT * FROM kay_basic_compute_lease WHERE singleton=true`.pipe(
					Effect.map((rows) =>
						rows[0] === undefined
							? null
							: Schema.decodeUnknownSync(Lease)(rows[0]),
					),
				),
			),
		claimLease: (lease: ComputeLease) =>
			run((sql) =>
				sql`INSERT INTO kay_basic_compute_lease(singleton,lease_id,account_id,organization_id,computer_id,generation,connection_nonce,container_name,expires_at,activity,activity_at,idle_since,state) VALUES(true,${lease.lease_id},${lease.account_id},${lease.organization_id},${lease.computer_id},${lease.generation},${lease.connection_nonce},${lease.container_name},${lease.expires_at},${lease.activity},${lease.activity_at},${lease.idle_since},${lease.state}) ON CONFLICT DO NOTHING RETURNING lease_id`.pipe(
					Effect.map((rows) => rows.length === 1),
				),
			),
		activity: (input: {
			readonly leaseId: string
			readonly generation: number
			readonly nonce: string
			readonly activity: ComputeLease["activity"]
			readonly now: number
			readonly membershipExpiresAt: number
		}) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_lease SET activity=${input.activity},activity_at=${input.now},idle_since=CASE WHEN ${input.activity}='idle' THEN COALESCE(idle_since,${input.now}) ELSE NULL END,expires_at=CASE WHEN ${input.activity}='idle' THEN LEAST(${input.membershipExpiresAt},COALESCE(idle_since,${input.now})+300000) ELSE ${input.membershipExpiresAt} END WHERE lease_id=${input.leaseId} AND generation=${input.generation} AND connection_nonce=${input.nonce} AND state='active'`.pipe(
					Effect.asVoid,
				),
			),
		claimIdleCleanup: (input: {
			readonly leaseId: string
			readonly now: number
			readonly activityAt: number | null
		}) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_lease SET state='cleanup_pending' WHERE lease_id=${input.leaseId} AND state='active' AND activity='idle' AND activity_at IS NOT DISTINCT FROM ${input.activityAt} AND expires_at<=${input.now} RETURNING lease_id`.pipe(
					Effect.map((rows) => rows.length === 1),
				),
			),
		leaseState: (input: {
			readonly leaseId: string
			readonly state: ComputeLease["state"]
		}) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_lease SET state=${input.state} WHERE lease_id=${input.leaseId}`.pipe(
					Effect.asVoid,
				),
			),
		confirmCreation: (leaseId: string) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_lease SET creation_confirmed=true WHERE lease_id=${leaseId}`.pipe(
					Effect.asVoid,
				),
			),
		releaseLease: (leaseId: string) =>
			run((sql) =>
				sql`DELETE FROM kay_basic_compute_lease WHERE lease_id=${leaseId}`.pipe(
					Effect.asVoid,
				),
			),
		claimCall: (
			input: ComputeOwner & {
				readonly computerId: string
				readonly generation: number
				readonly operationId: string
				readonly kind: "command" | "file"
				readonly leaseId: string
			},
		) =>
			run((sql) =>
				sql`INSERT INTO kay_basic_compute_calls(computer_id,operation_id,account_id,organization_id,generation,lease_id,kind,status,started_at) VALUES(${input.computerId},${input.operationId},${input.accountId},${input.organizationId},${input.generation},${input.leaseId},${input.kind},'started',${Date.now()}) ON CONFLICT DO NOTHING RETURNING operation_id`.pipe(
					Effect.map((rows) => rows.length === 1),
				),
			),
		finishCall: (input: {
			readonly computerId: string
			readonly operationId: string
			readonly generation: number
			readonly status: "completed" | "unknown"
		}) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_calls SET status=${input.status},ended_at=${Date.now()} WHERE computer_id=${input.computerId} AND operation_id=${input.operationId} AND generation=${input.generation} AND status='started'`.pipe(
					Effect.asVoid,
				),
			),
		interruptCalls: (leaseId: string) =>
			run((sql) =>
				sql`UPDATE kay_basic_compute_calls SET status='unknown',ended_at=${Date.now()} WHERE lease_id=${leaseId} AND status='started'`.pipe(
					Effect.asVoid,
				),
			),
	}
}
export type ComputeStore = ReturnType<typeof makeComputeStore>
