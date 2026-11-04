import { createHash } from "node:crypto"
import { Schema } from "effect"
import type * as Product from "@kaicom/kay-contracts"
import type { NativeClient } from "@kaicom/kay-contracts/Native"
import type { DatabaseRuntime } from "./Database.ts"
import { makeOperations, type Operation } from "./Operations.ts"
import type { Feedback } from "./Feedback.ts"
import { feedbackMcpPath, feedbackRule } from "./FeedbackMcp.ts"

const object = Schema.decodeUnknownSync(Schema.JsonObject)
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))
/** Each non-idempotent setup step owns one ledger claim and reconciles by reading. */
export const prepareFeedback = async (input: {
	readonly feedback: Feedback
	readonly db: DatabaseRuntime
	readonly client: NativeClient
	readonly identity: typeof Product.Identity.Type
	readonly epoch: number
	readonly origin: string
	readonly botId: string
}): Promise<boolean> => {
	const bots = await input.client.request({ operation: "bots" })
	if (!bots.ok) {
		await bots.body?.cancel()
		return false
	}
	const bot = rows(await bots.json()).find((row) => row["id"] === input.botId)
	const owner = bot?.["owner"]
	if (
		!Schema.is(Schema.JsonObject)(owner) ||
		owner["_tag"] !== "Member" ||
		owner["userId"] !== input.identity.userId
	)
		return false
	const connection = await input.feedback.connection({
		accountId: input.identity.userId,
		organizationId: input.identity.organizationId,
		botId: input.botId,
	})
	const invoke = (id: string, payload: Schema.JsonObject) =>
		input.client.request({ operation: "feature", id, payload })
	const record = await invoke("connections.getConnection", {
		params: { connectionId: connection.connectionId },
	})
	if (record.status === 404) {
		await record.body?.cancel()
		// The native API returns an existing owner-scoped connection for this exact supplied ID.
		const created = await invoke("connections.createManualConnection", {
			payload: {
				id: connection.connectionId,
				name: "Kay platform feedback",
				url: input.origin + feedbackMcpPath,
				transport: "streamable-http",
				headers: {
					Authorization: "Bearer " + input.feedback.credential(connection),
				},
			},
		})
		if (!created.ok) {
			await created.body?.cancel()
			return false
		}
		await created.body?.cancel()
	} else if (!record.ok) {
		await record.body?.cancel()
		return false
	} else await record.body?.cancel()
	const operations = makeOperations(input.db)
	const step = async (
		name: string,
		listId: string,
		createId: string,
		payload: Schema.JsonObject,
		found: (row: Schema.JsonObject) => boolean,
	) => {
		const listed = await invoke(listId, { params: { botId: input.botId } })
		if (!listed.ok) {
			await listed.body?.cancel()
			return false
		}
		if (rows(await listed.json()).some(found)) return true
		const key = createHash("sha256")
			.update(
				JSON.stringify([
					input.identity.organizationId,
					input.identity.userId,
					input.botId,
					connection.connectionId,
					name,
				]),
			)
			.digest("hex")
		const attempt: Operation = {
			id: "feedback-setup:" + key,
			accountId: input.identity.userId,
			backend: "openbot",
			epoch: input.epoch,
			kind: "feedback-setup",
			request: {
				botId: input.botId,
				connectionId: connection.connectionId,
				step: name,
			},
		}
		if (!(await operations.claim(attempt))) return false
		await operations.mark({ ...attempt, phase: "Sending" })
		try {
			const response = await invoke(createId, {
				params: { botId: input.botId },
				payload,
			})
			if (!response.ok) {
				await response.body?.cancel()
				await operations.releaseRejected({
					...attempt,
					status: response.status,
				})
				return false
			}
			const result = object(await response.json())
			await operations.mark({ ...attempt, phase: "Completed", result })
			return found(result)
		} catch {
			await operations.mark({ ...attempt, phase: "OutcomeUnknown" })
			return false
		}
	}
	const target = connection.connectionId + "/Feedback2Platform"
	const grant = await step(
		"grant",
		"bots.listGrants",
		"bots.createGrant",
		{
			capability: { action: "apps.call", target },
			effect: "allow",
			scope: "lifetime",
			reason:
				"Allow this assistant to report platform problems without sharing private logs.",
		},
		(row) => {
			const cap = row["capability"]
			return (
				row["status"] === "active" &&
				row["effect"] === "allow" &&
				row["scope"] === "lifetime" &&
				Schema.is(Schema.JsonObject)(cap) &&
				cap["action"] === "apps.call" &&
				cap["target"] === target
			)
		},
	)
	if (!grant) return false
	return step(
		"rule",
		"bots.listRules",
		"bots.createRule",
		{ text: feedbackRule },
		(row) => row["text"] === feedbackRule && row["status"] === "active",
	)
}
