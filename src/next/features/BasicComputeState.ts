import { Schema } from "effect"
import * as Product from "@kaicom/kay-contracts"

export const PendingBasicCompute = Schema.Struct({
	requestId: Product.RequestId,
	action: Schema.Literals(["provision", "repair", "release"]),
})
export type PendingBasicCompute = typeof PendingBasicCompute.Type

export const basicComputeKey = (identity: Product.Bootstrap["identity"]) =>
	"kay:basic-compute:" +
	JSON.stringify([identity.organizationId, identity.userId])

export const readBasicComputeRequest = ({
	storage,
	key,
}: {
	readonly storage: Pick<Storage, "getItem">
	readonly key: string
}): PendingBasicCompute | null => {
	const saved = storage.getItem(key)
	if (saved === null) return null
	return Schema.decodeUnknownSync(PendingBasicCompute)(JSON.parse(saved), {
		onExcessProperty: "error",
	})
}

export const basicComputeSettled = (operation: Product.BasicComputeOperation) =>
	["ready", "needs_repair", "failed"].includes(operation.phase)

export const canOpenBasicCompute = (value: Product.BasicCompute | null) =>
	value !== null &&
	value.enabled &&
	value.entitled &&
	value.state === "ready" &&
	value.computerId !== null &&
	value.lease.state !== "busy"

export const canPrepareBasicCompute = (value: Product.BasicCompute | null) =>
	value !== null &&
	value.enabled &&
	value.entitled &&
	value.automatic !== true &&
	value.lease.state !== "busy" &&
	(value.state === "not_provisioned" ||
		(value.state === "provisioning" && value.operation?.phase === "failed"))

export const basicComputeIdleDeadline = (value: Product.BasicCompute | null) =>
	value?.lease.state === "active" && value.lease.activity === "idle"
		? value.lease.expiresAt
		: null
