import { makeFeedback } from "./Feedback.ts"
import { makeFeedbackPublisher } from "./FeedbackMcp.ts"
import { makeNativeNavigation } from "./NativeNavigation.ts"
import { makeComputeStore } from "./BasicComputeStore.ts"
import { basicComputeManagedPath } from "./BasicComputeManagement.ts"
import {
	nativeConnectorPath,
	nativePublicHeaders,
	publicNativeEndpoint,
	relayNativePublic,
} from "./NativePublic.ts"
import { makeTelemetry, type Telemetry } from "./Telemetry.ts"
import { logout } from "./Logout.ts"
import { attachNativeLiveProxy, LiveProxyFailure } from "./NativeLiveProxy.ts"
import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { PgClient } from "@effect/sql-pg"
import { Effect, Schema } from "effect"
import {
	AuthApi,
	ExperienceStorageUnavailable,
	Identity,
	PreferencesApi,
} from "@kaicom/e-platform-api"
import { RestoreSessionRequest } from "@kaicom/e-platform-api"
import { Session } from "@kaicom/e-core"
import type { Configuration } from "./Configuration.ts"
import type { DatabaseRuntime } from "./Database.ts"
import * as Projection from "./compatibility/Projection.ts"
import * as Approvals from "./compatibility/Approvals.ts"
import * as Activity from "./compatibility/Activity.ts"
import * as OpenBotIdentity from "./compatibility/Identity.ts"
import { sessionError } from "./compatibility/Errors.ts"
import * as Preferences from "./preferences/Preferences.ts"
import * as PreferenceRepository from "./preferences/RepositoryPostgres.ts"
import { Repository } from "./preferences/Repository.ts"
import { makeOperations, type Operation } from "./Operations.ts"
import {
	handleProductRequest,
	type NativeClientFactory,
} from "./ProductGateway.ts"

const VerifiedSession = Schema.Struct({
	identity: Schema.Struct({
		userId: Schema.NonEmptyString,
		organizationId: Schema.optionalKey(Schema.String),
		tenantId: Schema.optionalKey(Schema.String),
	}),
	profile: Schema.JsonObject,
	expiresAt: Schema.String,
})
type Route = {
	accountId: string
	backend: "e" | "openbot"
	epoch: number
	phase: string
}

class HttpFailure extends Error {
	readonly status: number
	readonly body: Projection.Json
	constructor(status: number, body: Projection.Json) {
		super("Request failed")
		this.status = status
		this.body = body
	}
}
const fail = (status: number, tag: string, message: string): never => {
	throw new HttpFailure(status, { _tag: tag, message })
}
const json = (res: ServerResponse, status: number, body: Projection.Json) => {
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store",
	})
	res.end(JSON.stringify(body))
}
async function* responseChunks(
	body: ReadableStream<Uint8Array>,
	observe?: (chunk: Uint8Array) => void,
) {
	const reader = body.getReader()
	try {
		while (true) {
			const part = await reader.read()
			if (part.done) return
			observe?.(part.value)
			yield part.value
		}
	} finally {
		await reader.cancel()
		reader.releaseLock()
	}
}
const readBody = async (
	req: IncomingMessage,
): Promise<Projection.Json | undefined> => {
	let size = 0
	const chunks: Buffer[] = []
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		size += buffer.length
		if (size > 16 * 1024 * 1024)
			return fail(413, "ExperienceInputInvalid", "The request is too large.")
		chunks.push(buffer)
	}
	if (size === 0) return undefined
	try {
		return Schema.decodeUnknownSync(Schema.Json)(
			JSON.parse(Buffer.concat(chunks).toString("utf8")),
		)
	} catch {
		return fail(400, "ExperienceInputInvalid", "Send a JSON request.")
	}
}

/** Copy credentials, never caller-supplied identity, routing or proxy headers. */
const upstreamHeaders = (
	req: IncomingMessage,
	config: Configuration,
	requestId: string,
) => {
	const headers = new Headers({
		"x-request-id": requestId,
		accept: req.headers.accept ?? "application/json",
	})
	for (const name of [
		"cookie",
		"authorization",
		"origin",
		"content-type",
		"accept-language",
	] as const) {
		const value = req.headers[name]
		if (typeof value === "string") headers.set(name, value)
	}
	headers.set("x-forwarded-host", new URL(config.publicOrigin).host)
	headers.set(
		"x-forwarded-proto",
		new URL(config.publicOrigin).protocol.slice(0, -1),
	)
	return headers
}

export const createGateway = ({
	config,
	db,
	telemetry = makeTelemetry(),
	nativeProduct,
}: {
	readonly config: Configuration
	readonly db: DatabaseRuntime
	readonly telemetry?: Telemetry
	readonly nativeProduct?: NativeClientFactory
}) => {
	const operations = makeOperations(db)
	const feedback = makeFeedback({ db, secret: config.internalToken })
	let feedbackPublisher: ReturnType<typeof makeFeedbackPublisher> | undefined
	const verifiedSession = (value: unknown, backend: Route["backend"]) => {
		if (backend === "e") return Schema.decodeUnknownSync(VerifiedSession)(value)
		try {
			return OpenBotIdentity.session(value, config.openbotOrganizationId)
		} catch (error) {
			if (error instanceof OpenBotIdentity.MembershipDenied)
				return fail(
					403,
					"PermissionDenied",
					"Your account does not have access to Kay.",
				)
			return fail(
				503,
				"AuthenticationUnavailable",
				"Kay could not verify your organization.",
			)
		}
	}
	const originFor = (backend: Route["backend"]) => {
		if (config.backendRouting === "native" && backend !== "openbot")
			return fail(
				503,
				"BackendUnavailable",
				"The legacy backend is unavailable.",
			)
		return backend === "e" ? config.eOrigin : config.openbotOrigin
	}
	const query = <A, E>(f: (sql: PgClient.PgClient) => Effect.Effect<A, E>) =>
		db.runPromise(Effect.flatMap(PgClient.PgClient, f))
	const authBackend = async (): Promise<Route["backend"]> => {
		if (config.authBackend !== "ledger") return config.authBackend
		const rows = await query(
			(sql) =>
				sql<{
					active_backend: Route["backend"]
				}>`SELECT active_backend FROM kay_auth_migration WHERE id='global'`,
		)
		if (rows[0] === undefined)
			return fail(
				503,
				"AuthenticationUnavailable",
				"Sign-in is temporarily unavailable.",
			)
		return rows[0].active_backend
	}
	const routeFor = async (
		accountId: string,
		organizationId?: string,
	): Promise<Route> => {
		if (config.backendRouting === "native")
			return {
				accountId,
				backend: "openbot",
				epoch: 0,
				phase: "OPENBOT_ACTIVE",
			}
		if (config.backendRouting === "e")
			return { accountId, backend: "e", epoch: 0, phase: "E_ACTIVE" }
		const rows = await query(
			(sql) =>
				sql<{
					active_backend: "e" | "openbot"
					epoch: string
					phase: string
				}>`SELECT active_backend,epoch,phase FROM kay_migration_accounts WHERE account_id=${accountId}`,
		)
		let row = rows[0]
		if (
			row === undefined &&
			organizationId !== undefined &&
			config.authBackend === "ledger"
		) {
			// The identity cutover verifies routes for every legacy user before activation.
			// New users stay on e until the current staged rollout completes.
			// Its fixed population is never expanded by sign-up traffic.
			await query((sql) =>
				sql.withTransaction(
					Effect.gen(function* () {
						const authority =
							yield* sql`SELECT id FROM kay_auth_migration WHERE id='global' AND phase='OPENBOT_ACTIVE' AND validation_result IS NOT NULL FOR SHARE`
						if (authority.length === 0) return
						const pointer =
							yield* sql`SELECT rollout_id FROM kay_rollout_current WHERE id='global' FOR UPDATE`
						const complete =
							pointer[0]?.["rollout_id"] === undefined ||
							pointer[0]?.["rollout_id"] === null
								? []
								: yield* sql`SELECT id FROM kay_rollouts WHERE id=${pointer[0]["rollout_id"]} AND organization_id=${organizationId} AND status='complete' FOR SHARE`
						const native = complete.length === 1
						yield* sql`INSERT INTO kay_migration_accounts(account_id,source_tenant_id,target_organization_id,migration_id,phase,active_backend,epoch) VALUES(${accountId},${accountId},${organizationId},${native ? "native-openbot:" + accountId : ""},${native ? "OPENBOT_ACTIVE" : "E_ACTIVE"},${native ? "openbot" : "e"},0) ON CONFLICT(account_id) DO NOTHING`
					}),
				),
			)
			row = (
				await query(
					(sql) =>
						sql<{
							active_backend: "e" | "openbot"
							epoch: string
							phase: string
						}>`SELECT active_backend,epoch,phase FROM kay_migration_accounts WHERE account_id=${accountId}`,
				)
			)[0]
		}
		if (row === undefined)
			return fail(
				503,
				"ExperienceStorageUnavailable",
				"Your account is not ready. Try again shortly.",
			)
		return {
			accountId,
			backend: row.active_backend,
			epoch: Number(row.epoch),
			phase: row.phase,
		}
	}
	const callbackRoute = async (
		flowId: string,
		kind: "app" | "developer",
	): Promise<Route> => {
		if (config.backendRouting === "native")
			// The core owns and validates OAuth state, including anonymous callbacks.
			return {
				accountId: "",
				backend: "openbot",
				epoch: 0,
				phase: "OPENBOT_ACTIVE",
			}
		if (config.backendRouting === "e")
			return { accountId: "", backend: "e", epoch: 0, phase: "E_ACTIVE" }
		const legacy = await query(
			(sql) =>
				sql`SELECT account_id FROM kay_migration_accounts WHERE active_backend='e' LIMIT 1`,
		)
		const backends: Route["backend"][] =
			legacy.length === 0 ? ["openbot"] : ["e", "openbot"]
		const found = await Promise.all(
			backends.map(async (backend) => {
				const response = await fetch(
					new URL("/internal/apps/authorization-owner", originFor(backend)),
					{
						method: "POST",
						headers: {
							authorization: `Bearer ${config.internalToken}`,
							"content-type": "application/json",
						},
						body: JSON.stringify({ flowId, kind }),
						signal: AbortSignal.timeout(5000),
						redirect: "error",
					},
				)
				if (response.status === 404) return null
				if (!response.ok)
					return fail(
						503,
						"AuthenticationUnavailable",
						"App authorization is temporarily unavailable.",
					)
				const owner = Schema.decodeUnknownSync(
					Schema.Struct({ accountId: Schema.NonEmptyString }),
				)(await response.json())
				return owner.accountId
			}),
		)
		const owners = [...new Set(found.filter((v): v is string => v !== null))]
		if (owners.length !== 1)
			return fail(
				400,
				"ExperienceInputInvalid",
				"The App authorization flow could not be identified.",
			)
		return routeFor(owners[0]!)
	}
	const authorizeWrite = async (route: Route, requestId: string) => {
		if (config.backendRouting !== "ledger") return
		await query((sql) =>
			sql.withTransaction(
				Effect.gen(function* () {
					const rows = yield* sql<{
						phase: string
						epoch: string
						active_backend: string
					}>`SELECT phase,epoch,active_backend FROM kay_migration_accounts WHERE account_id=${route.accountId} FOR UPDATE`
					const row = rows[0]
					if (
						row === undefined ||
						Number(row.epoch) !== route.epoch ||
						row.active_backend !== route.backend ||
						!["E_ACTIVE", "PRECHECK", "OPENBOT_ACTIVE"].includes(row.phase)
					)
						return yield* Effect.fail(
							new HttpFailure(503, {
								_tag: "ExperienceStorageUnavailable",
								message:
									"Your account is temporarily read-only. Try again shortly.",
							}),
						)
					yield* sql`INSERT INTO kay_migration_write_leases(request_id,account_id,epoch,expires_at) VALUES (${requestId},${route.accountId},${route.epoch},now()+interval '1 hour')`
				}),
			),
		)
	}
	const releaseWrite = (requestId: string) =>
		config.backendRouting !== "ledger"
			? Promise.resolve()
			: query(
					(sql) =>
						sql`DELETE FROM kay_migration_write_leases WHERE request_id=${requestId}`,
				).then(() => undefined)
	const call = (
		route: Route,
		path: string,
		method: string,
		headers: Headers,
		body?: Projection.Json,
	) => {
		const forward = new Headers(headers)
		if (config.backendRouting === "ledger") {
			forward.set("x-kay-epoch", String(route.epoch))
			forward.set("x-kay-backend", route.backend)
		}
		if (body !== undefined) forward.set("content-type", "application/json")
		return fetch(new URL(path, originFor(route.backend)), {
			method,
			headers: forward,
			redirect: "manual",
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		})
	}
	const preferences = async (
		route: Route,
		headers: Headers,
		method: string,
		payload: Projection.Json | undefined,
	) => {
		const program = Effect.gen(function* () {
			const repository = yield* PreferenceRepository.make({
				exists: (id) =>
					Effect.tryPromise({
						try: async () => {
							const result = await call(
								route,
								`/v1/sessions/${encodeURIComponent(id)}`,
								"GET",
								headers,
							)
							if (result.status === 404) return false
							if (!result.ok) throw new Error("Session access failed")
							await result.body?.cancel()
							return true
						},
						catch: () => ExperienceStorageUnavailable.make({}),
					}),
			})
			if (method === "DELETE") {
				const expected =
					payload === undefined
						? undefined
						: payload === null
							? null
							: yield* Schema.decodeUnknownEffect(PreferencesApi.Preferences)(
									payload,
								)
				return yield* repository.reset(
					{ userId: route.accountId, tenantId: route.accountId },
					expected,
				)
			}
			const service = yield* Preferences.make.pipe(
				Effect.provideService(Repository, repository),
			)
			const action =
				method === "GET"
					? service.getPreferences
					: method === "PRUNE"
						? repository.modifyPreferences({
								owner: { userId: route.accountId, tenantId: route.accountId },
								pruneMissingSessions: true,
								update: (previous) =>
									Effect.succeed(previous ?? Preferences.defaults),
							})
						: method === "PATCH"
							? Schema.decodeUnknownEffect(
									Schema.Struct({ change: PreferencesApi.PreferencesPatch }),
								)(payload).pipe(
									Effect.flatMap((input) =>
										service.patchPreferences(input.change),
									),
								)
							: Schema.decodeUnknownEffect(PreferencesApi.PreferencesUpdate)(
									payload,
								).pipe(Effect.flatMap(service.updatePreferences))
			return yield* action.pipe(
				Effect.provideService(Identity, {
					userId: route.accountId,
					tenantId: route.accountId,
				}),
			)
		})
		const outcome = await db.runPromise(
			program.pipe(
				Effect.match({
					onSuccess: (value) => ({ ok: true, value }) as const,
					onFailure: (error) => ({ ok: false, error }) as const,
				}),
			),
		)
		if (outcome.ok) return outcome.value
		const error = outcome.error
		const status =
			error._tag === "PreferencesConflict"
				? 409
				: error._tag === "ExperienceNotFound"
					? 404
					: error._tag === "ExperienceInputInvalid" ||
						  error._tag === "SchemaError"
						? 400
						: 503
		return fail(
			status,
			error._tag === "SchemaError" ? "ExperienceInputInvalid" : error._tag,
			"message" in error && typeof error.message === "string"
				? error.message
				: "Preferences could not be saved.",
		)
	}
	const completeProductOperation = async (
		route: Route,
		headers: Headers,
		kind: Operation["kind"],
		path: string,
		body: Projection.Json,
		operationRequest: Schema.JsonObject,
	) => {
		if (kind === "fork") {
			const id = Projection.object(Projection.object(body)["session"])["id"]
			if (typeof id !== "string")
				return fail(
					503,
					"SessionStorageUnavailable",
					"The fork result could not be read. Refresh before retrying.",
				)
			await preferences(route, headers, "PATCH", {
				change: {
					_tag: "InheritOrganization",
					sessionId: id,
					sourceSessionId: decodeURIComponent(path.split("/")[3] ?? ""),
				},
			})
		}
		if (kind === "delete") await preferences(route, headers, "PRUNE", undefined)
		if (kind === "reset") {
			const pending = Projection.object(body)["pending"],
				cleared = Array.isArray(pending) && pending.length === 0
			const reset =
				cleared &&
				(await preferences(
					route,
					headers,
					"DELETE",
					operationRequest["expectedPreferences"] ?? null,
				)) === true
			return { ...Projection.object(body), preferencesReset: reset }
		}
		return body
	}
	const handler = async (req: IncomingMessage, res: ServerResponse) => {
		const requestId = randomUUID(),
			method = req.method ?? "GET",
			startedAt = performance.now()
		let streaming = false
		res.once("finish", () => {
			telemetry.increment("requests")
			telemetry.observe("request_ms", performance.now() - startedAt)
			if (res.statusCode === 401) telemetry.increment("authentication_rejected")
			if (res.statusCode === 403) telemetry.increment("permission_denied")
			if (
				res.statusCode >= 400 &&
				/^\/auth\/(login|callback)/.test(req.url ?? "")
			)
				telemetry.increment("login_failed")
			if (res.statusCode >= 400 && (req.url ?? "").includes("/approvals/"))
				telemetry.increment("approval_failed")
		})
		res.once("close", () => {
			if (streaming && !res.writableFinished)
				telemetry.increment("stream_interrupted")
		})
		res.setHeader("x-request-id", requestId)
		const url = new URL(req.url ?? "/", config.publicOrigin),
			path = url.pathname
		if (path === "/health") {
			json(res, 200, { status: "ok" })
			return
		}
		if (
			config.nextEnabled === true &&
			path.startsWith("/api/kay/v1/feedback/")
		) {
			feedbackPublisher ??= makeFeedbackPublisher({
				feedback,
				origin: config.publicOrigin,
			})
			await feedbackPublisher.handle(req, res)
			return
		}
		const documentation =
			path === "/docs" || path.startsWith("/docs/") || path === "/openapi.json"
		const productRequest = path.startsWith("/api/kay/v1/")
		if (
			config.backendRouting === "native" &&
			publicNativeEndpoint({ method, path })
		) {
			await relayNativePublic({
				req,
				res,
				origin: config.openbotOrigin,
				url,
				requestId,
			})
			return
		}
		if (config.backendRouting === "native" && path.startsWith("/v1/")) {
			json(res, 410, {
				code: "legacy_api_unavailable",
				message:
					"This API belongs to the previous workspace. Open Kay to continue.",
				requestId,
			})
			return
		}
		if (productRequest && config.nextEnabled !== true) {
			json(res, 404, {
				code: "not_found",
				message: "This feature is not available.",
				requestId,
			})
			return
		}
		if (
			!path.startsWith("/v1/") &&
			!path.startsWith("/auth/") &&
			!productRequest &&
			!documentation
		) {
			json(res, 404, { message: "Not found" })
			return
		}
		const writing = !["GET", "HEAD", "OPTIONS"].includes(method)
		if (
			writing &&
			req.headers.origin !== config.publicOrigin &&
			req.headers.authorization === undefined
		)
			return fail(403, "ForbiddenOrigin", "This request must come from Kay.")
		const headers = upstreamHeaders(req, config, requestId)
		if (
			path === "/auth/logout" &&
			method === "POST" &&
			config.authBackend === "ledger"
		) {
			const response = await logout({ config, db, headers })
			for (const cookie of response.headers.getSetCookie())
				res.appendHeader("set-cookie", cookie)
			res.writeHead(response.status, { "cache-control": "no-store" })
			res.end()
			return
		}
		const authorityStartedAt = performance.now()
		const identityBackend = await authBackend()
		telemetry.observe(
			"auth_authority_ms",
			performance.now() - authorityStartedAt,
		)
		let route: Route = {
			accountId: "",
			backend: identityBackend,
			epoch: 0,
			phase: "E_ACTIVE",
		}
		let organizationId: string | undefined
		let displayName = ""
		let avatarUrl: string | null = null
		let leased = false
		let logoutAccount: string | undefined
		let callbackDestination: string | undefined
		if (
			path === "/auth/logout" &&
			writing &&
			config.backendRouting === "ledger"
		) {
			// A failed lookup must never prevent the identity service from revoking a session.
			try {
				const current = await fetch(
					new URL("/auth/session?refresh=false", originFor(identityBackend)),
					{ headers, redirect: "manual", signal: AbortSignal.timeout(5000) },
				)
				if (current.ok) {
					const value: unknown = await current.json()
					logoutAccount =
						identityBackend === "openbot"
							? OpenBotIdentity.accountId(value)
							: Schema.decodeUnknownSync(VerifiedSession)(value).identity.userId
				}
			} catch {
				/* Revocation remains the priority. */
			}
		}
		if (
			path === "/auth/apps/callback" ||
			path === "/auth/developer/apps/callback"
		) {
			const flowId = url.searchParams.get("state")
			if (flowId === null || url.searchParams.getAll("state").length !== 1)
				return fail(
					400,
					"ExperienceInputInvalid",
					"The App authorization state is missing.",
				)
			const kind = path === "/auth/apps/callback" ? "app" : "developer"
			let authenticatedAccount: string | undefined
			if (config.nextEnabled === true && headers.has("cookie")) {
				const sessionResponse = await fetch(
					new URL("/auth/session", originFor(identityBackend)),
					{ headers, redirect: "manual", signal: AbortSignal.timeout(5000) },
				)
				if (sessionResponse.ok) {
					for (const cookie of sessionResponse.headers.getSetCookie())
						res.appendHeader("set-cookie", cookie)
					const session = verifiedSession(
						await sessionResponse.json(),
						identityBackend,
					)
					authenticatedAccount = session.identity.userId
					organizationId = session.identity.organizationId
					if (identityBackend === "openbot" && organizationId !== undefined)
						headers.set("openbot-organization", organizationId)
				} else {
					await sessionResponse.body?.cancel()
					if (sessionResponse.status !== 401)
						return fail(
							sessionResponse.status === 403 ? 403 : 503,
							"AuthenticationUnavailable",
							"The callback account could not be verified.",
						)
				}
			}
			const recorded =
				config.nextEnabled === true
					? await makeNativeNavigation(db).lookup({ kind, flowId })
					: null
			const recordedAccount = recorded?.accountId ?? null
			callbackDestination = recorded?.returnTo
			if (
				authenticatedAccount !== undefined &&
				recordedAccount !== null &&
				authenticatedAccount !== recordedAccount
			)
				return fail(
					403,
					"PermissionDenied",
					"This authorization belongs to another account.",
				)
			const accountId = authenticatedAccount ?? recordedAccount
			route =
				accountId === null || accountId === undefined
					? await callbackRoute(flowId, kind)
					: await routeFor(accountId, organizationId)
			// Receiving a callback may exchange credentials even though its HTTP method is GET.
			await authorizeWrite(route, requestId)
			leased = true
		} else if (
			!path.startsWith("/auth/") &&
			path !== "/v1/apps/client-metadata" &&
			!documentation
		) {
			const authenticationStartedAt = performance.now()
			const identity = await fetch(
				new URL("/auth/session", originFor(identityBackend)),
				{ headers, redirect: "manual" },
			)
			for (const cookie of identity.headers.getSetCookie())
				res.appendHeader("set-cookie", cookie)
			if (!identity.ok) {
				if (productRequest) {
					await identity.body?.cancel()
					json(res, identity.status, {
						code:
							identity.status === 401
								? "unauthorized"
								: identity.status === 403
									? "forbidden"
									: "unavailable",
						message:
							identity.status === 403
								? "You do not have access to Kay."
								: "Sign in to use Kay.",
						requestId,
					})
					return
				}
				json(
					res,
					identity.status,
					identity.status === 403
						? {
								_tag: "PermissionDenied",
								message: "Your account no longer has access.",
							}
						: ((await identity.json()) as Projection.Json),
				)
				return
			}
			const session = verifiedSession(await identity.json(), identityBackend)
			avatarUrl = OpenBotIdentity.avatarUrl(session.profile)
			displayName =
				typeof session.profile["name"] === "string"
					? session.profile["name"]
					: ""
			telemetry.observe(
				"auth_session_ms",
				performance.now() - authenticationStartedAt,
			)
			organizationId = session.identity.organizationId
			if (identityBackend === "openbot")
				headers.set("openbot-organization", organizationId!)
			const routeStartedAt = performance.now()
			route = await routeFor(
				session.identity.userId,
				session.identity.organizationId,
			)
			telemetry.observe("route_ms", performance.now() - routeStartedAt)
			if (writing) {
				const admissionStartedAt = performance.now()
				await authorizeWrite(route, requestId)
				telemetry.observe(
					"admission_ms",
					performance.now() - admissionStartedAt,
				)
				leased = true
			}
		}
		try {
			const bodyStartedAt = performance.now()
			const managedComputer = basicComputeManagedPath({
				path,
				method: req.method ?? "GET",
			})
			if (
				managedComputer !== null &&
				(await makeComputeStore(db).isManaged(managedComputer))
			) {
				json(res, 403, {
					_tag: "PermissionDenied",
					message:
						"Manage this personal task workspace through its setup and repair controls.",
				})
				return
			}
			if (
				managedComputer !== null &&
				route !== undefined &&
				organizationId !== undefined &&
				(await makeComputeStore(db).pendingCreation({
					accountId: route.accountId,
					organizationId,
				}))
			) {
				json(res, 409, {
					_tag: "Conflict",
					message:
						"Finish or restore the basic workspace setup before changing computer permissions.",
				})
				return
			}
			let payload =
				writing &&
				!(
					productRequest &&
					req.headers["content-type"]?.startsWith("multipart/form-data") ===
						true
				)
					? await readBody(req)
					: undefined
			if (productRequest) {
				if (
					nativeProduct === undefined ||
					route.backend !== "openbot" ||
					route.phase !== "OPENBOT_ACTIVE" ||
					organizationId === undefined
				) {
					json(res, 503, {
						code: "unavailable",
						message: "The new workspace is not enabled for this account.",
						requestId,
					})
					return
				}
				const abort = new AbortController()
				const closed = () => abort.abort()
				res.once("close", closed)
				try {
					const productHeaders = new Headers(headers)
					if (config.backendRouting === "ledger") {
						productHeaders.set("x-kay-epoch", String(route.epoch))
						productHeaders.set("x-kay-backend", route.backend)
					}
					await handleProductRequest({
						req,
						res,
						url,
						payload,
						client: nativeProduct({
							headers: productHeaders,
							signal: abort.signal,
						}),
						identity: {
							userId: route.accountId,
							organizationId,
							displayName,
							avatarUrl,
						},
						feedback: { service: feedback, origin: config.publicOrigin },
						requestId,
						db,
						telemetry,
						startedAt,
						epoch: route.epoch,
						...(config.basicComputeSocket === undefined ||
						config.basicComputeKeyFile === undefined
							? {}
							: {
									basicCompute: {
										socketPath: config.basicComputeSocket,
										keyFile: config.basicComputeKeyFile,
									},
								}),
						...(config.membershipCodeManagerAccountId === undefined
							? {}
							: {
									membershipCodeManagerAccountId:
										config.membershipCodeManagerAccountId,
								}),
					})
				} finally {
					res.off("close", closed)
					abort.abort()
				}
				return
			}
			let restoreHost: Projection.ObjectValue | undefined
			telemetry.observe("request_body_ms", performance.now() - bodyStartedAt)
			if (
				route.backend === "openbot" &&
				method === "PUT" &&
				/^\/v1\/sessions\/[^/]+\/record$/.test(path)
			) {
				const decoded = Schema.decodeUnknownSync(RestoreSessionRequest)(payload)
				let expected: Projection.Json = null
				if (decoded.expected !== null) {
					const current = await call(route, path.slice(0, -7), "GET", headers)
					if (!current.ok)
						return fail(
							current.status,
							"SessionConflict",
							"The conversation changed. Refresh before restoring it.",
						)
					const raw =
						Projection.object(
							Schema.decodeUnknownSync(Schema.Json)(await current.json()),
						)["session"] ?? null
					if (
						!isDeepStrictEqual(
							Schema.decodeUnknownSync(Session.Ref)(Projection.ref(raw)),
							decoded.expected,
						)
					)
						return fail(
							409,
							"SessionConflict",
							"The conversation changed. Refresh before restoring it.",
						)
					expected = raw
					restoreHost = Projection.object(
						Projection.object(Projection.object(raw)["business"])[
							"@openbot-build/openbot/session-host"
						],
					)
				} else {
					const agents = await call(route, "/v1/agents", "GET", headers)
					if (!agents.ok)
						throw new HttpFailure(
							agents.status,
							sessionError({
								status: agents.status,
								value: {},
								session: decodeURIComponent(path.split("/")[3] ?? ""),
							}),
						)
					const rows = Schema.decodeUnknownSync(
						Schema.Array(Schema.JsonObject),
					)(await agents.json())
					const main = rows.find(
						(row) =>
							row["kind"] === "main" &&
							Projection.object(row["owner"])["userId"] === route.accountId,
					)
					if (
						main === undefined ||
						typeof main["id"] !== "string" ||
						organizationId === undefined
					)
						throw new HttpFailure(503, { _tag: "SessionStorageUnavailable" })
					restoreHost = {
						agent: main["id"],
						kind: "direct",
						chain: {
							organizationId,
							userId: route.accountId,
							agents: [main["id"]],
							sessions: [],
						},
					}
				}
				payload = { ...Projection.object(payload), expected }
			}
			if (
				/^\/v1\/kay\/operations\/[^/]+(?:\/reconcile)?$/.test(path) &&
				["GET", "POST"].includes(method)
			) {
				let operation = await operations.get({
					id: path.split("/")[4] ?? "",
					accountId: route.accountId,
				})
				if (
					method === "POST" &&
					path.endsWith("/reconcile") &&
					operation?.phase === "Applied" &&
					operation.result !== null
				) {
					const status = operation.result["status"]
					if (typeof status === "number" && status >= 200 && status < 300)
						await completeProductOperation(
							route,
							headers,
							operation.kind,
							String(operation.request["path"]),
							operation.result["body"] ?? null,
							operation.request,
						)
					await operations.mark({
						id: operation.id,
						accountId: route.accountId,
						phase: "Completed",
					})
					operation = await operations.get({
						id: operation.id,
						accountId: route.accountId,
					})
				}
				json(
					res,
					operation === null ? 404 : 200,
					operation === null
						? { message: "Operation not found." }
						: Schema.decodeUnknownSync(Schema.Json)(operation),
				)
				return
			}
			const readNative = async (target: string) => {
				const result = await call(route, target, "GET", headers)
				const body = Schema.decodeUnknownSync(Schema.Json)(await result.json())
				if (!result.ok)
					throw new HttpFailure(
						result.status,
						sessionError({
							status: result.status,
							value: body,
							session: decodeURIComponent(path.split("/")[3] ?? ""),
						}),
					)
				return body
			}
			const inspectActivity = async (view: Projection.Json) => {
				try {
					return await Activity.inspect({ view, read: readNative })
				} catch (error) {
					if (error instanceof HttpFailure) throw error
					throw new HttpFailure(503, { _tag: "SessionStorageUnavailable" })
				}
			}
			if (
				route.backend === "openbot" &&
				method === "GET" &&
				/^\/v1\/sessions\/[^/]+(?:\/wait)?$/.test(path)
			) {
				let inspection: Activity.Inspection
				if (path.endsWith("/wait")) {
					const after = Number(url.searchParams.get("after")),
						timeoutMs = Number(url.searchParams.get("timeoutMs") ?? "30000")
					if (
						!url.searchParams.has("after") ||
						!Number.isSafeInteger(after) ||
						after < 0 ||
						!Number.isFinite(timeoutMs) ||
						timeoutMs < 0 ||
						timeoutMs > 30000
					)
						return fail(
							400,
							"SessionInvalidRecord",
							"Send a valid conversation revision and wait timeout.",
						)
					try {
						inspection = await Activity.wait({
							sessionId: decodeURIComponent(path.split("/")[3]!),
							after,
							timeoutMs,
							...(url.searchParams.has("afterActivity")
								? { afterActivity: url.searchParams.get("afterActivity")! }
								: {}),
							read: readNative,
						})
					} catch (error) {
						if (error instanceof HttpFailure) throw error
						throw new HttpFailure(503, { _tag: "SessionStorageUnavailable" })
					}
				} else
					inspection = await inspectActivity(
						await readNative(path + url.search),
					)
				json(res, 200, Projection.sessionView(inspection.view))
				return
			}
			if (route.backend === "openbot") {
				const listing = /^\/v1\/sessions\/([^/]+)\/approvals$/.exec(path)
				const resolving =
					/^\/v1\/sessions\/([^/]+)\/turns\/([^/]+)\/approvals\/([^/]+)$/.exec(
						path,
					)
				if (
					(listing !== null && method === "GET") ||
					(resolving !== null && method === "POST")
				) {
					const sessionPath = "/v1/sessions/" + (listing?.[1] ?? resolving![1])

					const current = await readNative(sessionPath)
					const inspection = await inspectActivity(current)
					if (listing !== null) {
						json(res, 200, [...inspection.approvals])
						return
					}
					const input = (() => {
						try {
							return Approvals.decision(payload)
						} catch {
							return fail(
								400,
								"SessionInvalidRecord",
								"Send a valid approval decision and conversation revision.",
							)
						}
					})()
					const expected = Projection.object(
						Projection.object(current)["session"],
					)["revision"]
					if (input.expected !== expected)
						return fail(
							409,
							"SessionConflict",
							"The conversation changed. Refresh before answering.",
						)
					const requestPath = "/v1/requests/" + resolving![3]
					const native = Approvals.request(await readNative(requestPath))
					const target = inspection.requestTargets.find(
						(target) => target.id === native.id,
					)
					const turns = Projection.object(
						Projection.object(current)["session"],
					)["turns"]
					const parentTurn = Array.isArray(turns)
						? Projection.object(turns.at(-1))["id"]
						: undefined
					if (
						target === undefined ||
						native.session !== target.session ||
						native.turn !== target.turn ||
						parentTurn !== decodeURIComponent(resolving![2]!) ||
						native.status !== "pending"
					)
						return fail(
							409,
							"SessionConflict",
							"This request is no longer waiting in this conversation.",
						)
					const response = await call(route, requestPath, "POST", headers, {
						expected: native.revision,
						expectedSessionRevision: input.expected,
						expectedSessionId: decodeURIComponent(resolving![1]!),
						decision: input.approved ? "allow" : "deny",
						...(input.grantReads === undefined
							? {}
							: { grantReads: input.grantReads }),
						...(input.reason === undefined ? {} : { reason: input.reason }),
					})
					if (!response.ok) {
						json(
							res,
							response.status,
							sessionError({
								status: response.status,
								value: Schema.decodeUnknownSync(Schema.Json)(
									await response.json(),
								),
								session: native.session,
							}),
						)
						return
					}
					await response.body?.cancel()
					const targetPath =
						"/v1/sessions/" + encodeURIComponent(target.session)
					let updated = Projection.sessionView(await readNative(targetPath))
					const deadline = Date.now() + 10000
					// Only wait on committed state. A timeout must never resubmit the decision.
					while (
						Projection.object(updated["session"])["revision"] ===
							target.revision &&
						Date.now() < deadline
					) {
						const query = new URLSearchParams({
							after: String(target.revision),
							afterActivity: String(updated["activity"] ?? "inactive"),
							timeoutMs: "1000",
						})
						updated = Projection.sessionView(
							await readNative(targetPath + "/wait?" + query),
						)
					}
					if (
						Projection.object(updated["session"])["revision"] ===
						target.revision
					)
						throw new HttpFailure(503, {
							_tag: "SessionExecutionUnavailable",
							session: native.session,
						})
					const result = Projection.sessionView(
						(await inspectActivity(await readNative(sessionPath))).view,
					)["response"]
					if (result === null || result === undefined)
						throw new HttpFailure(503, {
							_tag: "SessionExecutionUnavailable",
							session: native.session,
						})
					json(res, 202, result)
					return
				}
			}
			if (route.backend === "openbot" && path === "/v1/preferences") {
				if (!["GET", "PUT", "PATCH"].includes(method))
					return fail(
						405,
						"ExperienceInputInvalid",
						"Use the supported preference operation.",
					)
				json(res, 200, await preferences(route, headers, method, payload))
				return
			}
			const resetExperience =
				route.backend === "openbot" &&
				path === "/v1/experience" &&
				method === "DELETE"
			const original = payload
			if (route.backend === "openbot" && payload !== undefined)
				payload = Projection.request({
					path,
					value: payload,
					...(restoreHost === undefined ? {} : { host: restoreHost }),
				})
			const kind: Operation["kind"] | undefined =
				route.backend !== "openbot"
					? undefined
					: path === "/v1/sessions" && method === "POST"
						? "create"
						: /^\/v1\/sessions\/[^/]+\/fork$/.test(path) && method === "POST"
							? "fork"
							: /^\/v1\/sessions\/[^/]+$/.test(path) && method === "DELETE"
								? "delete"
								: resetExperience ||
									  (path === "/v1/app-experience/reset" && method === "POST")
									? "reset"
									: undefined
			let operationRequest: Schema.JsonObject = {}
			if (kind !== undefined) {
				res.setHeader("x-operation-id", requestId)
				operationRequest = await operations.prepare({
					id: requestId,
					accountId: route.accountId,
					backend: route.backend,
					epoch: route.epoch,
					kind,
					request: { path, method, payload: original ?? null },
				})
				await operations.mark({
					id: requestId,
					accountId: route.accountId,
					phase: "Sending",
				})
			}
			let upstream: Response
			try {
				const upstreamStartedAt = performance.now()
				telemetry.observe("upstream_dispatch_ms", upstreamStartedAt - startedAt)
				upstream = await call(
					route,
					resetExperience
						? "/v1/app-experience/reset"
						: route.backend === "openbot"
							? Projection.requestURL(
									url.pathname +
										(path === "/v1/sessions" && method === "GET"
											? (() => {
													const query = new URLSearchParams(url.search)
													query.set("kind", "direct")
													return "?" + query.toString()
												})()
											: url.search),
								)
							: url.pathname + url.search,
					resetExperience ? "POST" : method,
					headers,
					payload,
				)
				telemetry.observe(
					"upstream_headers_ms",
					performance.now() - upstreamStartedAt,
				)
			} catch (error) {
				if (kind !== undefined)
					await operations.mark({
						id: requestId,
						accountId: route.accountId,
						phase: "OutcomeUnknown",
					})
				if (kind !== undefined) telemetry.increment("operation_outcome_unknown")
				throw error
			}
			if (upstream.ok && logoutAccount !== undefined) {
				try {
					await query(
						(sql) =>
							sql`UPDATE kay_migration_accounts SET phase='E_ACTIVE',epoch=epoch+1,freeze_deadline_at=NULL,last_error='Authentication revoked during migration',validation_result=NULL,updated_at=now() WHERE account_id=${logoutAccount} AND active_backend='e' AND phase<>'E_ACTIVE'`,
					)
				} catch {
					console.error(
						JSON.stringify({
							event: "migration_revocation_abort_failed",
							requestId,
						}),
					)
				}
			}
			for (const cookie of upstream.headers.getSetCookie())
				res.appendHeader("set-cookie", cookie)
			const contentType = upstream.headers.get("content-type") ?? ""
			for (const name of ["location", "retry-after", "cache-control"]) {
				let value = upstream.headers.get(name)
				if (
					name === "location" &&
					value !== null &&
					callbackDestination !== undefined
				) {
					const nativeLocation = new URL(value, config.publicOrigin)
					if (nativeLocation.origin === new URL(config.publicOrigin).origin) {
						const destination = new URL(
							callbackDestination,
							config.publicOrigin,
						)
						for (const [key, value] of nativeLocation.searchParams)
							destination.searchParams.set(key, value)
						value = destination.pathname + destination.search + destination.hash
					}
				}
				if (value !== null) res.setHeader(name, value)
			}
			if (contentType.includes("text/event-stream")) {
				streaming = true
				telemetry.increment("stream_started")
				res.writeHead(upstream.status, {
					"content-type": contentType,
					"cache-control": "no-store",
					"x-accel-buffering": "no",
				})
				res.flushHeaders()
				if (upstream.body !== null)
					await pipeline(
						Readable.from(
							responseChunks(upstream.body, telemetry.stream(startedAt)),
						),
						res,
					)
				else res.end()
				return
			}
			if (upstream.status === 204 || upstream.body === null) {
				if (kind !== undefined) {
					await operations.mark({
						id: requestId,
						accountId: route.accountId,
						phase: "Applied",
						result: { status: upstream.status },
					})
					if (upstream.ok)
						await completeProductOperation(
							route,
							headers,
							kind,
							path,
							null,
							operationRequest,
						)
					await operations.mark({
						id: requestId,
						accountId: route.accountId,
						phase: "Completed",
					})
				}
				res.writeHead(upstream.status)
				res.end()
				return
			}
			// Browser authentication returns raw HTTP responses, including empty JSON errors.
			if (
				path === "/auth/login" ||
				path === "/auth/callback" ||
				(path.startsWith("/auth/") &&
					[301, 302, 303, 307, 308].includes(upstream.status)) ||
				!contentType.includes("application/json")
			) {
				res.writeHead(upstream.status, { "content-type": contentType })
				await pipeline(Readable.from(responseChunks(upstream.body)), res)
				return
			}
			let result = Schema.decodeUnknownSync(Schema.Json)(await upstream.json())
			if (
				route.backend === "openbot" &&
				!upstream.ok &&
				path.startsWith("/v1/sessions") &&
				/^(?:Agent|Request)/.test(String(Projection.object(result)["_tag"]))
			)
				result = sessionError({
					status: upstream.status,
					value: result,
					session: decodeURIComponent(path.split("/")[3] ?? ""),
				})
			if (kind !== undefined)
				await operations.mark({
					id: requestId,
					accountId: route.accountId,
					phase: "Applied",
					result: { status: upstream.status, body: result },
				})
			if (
				upstream.status === 403 &&
				Projection.object(result)["_tag"] !== "ForbiddenOrigin"
			)
				result = {
					_tag: "PermissionDenied",
					message: "Your account does not have permission for this action.",
				}
			if (route.backend === "openbot" && upstream.ok) {
				if (path === "/auth/session")
					result = verifiedSession(result, "openbot")
				if (kind !== undefined)
					result = await completeProductOperation(
						route,
						headers,
						kind,
						path,
						result,
						operationRequest,
					)
				let returnTo = "/"
				if (path.startsWith("/v1/app-authorizations/")) {
					const flowId = path.split("/")[3] ?? ""
					const rows = await query(
						(sql) =>
							sql<{
								return_to: string
							}>`SELECT return_to FROM kay_navigation WHERE account_id=${route.accountId} AND flow_id=${flowId}`,
					)
					returnTo = rows[0]?.return_to ?? "/"
					result = { ...Projection.object(result), returnTo }
				}
				if (/\/authorization$/.test(path) && method === "POST") {
					const flowId = Projection.object(result)["flowId"],
						destination = Projection.object(original)["returnTo"]
					if (typeof flowId === "string" && typeof destination === "string") {
						const validated = Schema.decodeSync(AuthApi.ReturnTo)(destination)
						await query(
							(sql) =>
								sql`INSERT INTO kay_navigation(account_id,flow_id,return_to) VALUES(${route.accountId},${flowId},${validated}) ON CONFLICT(account_id,flow_id) DO UPDATE SET return_to=EXCLUDED.return_to`,
						)
					}
				}
				result = Projection.response({ path, value: result, returnTo })
			}
			if (kind !== undefined)
				await operations.mark({
					id: requestId,
					accountId: route.accountId,
					phase: "Completed",
					result: { status: upstream.status, body: result },
				})
			if (resetExperience && upstream.ok) {
				if (Projection.object(result)["preferencesReset"] !== true)
					return fail(
						503,
						"ExperienceStorageUnavailable",
						"Some Apps are still being disconnected. Try again shortly.",
					)
				res.writeHead(204)
				res.end()
				return
			}
			json(res, upstream.status, result)
		} finally {
			if (leased) await releaseWrite(requestId)
		}
	}
	const server = createServer((req, res) => {
		void handler(req, res).catch((error) => {
			if (res.headersSent) {
				res.destroy()
				return
			}
			if (error instanceof HttpFailure) {
				json(res, error.status, error.body)
				return
			}
			// Deliberately exclude request bodies, cookies and database errors from logs.
			console.error(
				JSON.stringify({
					event: "kay_request_failed",
					requestId: res.getHeader("x-request-id"),
				}),
			)
			json(res, 503, {
				_tag: "ExperienceStorageUnavailable",
				message:
					"The request could not finish. Refresh before retrying a change.",
			})
		})
	})
	attachNativeLiveProxy({
		server,
		publicOrigin: config.publicOrigin,
		telemetry,
		connector: config.backendRouting === "native",
		authorize: async (req, url, requestId, signal) => {
			try {
				if (
					config.backendRouting === "native" &&
					url.pathname === nativeConnectorPath
				) {
					if (
						url.search !== "" ||
						req.headers.authorization?.startsWith("Bearer ") !== true
					)
						throw new LiveProxyFailure(
							401,
							"unauthorized",
							"A computer connector token is required.",
						)
					return {
						target: new URL(nativeConnectorPath, config.openbotOrigin),
						headers: nativePublicHeaders({ req, requestId }),
						release: async () => {},
						revalidate: async () => true,
					}
				}
				if (config.nextEnabled !== true || (await authBackend()) !== "openbot")
					throw new LiveProxyFailure(404, "not_found", "Live is not available.")
				const headers = upstreamHeaders(req, config, requestId)
				const readSession = async (checkSignal: AbortSignal) => {
					const response = await fetch(
						new URL("/auth/session?refresh=false", config.openbotOrigin),
						{ headers, signal: checkSignal, redirect: "manual" },
					)
					if (!response.ok) {
						await response.body?.cancel()
						throw new LiveProxyFailure(
							response.status === 401
								? 401
								: response.status === 403
									? 403
									: 503,
							response.status === 401
								? "unauthorized"
								: response.status === 403
									? "forbidden"
									: "unavailable",
							"Your session could not be verified.",
						)
					}
					return verifiedSession(await response.json(), "openbot")
				}
				const session = await readSession(signal)
				const organizationId = session.identity.organizationId
				if (organizationId === undefined)
					throw new LiveProxyFailure(
						403,
						"forbidden",
						"Your account does not have access to Kay.",
					)
				const route = await routeFor(session.identity.userId, organizationId)
				if (route.backend !== "openbot" || route.phase !== "OPENBOT_ACTIVE")
					throw new LiveProxyFailure(
						503,
						"unavailable",
						"Live is not enabled for this account.",
					)
				const target = new URL(
					url.pathname.replace(/^\/api\/kay/, ""),
					config.openbotOrigin,
				)
				for (const [key, value] of url.searchParams) {
					if (
						![
							"voice",
							"inputFormat",
							"outputFormat",
							"turnDetection",
							"organization",
						].includes(key) ||
						url.searchParams.getAll(key).length !== 1
					)
						throw new LiveProxyFailure(
							400,
							"invalid",
							"The live connection options are invalid.",
						)
					if (key === "organization" && value !== organizationId)
						throw new LiveProxyFailure(
							403,
							"forbidden",
							"The organization does not match your session.",
						)
					if (key !== "organization") target.searchParams.set(key, value)
				}
				target.searchParams.set("organization", organizationId)
				headers.set("openbot-organization", organizationId)
				if (config.backendRouting === "ledger") {
					headers.set("x-kay-epoch", String(route.epoch))
					headers.set("x-kay-backend", route.backend)
				}
				await authorizeWrite(route, requestId)
				return {
					target,
					headers,
					release: () => releaseWrite(requestId),
					revalidate: async (checkSignal) => {
						const current = await readSession(checkSignal)
						if (
							current.identity.userId !== route.accountId ||
							current.identity.organizationId !== organizationId
						)
							return false
						const fresh = await routeFor(route.accountId, organizationId)
						return (
							fresh.backend === route.backend &&
							fresh.epoch === route.epoch &&
							fresh.phase === "OPENBOT_ACTIVE"
						)
					},
				}
			} catch (error) {
				if (error instanceof HttpFailure)
					throw new LiveProxyFailure(
						error.status,
						error.status === 403 ? "forbidden" : "unavailable",
						"Your account could not open Live.",
					)
				throw error
			}
		},
	})
	server.once("close", () => {
		void feedbackPublisher?.dispose()
	})
	return server
}
