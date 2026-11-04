import type * as Product from "@kaicom/kay-contracts"

/** Mythic is the free account label, not a purchasable plan or an entitlement. */
// @effect-diagnostics-next-line missingPipeableSignature:off
export const accountPlanName = (
	membership: Pick<Product.Membership, "subscription">,
	now = Date.now(),
): string => {
	const subscription = membership.subscription
	if (
		subscription === null ||
		subscription.status !== "active" ||
		subscription.expiresAt <= now
	)
		return "Kay Mythic"
	return subscription.planId === "precious" ? "Kay Precious" : "Kay Flawless"
}
