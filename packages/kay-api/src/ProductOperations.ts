import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { Schema } from "effect"
import * as Product from "@kaicom/kay-contracts"
import type { NativeCall, NativeClient } from "@kaicom/kay-contracts/Native"
import type { DatabaseRuntime } from "./Database.ts"
import { BusinessFailure, makeBusiness } from "./ProductBusiness.ts"
import { makeOperations, type SavedOperation } from "./Operations.ts"

const savedResult = Schema.Struct({
	status: Schema.Natural,
	body: Schema.JsonObject,
})
const target = Schema.Struct({ chat: Schema.Struct({ id: Product.Id }) })
export class ProductOutcomeUnknown extends Error {}

/** Complete Kay bookkeeping from a recorded core response; never repeat a core write. */
export const makeProductOperations = (input: {
	readonly db: DatabaseRuntime
	readonly identity: typeof Product.Identity.Type
	readonly client: NativeClient
	readonly epoch: number
}) => {
	const operations = makeOperations(input.db)
	const business = makeBusiness(input)
	const key = (requestId: string) =>
		"product:" +
		createHash("sha256")
			.update(
				JSON.stringify([
					input.identity.userId,
					input.identity.organizationId,
					requestId,
				]),
			)
			.digest("hex")
	const owner = (id: string) => ({ id, accountId: input.identity.userId })
	const complete = async (operation: SavedOperation) => {
		const result = Schema.decodeUnknownSync(savedResult)(operation.result)
		if (operation.phase === "Applied") {
			if (operation.kind === "fork") {
				const source = Schema.decodeUnknownSync(Product.Id)(
					operation.request["sourceChatId"],
				)
				const chatId = Schema.decodeUnknownSync(target)(result.body).chat.id
				await business.completeFork(operation.id, source, chatId)
			} else
				await operations.mark({ ...owner(operation.id), phase: "Completed" })
		}
		return Response.json(result.body, { status: result.status })
	}
	return {
		get: async (requestId: string) => {
			const operation = await operations.get(owner(key(requestId)))
			if (operation === null)
				throw BusinessFailure.make({
					status: 404,
					message: "Operation not found.",
				})
			const result =
				operation.result === null
					? null
					: Schema.decodeUnknownSync(savedResult)(operation.result)
			return {
				requestId,
				phase: operation.phase,
				chatId:
					result !== null && result.status < 300
						? Schema.decodeUnknownSync(target)(result.body).chat.id
						: null,
			}
		},
		reconcile: async (requestId: string) => {
			const operation = await operations.get(owner(key(requestId)))
			if (operation === null)
				throw BusinessFailure.make({
					status: 404,
					message: "Operation not found.",
				})
			if (operation.phase !== "Applied" && operation.phase !== "Completed")
				throw new ProductOutcomeUnknown()
			return complete(operation)
		},
		run: async (call: NativeCall) => {
			if (call.operation !== "create" && call.operation !== "fork")
				return input.client.request(call)
			const payload = Schema.decodeUnknownSync(Schema.JsonObject)(call.payload)
			const requestId = Schema.decodeUnknownSync(Product.RequestId)(
				payload["requestId"],
			)
			const operationId = key(requestId)
			const request = {
				organizationId: input.identity.organizationId,
				payload,
				...(call.id === undefined ? {} : { sourceChatId: call.id }),
			}
			const claimed = await operations.claim({
				...owner(operationId),
				backend: "openbot",
				epoch: input.epoch,
				kind: call.operation,
				request,
			})
			if (!claimed) {
				const previous = await operations.get(owner(operationId))
				if (
					previous === null ||
					previous.kind !== call.operation ||
					!isDeepStrictEqual(previous.request, request)
				)
					throw BusinessFailure.make({
						status: 409,
						message: "This operation ID belongs to a different request.",
					})
				if (previous.phase === "Applied" || previous.phase === "Completed")
					return complete(previous)
				throw new ProductOutcomeUnknown()
			}
			await operations.mark({ ...owner(operationId), phase: "Sending" })
			let response: Response
			let result: typeof savedResult.Type
			try {
				response = await input.client.request(call)
				if (response.status >= 500) throw new ProductOutcomeUnknown()
				const body = Schema.decodeUnknownSync(Schema.JsonObject)(
					await response.json(),
				)
				if (response.ok) Schema.decodeUnknownSync(target)(body)
				result = { status: response.status, body }
				await operations.mark({
					...owner(operationId),
					phase: response.ok ? "Applied" : "Completed",
					result,
				})
			} catch {
				await operations.mark({
					...owner(operationId),
					phase: "OutcomeUnknown",
				})
				throw new ProductOutcomeUnknown()
			}
			if (!response.ok)
				return Response.json(result.body, { status: result.status })
			const operation = await operations.get(owner(operationId))
			if (operation === null) throw new ProductOutcomeUnknown()
			try {
				return await complete(operation)
			} catch {
				// Keep Applied. A later reconciliation only repeats the Kay metadata step.
				throw new ProductOutcomeUnknown()
			}
		},
	}
}
