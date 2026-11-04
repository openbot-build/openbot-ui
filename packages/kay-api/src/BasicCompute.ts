import { createHash, randomUUID } from "node:crypto"
import { Schema } from "effect"
import * as Product from "@kaicom/kay-contracts"
import type { NativeClient } from "@kaicom/kay-contracts/Native"
import type { DatabaseRuntime } from "./Database.ts"
import { makeMembership } from "./Membership.ts"
import {
	makeComputeStore,
	operationView,
	type ComputeOperation,
} from "./BasicComputeStore.ts"
import { readComputeKey, sealComputeToken } from "./BasicComputeSecrets.ts"
import {
	makeBasicComputeBrokerClient,
	type BasicComputeBrokerClient,
} from "./BasicComputeBrokerClient.ts"

export class BasicComputeFailure extends Schema.TaggedError<BasicComputeFailure>()(
	"BasicComputeFailure",
	{
		status: Schema.Natural,
		code: Product.ErrorCode,
		message: Schema.String,
	},
) {}
export interface BasicComputeConfiguration {
	readonly socketPath: string
	readonly keyFile: string
}
export const basicComputeLimits: Product.BasicCompute["limits"] = {
	cpu: 0.5,
	memoryMiB: 512,
	workspaceMiB: 64,
	commandSeconds: 120,
	outputKiB: 64,
	network: true,
	tty: false,
	desktop: false,
	ports: false,
}
const object = Schema.decodeUnknownSync(Schema.JsonObject)
const objects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))
const text = Schema.decodeUnknownSync(Product.Id)
const failure = (
	status: number,
	code: typeof Product.ErrorCode.Type,
	message: string,
) => BasicComputeFailure.make({ status, code, message })

/** Provisioning uses the caller's native credentials; no service administrator acts as a member. */
export const makeBasicCompute = (input: {
	readonly db: DatabaseRuntime
	readonly identity: typeof Product.Identity.Type
	readonly client: NativeClient
	readonly config?: BasicComputeConfiguration
	readonly broker?: BasicComputeBrokerClient
}) => {
	const owner = {
		accountId: input.identity.userId,
		organizationId: input.identity.organizationId,
	}
	const store = makeComputeStore(input.db)
	const membership = makeMembership({ db: input.db })
	const broker =
		input.broker ??
		(input.config === undefined
			? undefined
			: makeBasicComputeBrokerClient(input.config.socketPath))
	const feature = (
		id: string,
		payload: { readonly params?: object; readonly payload?: object } = {},
	) => input.client.request({ operation: "feature", id, payload })
	const value = async (response: Response): Promise<unknown> => {
		if (!response.ok) {
			await response.body?.cancel()
			throw failure(
				response.status === 401 || response.status === 403
					? response.status
					: 503,
				response.status === 401
					? "unauthorized"
					: response.status === 403
						? "forbidden"
						: "basic_compute_unavailable",
				"The workspace could not confirm this computer operation.",
			)
		}
		if (response.status === 204 || response.status === 205) return null
		const data = await response.text()
		return data.length === 0 ? null : JSON.parse(data)
	}
	const ownComputer = async (computerId: string) => {
		const computer = object(
			await value(
				await feature("computers.getComputer", { params: { computerId } }),
			),
		)
		const nativeOwner = object(computer["owner"])
		if (
			computer["id"] !== computerId ||
			nativeOwner["_tag"] !== "Member" ||
			nativeOwner["userId"] !== owner.accountId ||
			object(computer["source"])["_tag"] !== "Connector"
		)
			throw failure(
				403,
				"forbidden",
				"This computer does not belong to the current member.",
			)
		return computer
	}
	const defaultBot = async () => {
		const settings = object(
			await value(await input.client.request({ operation: "memberSettings" })),
		)
		if (settings["defaultBot"] === null || settings["defaultBot"] === undefined)
			throw failure(
				409,
				"conflict",
				"Open Kay Bot before setting up a basic task workspace.",
			)
		const botId = text(settings["defaultBot"])
		const bots = objects(
			await value(await input.client.request({ operation: "bots" })),
		)
		const bot = bots.find((entry) => entry["id"] === botId)
		if (
			bot === undefined ||
			bot["archived"] === true ||
			object(bot["owner"])["_tag"] !== "Member" ||
			object(bot["owner"])["userId"] !== owner.accountId
		)
			throw failure(
				403,
				"forbidden",
				"A personal Kay Bot is required for this workspace.",
			)
		return botId
	}
	const receipt = async (operation: ComputeOperation) => {
		if (operation.execution_id !== null) return operation
		const response = await input.client.request({
			operation: "commandReceipt",
			id: operation.command_key,
		})
		const found = await value(response)
		if (found === null) return operation
		return store.updateOperation({
			operation,
			executionId: text(object(found)["executionId"]),
		})
	}
	const reconcile = async (
		operation: ComputeOperation,
	): Promise<ComputeOperation> => {
		if (operation.phase === "creating") {
			operation = await receipt(operation)
			if (operation.phase !== "creating") return operation
			if (operation.execution_id !== null) {
				const execution = object(
					await value(
						await input.client.request({
							operation: "execution",
							id: operation.execution_id,
						}),
					),
				)
				if (execution["status"] === "completed") {
					const resource = object(execution["resource"])
					const computerId = text(resource["id"])
					await ownComputer(computerId)
					operation = await store.updateOperation({
						operation,
						computerId,
						phase: "granting",
						message: "Continue setup to connect your personal workspace.",
					})
				} else if (
					["failed", "cancelled", "rejected"].includes(
						String(execution["status"]),
					)
				)
					operation = await store.updateOperation({
						operation,
						phase: "failed",
						message:
							"The computer could not be created. Review the current state before trying again.",
					})
			}
		}
		return operation
	}
	const getOperation = async (
		requestId: string,
	): Promise<Product.BasicComputeOperation | null> => {
		let operation = await store.operation({ ...owner, requestId })
		if (operation === null) return null
		operation = await reconcile(operation)
		if (operation.phase === "issuing_token") {
			const account = await store.account(owner)
			if (account !== null && account.generation > operation.generation) {
				operation = await store.updateOperation({
					operation,
					phase: "failed",
					message:
						"This setup was replaced by a newer connection. Read the current workspace state.",
				})
			}
			if (
				account?.generation === operation.generation &&
				account.token_ciphertext !== null
			)
				operation = await store.updateOperation({
					operation,
					phase: "ready",
					message: null,
				})
		}
		return operationView(operation)
	}
	const get = async (): Promise<Product.BasicCompute> => {
		const member = await membership.get(owner.accountId)
		const account = await store.account(owner)
		const lease = await store.lease()
		const operation =
			account?.last_request_id == null
				? null
				: await getOperation(account.last_request_id)
		const connected =
			account?.state === "ready" &&
			account.connected_at !== null &&
			account.connected_at > Date.now() - 60000
		const setupPending =
			operation !== null &&
			operation.action !== "release" &&
			["pending", "creating", "granting", "issuing_token"].includes(
				operation.phase,
			)
		return {
			enabled: input.config !== undefined,
			automatic: true,
			idleSeconds: 300,
			entitled: member.container.allowed,
			reason: member.container.reason,
			computerId: account?.computer_id ?? null,
			state:
				input.config === undefined
					? "disabled"
					: account === null || (account.computer_id === null && !setupPending)
						? "not_provisioned"
						: account.state === "needs_repair"
							? "needs_repair"
							: connected
								? "ready"
								: account.token_ciphertext !== null
									? "connecting"
									: "provisioning",
			lease:
				lease === null
					? { state: "idle", activity: "idle", expiresAt: null }
					: {
							state:
								lease.account_id === owner.accountId &&
								lease.organization_id === owner.organizationId
									? "active"
									: "busy",
							activity:
								lease.account_id === owner.accountId &&
								lease.organization_id === owner.organizationId
									? lease.activity
									: "unknown",
							expiresAt:
								lease.account_id === owner.accountId &&
								lease.organization_id === owner.organizationId &&
								lease.activity === "idle"
									? lease.expires_at
									: null,
						},
			operation,
			limits: basicComputeLimits,
		}
	}
	const runLocked = async (
		action: Product.BasicComputeOperation["action"],
		command: Product.BasicComputeCommand,
	): Promise<Product.BasicComputeOperation> => {
		if (input.config === undefined || broker === undefined)
			throw failure(
				503,
				"basic_compute_unavailable",
				"Basic task workspaces are not enabled.",
			)
		if (action !== "release")
			await membership.requireContainerEntitlement(owner.accountId)
		try {
			await broker.health()
		} catch {
			throw failure(
				503,
				"basic_compute_unavailable",
				"The basic task service is unavailable. Try again later.",
			)
		}
		const botId = action === "release" ? null : await defaultBot()
		const claimed = await store.claim({
			...owner,
			requestId: command.requestId,
			action,
			commandKey: createHash("sha256")
				.update(
					JSON.stringify([
						"basic-compute",
						owner.organizationId,
						owner.accountId,
						command.requestId,
					]),
				)
				.digest("hex"),
		})
		let operation = claimed.operation
		if (
			operation.request_id !== command.requestId ||
			operation.action !== action
		)
			throw failure(
				409,
				"conflict",
				"Continue the existing workspace setup before starting another one.",
			)
		if (
			operation.phase === "ready" ||
			operation.phase === "failed" ||
			operation.phase === "needs_repair"
		)
			return operationView(operation)
		const lockId = randomUUID()
		if (
			!(await store.acquireOperation({
				...owner,
				requestId: command.requestId,
				lockId,
				repair: action === "repair",
			}))
		)
			throw failure(
				409,
				"basic_compute_busy",
				"This setup is already in progress. Its saved state will update shortly.",
			)
		let releaseLock = true
		const update = (
			change: Omit<Parameters<typeof store.updateOperation>[0], "lockId">,
		) => store.updateOperation({ ...change, lockId })
		const checkLock = async () => {
			if (!(await store.holdsOperation({ ...owner, lockId })))
				throw failure(
					409,
					"conflict",
					"This setup has been continued by another request. Read its current state.",
				)
		}
		try {
			operation = (await store.operation({
				...owner,
				requestId: command.requestId,
			}))!
			if (
				operation.phase === "ready" ||
				operation.phase === "failed" ||
				operation.phase === "needs_repair"
			)
				return operationView(operation)
			if (action === "release") {
				await checkLock()
				await broker.release({
					...owner,
					maxGeneration: (await store.account(owner))?.generation ?? 0,
				})
				return operationView(
					await update({
						operation,
						phase: "ready",
						message: null,
					}),
				)
			}
			const key = await readComputeKey(input.config.keyFile)
			let account = await store.account(owner)
			if (action === "repair") {
				// A lost token response is not cancellable. Delete its Computer before making a new one.
				// Late writes remain confined to that retired ID and cannot rotate the replacement token.
				if (operation.retired_computer_id === null) {
					if (account?.computer_id == null)
						throw failure(
							409,
							"conflict",
							"Set up a workspace before repairing its connection.",
						)
					await ownComputer(account.computer_id)
					operation = await store.replacement({
						operation,
						computerId: account.computer_id,
					})
				}
				const retiredId = operation.retired_computer_id!
				await checkLock()
				await broker.release({
					...owner,
					maxGeneration: account?.generation ?? 0,
				})
				const deleteKey = createHash("sha256")
					.update(operation.command_key + ":retire")
					.digest("hex")
				if (operation.retired_execution_id === null) {
					const saved = await value(
						await input.client.request({
							operation: "commandReceipt",
							id: deleteKey,
						}),
					)
					try {
						await checkLock()
						const accepted =
							saved === null
								? await value(
										await feature("computers.deleteComputer", {
											params: { computerId: retiredId },
											payload: { commandKey: deleteKey },
										}),
									)
								: saved
						operation = await store.retirementReceipt({
							operation,
							executionId: text(object(accepted)["executionId"]),
						})
					} catch {
						return operationView(operation)
					}
				}
				let deleted = false
				for (let attempt = 0; attempt < 15; attempt++) {
					const execution = object(
						await value(
							await input.client.request({
								operation: "execution",
								id: operation.retired_execution_id!,
							}),
						),
					)
					if (execution["status"] === "completed") {
						const response = await feature("computers.getComputer", {
							params: { computerId: retiredId },
						})
						deleted = response.status === 404
						await response.body?.cancel()
						break
					}
					if (
						["failed", "cancelled", "rejected"].includes(
							String(execution["status"]),
						)
					)
						break
					await new Promise((resolve) => setTimeout(resolve, 200))
				}
				if (!deleted)
					return operationView(
						await update({
							operation,
							message:
								"The previous connection is still being retired. Continue setup after its status is confirmed.",
						}),
					)
				await store.detachRetired({ ...owner, computerId: retiredId, lockId })
				account = await store.account(owner)
			}
			if (account?.computer_id !== null && account?.computer_id !== undefined) {
				await ownComputer(account.computer_id)
				operation = await update({
					operation,
					computerId: account.computer_id,
				})
				if (action === "provision" && account.state === "needs_repair")
					return operationView(
						await update({
							operation,
							phase: "needs_repair",
							message:
								"The connector credential could not be confirmed. Repair the connection explicitly.",
						}),
					)
			}
			if (operation.computer_id === null) {
				operation = await reconcile(operation)
				if (operation.computer_id === null) {
					if (operation.execution_id === null && !operation.create_sent) {
						const sending = await store.claimSend({
							operation,
							lockId,
							kind: "create",
							message: "The computer creation is being confirmed.",
						})
						if (sending === null)
							return (await getOperation(command.requestId))!
						operation = sending
						try {
							const created = object(
								await value(
									await feature("computers.createComputer", {
										payload: {
											name: "Basic task workspace",
											source: { _tag: "Connector" },
											shared: false,
											commandKey: operation.command_key,
										},
									}),
								),
							)
							operation = await update({
								operation,
								executionId: text(created["executionId"]),
							})
						} catch (error) {
							if (
								error instanceof BasicComputeFailure &&
								(error.status === 401 || error.status === 403)
							)
								operation = await update({
									operation,
									phase: "failed",
									message:
										"This account does not have permission to create a workspace.",
								})
							return operationView(operation)
						}
					}
					for (
						let attempt = 0;
						attempt < 15 &&
						operation.computer_id === null &&
						operation.phase === "creating";
						attempt++
					) {
						operation = await reconcile(operation)
						if (
							operation.computer_id === null &&
							operation.phase === "creating"
						)
							await new Promise((resolve) => setTimeout(resolve, 200))
					}
					if (operation.computer_id === null) return operationView(operation)
				}
			}
			const computerId = operation.computer_id
			await ownComputer(computerId)
			account = await store.attachComputer({
				...owner,
				computerId,
				botId: botId!,
				lockId,
			})
			if (account === null)
				throw failure(
					409,
					"conflict",
					"This member already has another basic task computer.",
				)
			await membership.requireContainerEntitlement(owner.accountId)
			const grants = objects(
				await value(
					await feature("computers.listComputerBots", {
						params: { computerId },
					}),
				),
			)
			if (!grants.some((grant) => grant["bot"] === botId)) {
				if (operation.grant_sent) return operationView(operation)
				const sending = await store.claimSend({
					operation,
					lockId,
					kind: "grant",
					message: "The personal assistant's access is being confirmed.",
				})
				if (sending === null) return (await getOperation(command.requestId))!
				operation = sending
				try {
					const response = await feature("computers.grantComputer", {
						params: { computerId, botId },
					})
					if ([400, 401, 403, 404, 422].includes(response.status)) {
						await response.body?.cancel()
						return operationView(
							await update({
								operation,
								phase: "failed",
								message:
									"This account could not grant its assistant access to the workspace.",
							}),
						)
					}
					await value(response)
				} catch {
					return operationView(operation)
				}
				const confirmed = objects(
					await value(
						await feature("computers.listComputerBots", {
							params: { computerId },
						}),
					),
				)
				if (!confirmed.some((grant) => grant["bot"] === botId))
					return operationView(operation)
			}
			if (action === "provision" && account.token_ciphertext !== null) {
				await broker.wake()
				return operationView(
					await update({
						operation,
						phase: "ready",
						message: null,
					}),
				)
			}
			if (operation.token_sent)
				return operationView(
					await update({
						operation,
						phase: "needs_repair",
						message:
							"The connector credential could not be confirmed. Repair the connection explicitly.",
					}),
				)
			await broker.release({ ...owner, maxGeneration: account.generation })
			const tokenStep = await store.beginToken({
				...owner,
				computerId,
				lockId,
				requestId: command.requestId,
			})
			if (tokenStep === null)
				throw failure(
					409,
					"conflict",
					"This setup has been continued by another request. Read its current state.",
				)
			account = tokenStep.account
			operation = tokenStep.operation
			let tokenRequestFinished = false
			try {
				const response = await feature("computers.setConnectorToken", {
					params: { computerId },
				})
				tokenRequestFinished = true
				const issued = object(await value(response))
				const ciphertext = sealComputeToken({
					key,
					binding: { ...owner, computerId, generation: account.generation },
					token: text(issued["token"]),
				})
				if (
					!(await store.saveToken({
						...owner,
						generation: account.generation,
						ciphertext,
					}))
				)
					throw new Error("The connection changed.")
				operation = await update({
					operation,
					phase: "ready",
					message: null,
				})
			} catch {
				releaseLock = tokenRequestFinished
				operation = await update({
					operation,
					phase: "needs_repair",
					message:
						"The connector credential could not be confirmed. Repair the connection explicitly.",
				})
			}
			if (operation.phase === "ready") {
				try {
					await broker.wake()
				} catch {
					/* The saved token remains available to the private broker's next scan. */
				}
			}
			return operationView(operation)
		} finally {
			if (releaseLock)
				await store.releaseOperation({
					...owner,
					requestId: command.requestId,
					lockId,
				})
		}
	}
	const run = async (
		action: Product.BasicComputeOperation["action"],
		command: Product.BasicComputeCommand,
	): Promise<Product.BasicComputeOperation> => {
		const result = await store.withOperationLock(
			{ ...owner, requestId: command.requestId },
			() => runLocked(action, command),
		)
		if (!result.acquired)
			throw failure(
				409,
				"basic_compute_busy",
				"This setup is already in progress. Its saved state will update shortly.",
			)
		return result.value
	}
	/** Register the personal Computer before a message starts; the broker still creates its container on first use. */
	const prepare = async (botId: string): Promise<"not_required" | "ready"> => {
		if (input.config === undefined || broker === undefined)
			return "not_required"
		if (!(await membership.get(owner.accountId)).container.allowed)
			return "not_required"
		if (botId !== (await defaultBot())) return "not_required"
		const deadline = Date.now() + 10_000
		let wakeSent = false
		for (;;) {
			const account = await store.account(owner)
			const previous =
				account?.last_request_id == null
					? null
					: await store.operation({
							...owner,
							requestId: account.last_request_id,
						})
			const tokenPending = previous?.phase === "issuing_token"
			if (account?.state === "needs_repair" && !tokenPending)
				throw failure(
					409,
					"basic_compute_unavailable",
					"The task workspace connection needs repair.",
				)
			if (account?.bot_id === botId && account.token_ciphertext !== null) {
				if (
					account.state === "ready" &&
					account.connected_at !== null &&
					account.connected_at > Date.now() - 60_000
				) {
					await broker.wake(owner)
					return "ready"
				}
				if (!wakeSent) {
					try {
						await broker.wake(owner)
						wakeSent = true
					} catch {
						throw failure(
							409,
							"basic_compute_unavailable",
							"The task workspace could not connect.",
						)
					}
				}
			} else if (!tokenPending) {
				const pending =
					previous !== null &&
					previous.action !== "release" &&
					!["ready", "failed", "needs_repair"].includes(previous.phase)
				const requestId = pending
					? previous.request_id
					: createHash("sha256")
							.update(
								JSON.stringify([
									"automatic-basic-compute",
									owner.organizationId,
									owner.accountId,
									botId,
									account?.generation ?? 0,
								]),
							)
							.digest("hex")
				try {
					const operation = await run(pending ? previous.action : "provision", {
						requestId,
					})
					if (
						operation.phase === "failed" ||
						operation.phase === "needs_repair"
					)
						throw failure(
							409,
							"basic_compute_unavailable",
							"The task workspace could not be prepared.",
						)
				} catch (error) {
					if (
						!(error instanceof BasicComputeFailure) ||
						!["basic_compute_busy", "conflict"].includes(error.code)
					)
						throw error
				}
			}
			if (Date.now() >= deadline)
				throw failure(
					409,
					"basic_compute_busy",
					"The task workspace is still being prepared.",
				)
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}
	const prepareForMessage = async (
		botId: string,
	): Promise<"not_required" | "ready" | "unavailable"> => {
		try {
			return await prepare(botId)
		} catch (error) {
			if (error instanceof BasicComputeFailure && error.status === 401)
				throw error
			// Workspace availability must not prevent an ordinary message. The core
			// retains the actual Computer state and checks chat permissions separately.
			return "unavailable"
		}
	}
	return { get, getOperation, run, prepareForMessage }
}
