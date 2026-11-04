import { Schema } from "effect"
import { RequestFailed } from "@kaicom/kay-contracts/Client"
import { RequestId, MembershipPlanId } from "@kaicom/kay-contracts"

const PendingMembershipChange = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("redeem"), requestId: RequestId }),
	Schema.Struct({
		kind: Schema.Literal("create"),
		requestId: RequestId,
		planId: MembershipPlanId,
		months: Schema.Number.check(
			Schema.isInt(),
			Schema.isBetween({ minimum: 1, maximum: 12 }),
		),
	}),
])
export type PendingMembershipChange = typeof PendingMembershipChange.Type

export const membershipRequestKey = ({
	userId,
	organizationId,
	kind,
}: {
	readonly userId: string
	readonly organizationId: string
	readonly kind: PendingMembershipChange["kind"]
}): string =>
	`kay:membership:${encodeURIComponent(userId)}:${encodeURIComponent(organizationId)}:${kind}`

/** Only receipt identity and non-secret creation choices are retained. Redemption codes stay in memory. */
export const readMembershipRequest = ({
	storage,
	key,
}: {
	readonly storage: Pick<Storage, "getItem">
	readonly key: string
}): PendingMembershipChange | null => {
	try {
		const saved = storage.getItem(key)
		return saved === null
			? null
			: Schema.decodeUnknownSync(PendingMembershipChange)(JSON.parse(saved), {
					onExcessProperty: "error",
				})
	} catch {
		return null
	}
}

export const saveMembershipRequest = ({
	storage,
	key,
	value,
}: {
	readonly storage: Pick<Storage, "setItem" | "removeItem">
	readonly key: string
	readonly value: PendingMembershipChange | null
}): void => {
	if (value === null) storage.removeItem(key)
	else storage.setItem(key, JSON.stringify(value))
}

/** Only a definite refusal permits a new write without looking up the existing receipt. */
export const membershipWriteRejected = (error: unknown): boolean =>
	error instanceof RequestFailed &&
	error.status >= 400 &&
	error.status < 500 &&
	error.problem.code !== "outcome_unknown"
