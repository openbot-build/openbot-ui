import { t } from "@lingui/core/macro"
import { i18n } from "@lingui/core"
import { RequestFailed, type Client } from "@kaicom/kay-contracts/Client"
import type * as Product from "@kaicom/kay-contracts"
import { Match } from "effect"
import { useCallback, useEffect, useRef, useState } from "react"

export const membershipError = (error: unknown): string => {
	if (!(error instanceof RequestFailed))
		return t`Membership details could not be loaded. Please try again.`
	return Match.value(error.problem.code).pipe(
		Match.when(
			"membership_invalid_code",
			() => t`This redemption code is not valid. Check the code and try again.`,
		),
		Match.when(
			"membership_code_used",
			() => t`This code has already been redeemed.`,
		),
		Match.when(
			"membership_code_revoked",
			() => t`This code has been revoked and can no longer be redeemed.`,
		),
		Match.when(
			"membership_plan_conflict",
			() =>
				t`Your current plan is still active. You can extend it with a code for the same plan, or change plans after it expires.`,
		),
		Match.when(
			"forbidden",
			() => t`You do not have access to manage redemption codes.`,
		),
		Match.when(
			"unauthorized",
			() => t`Please sign in to view your membership.`,
		),
		Match.when("invalid_input", () => t`Check the details and try again.`),
		Match.when(
			"outcome_unknown",
			() =>
				t`Checking whether the change was saved. It will not be submitted again.`,
		),
		Match.orElse(
			() => t`Membership details could not be loaded. Please try again.`,
		),
	)
}

export const membershipDate = (value: number): string =>
	new Intl.DateTimeFormat(i18n.locale || "en", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(value)

export const membershipPrice = (plan: Product.MembershipPlan): string =>
	new Intl.NumberFormat(i18n.locale || "en", {
		style: "currency",
		currency: plan.currency,
		maximumFractionDigits: 0,
	}).format(plan.monthlyPriceCents / 100)

export const membershipPlanName = (id: Product.MembershipPlanId): string =>
	id === "precious" ? "Kay Precious" : "Kay Flawless"

export function useMembership({
	client,
	bootstrap,
}: {
	readonly client: Client | undefined
	readonly bootstrap: Product.Bootstrap | undefined
}) {
	const owner =
		bootstrap === undefined
			? "preview"
			: `${bootstrap.identity.userId}:${bootstrap.identity.organizationId}`
	const [value, setValue] = useState<Product.Membership | null>(null)
	const valueOwner = useRef(owner)
	const [loading, setLoading] = useState(client !== undefined)
	const [error, setError] = useState<string | null>(null)
	const generation = useRef(0)
	const reload = useCallback(
		async (signal?: AbortSignal) => {
			if (client === undefined) return
			const current = ++generation.current
			setLoading(true)
			try {
				const next = await client.membership(signal)
				if (signal?.aborted === true || current !== generation.current) return
				valueOwner.current = owner
				setValue(next)
				setError(null)
			} catch (failure) {
				if (signal?.aborted !== true && current === generation.current)
					setError(membershipError(failure))
			} finally {
				if (signal?.aborted !== true && current === generation.current)
					setLoading(false)
			}
		},
		[client, owner],
	)
	useEffect(() => {
		const controller = new AbortController()
		setValue(null)
		setError(null)
		void reload(controller.signal)
		return () => {
			controller.abort()
			generation.current++
		}
	}, [reload])
	useEffect(() => {
		if (client === undefined) return
		const controller = new AbortController()
		const refresh = () => {
			void reload(controller.signal)
		}
		window.addEventListener("focus", refresh)
		const subscription =
			valueOwner.current === owner ? value?.subscription : null
		const timer =
			subscription?.status === "active" && subscription.expiresAt > Date.now()
				? window.setTimeout(
						refresh,
						Math.min(subscription.expiresAt - Date.now(), 86_400_000),
					)
				: undefined
		return () => {
			controller.abort()
			window.removeEventListener("focus", refresh)
			if (timer !== undefined) window.clearTimeout(timer)
		}
	}, [client, owner, reload, value])
	const apply = (next: Product.Membership) => {
		generation.current++
		valueOwner.current = owner
		setValue(next)
		setLoading(false)
		setError(null)
	}
	return {
		value: valueOwner.current === owner ? value : null,
		setValue: apply,
		loading,
		error,
		reload,
		owner,
	}
}
