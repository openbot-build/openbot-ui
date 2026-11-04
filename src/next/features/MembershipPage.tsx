import { t } from "@lingui/core/macro"
import type * as Product from "@kaicom/kay-contracts"
import type { Client } from "@kaicom/kay-contracts/Client"
import { useEffect, useRef, useState } from "react"
import { ArrowUpRight, Check, Gift, Gem, RefreshCw } from "lucide-react"
import { Button } from "../../components/ui/button"
import {
	membershipDate,
	membershipError,
	membershipPrice,
	useMembership,
} from "./MembershipShared"
import {
	membershipRequestKey,
	membershipWriteRejected,
	readMembershipRequest,
	saveMembershipRequest,
	type PendingMembershipChange,
} from "./MembershipState"
import "./Membership.css"
import { accountPlanName } from "../AccountPresentation"

export function MembershipPage({
	client,
	bootstrap,
	onNavigateFeature,
	onChanged,
}: {
	readonly client: Client | undefined
	readonly bootstrap: Product.Bootstrap | undefined
	readonly onNavigateFeature: (id: string) => void
	readonly onChanged?: (() => void | Promise<void>) | undefined
}) {
	const membership = useMembership({ client, bootstrap })
	const [code, setCode] = useState("")
	const [busy, setBusy] = useState(false)
	const [notice, setNotice] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState<PendingMembershipChange | null>(null)
	const alive = useRef(true)
	const locked = useRef(false)
	const requestKey =
		bootstrap === undefined
			? null
			: membershipRequestKey({
					userId: bootstrap.identity.userId,
					organizationId: bootstrap.identity.organizationId,
					kind: "redeem",
				})
	const finish = (result: Product.MembershipRedemption) => {
		if (!alive.current || requestKey === null) return
		saveMembershipRequest({
			storage: sessionStorage,
			key: requestKey,
			value: null,
		})
		setPending(null)
		setCode("")
		membership.setValue(result.membership)
		void (async () => {
			try {
				await onChanged?.()
			} catch {
				if (alive.current)
					setError(
						t`Your membership was saved. Refresh to update your account details.`,
					)
			}
		})()
		setError(null)
		setNotice(
			t`Membership activated. Your current plan and expiry are shown below.`,
		)
	}
	const reconcile = async (
		request: PendingMembershipChange,
		signal?: AbortSignal,
	) => {
		if (client === undefined || locked.current) return
		locked.current = true
		setBusy(true)
		try {
			const result = await client.membershipRedemption(
				request.requestId,
				signal,
			)
			if (!alive.current || signal?.aborted === true) return
			if (result !== null) finish(result)
			else
				setError(
					t`The redemption has not been confirmed yet. Check its status before trying another code.`,
				)
		} catch (failure) {
			if (alive.current && signal?.aborted !== true)
				setError(membershipError(failure))
		} finally {
			locked.current = false
			if (alive.current) setBusy(false)
		}
	}
	useEffect(() => {
		alive.current = true
		const controller = new AbortController()
		const saved =
			requestKey === null
				? null
				: readMembershipRequest({ storage: sessionStorage, key: requestKey })
		setPending(saved)
		if (saved !== null) void reconcile(saved, controller.signal)
		return () => {
			alive.current = false
			controller.abort()
		}
	}, [requestKey, client])
	useEffect(() => {
		if (pending === null) return
		const check = () => {
			if (document.visibilityState === "visible") void reconcile(pending)
		}
		const timer = window.setInterval(check, 5000)
		window.addEventListener("online", check)
		return () => {
			window.clearInterval(timer)
			window.removeEventListener("online", check)
		}
	}, [pending, client])
	const redeem = async (retry = false) => {
		if (
			client === undefined ||
			requestKey === null ||
			locked.current ||
			(pending !== null && !retry) ||
			code.trim() === ""
		)
			return
		const request: PendingMembershipChange =
			retry && pending?.kind === "redeem"
				? pending
				: {
						kind: "redeem",
						requestId: crypto.randomUUID(),
					}
		try {
			saveMembershipRequest({
				storage: sessionStorage,
				key: requestKey,
				value: request,
			})
		} catch {
			setError(
				t`Your browser could not save this request. Allow session storage before redeeming a code.`,
			)
			return
		}
		locked.current = true
		setBusy(true)
		setPending(request)
		setError(null)
		setNotice(null)
		try {
			finish(
				await client.redeemMembership({
					requestId: request.requestId,
					code: code.trim(),
				}),
			)
		} catch (failure) {
			if (!alive.current) return
			if (membershipWriteRejected(failure) && !retry) {
				saveMembershipRequest({
					storage: sessionStorage,
					key: requestKey,
					value: null,
				})
				setPending(null)
				setError(membershipError(failure))
			} else {
				setError(
					membershipWriteRejected(failure)
						? membershipError(failure)
						: t`Checking whether your code was redeemed. It will not be submitted again.`,
				)
			}
		} finally {
			locked.current = false
			if (alive.current) setBusy(false)
		}
	}
	const value = membership.value
	const subscription = value?.subscription
	const active =
		subscription?.status === "active" && subscription.expiresAt > Date.now()
	return (
		<div className="kay-membership">
			<div className="membership-heading">
				<div>
					<span className="membership-eyebrow">
						<Gem size={16} />
						{t`Membership`}
					</span>
					<h2>Treasure</h2>
					<p>{t`Purchases are not available yet. You can activate a plan with a redemption code.`}</p>
				</div>
				{client !== undefined && (
					<Button
						variant="ghost"
						size="icon"
						aria-label={t`Refresh membership`}
						disabled={membership.loading}
						onClick={() => void membership.reload()}
					>
						<RefreshCw size={17} />
					</Button>
				)}
			</div>
			{client === undefined ? (
				<p className="membership-notice">{t`Sign in to see your membership and redeem a code.`}</p>
			) : membership.loading && value === null ? (
				<div
					className="feature-skeleton"
					role="status"
				>{t`Loading membership…`}</div>
			) : null}
			{membership.error !== null && (
				<div className="membership-notice" role="alert">
					<p>{membership.error}</p>
					<Button
						variant="outline"
						onClick={() => void membership.reload()}
						disabled={membership.loading}
					>{t`Try again`}</Button>
				</div>
			)}
			{notice !== null && (
				<p className="membership-notice" role="status">
					<Check size={16} />
					{notice}
				</p>
			)}
			{value !== null && (
				<>
					<section className="membership-current">
						<span className="membership-eyebrow">{t`Current membership`}</span>
						<div className="membership-current-title">
							<h3>{accountPlanName(value)}</h3>
							{active && <span className="membership-status">{t`Active`}</span>}
						</div>
						{subscription != null && (
							<p>
								{active ? t`Active until` : t`Expired on`}{" "}
								<time dateTime={new Date(subscription.expiresAt).toISOString()}>
									{membershipDate(subscription.expiresAt)}
								</time>
							</p>
						)}
						<p>
							{value.container.allowed
								? t`Your membership includes access to the restricted task environment. Availability is shown in Computers.`
								: t`An active membership is required to use the restricted task environment.`}
						</p>
						{value.container.allowed && (
							<Button
								variant="outline"
								onClick={() => onNavigateFeature("computers")}
							>
								{t`Open computers`}
								<ArrowUpRight size={16} />
							</Button>
						)}
					</section>
					<section className="membership-redeem">
						<div>
							<Gift size={20} />
							<h3>{t`Redeem a code`}</h3>
						</div>
						<p>{t`Use a code to activate membership or extend your current plan. Codes can be used once.`}</p>
						<form
							onSubmit={(event) => {
								event.preventDefault()
								void redeem()
							}}
						>
							<label htmlFor="membership-code">{t`Redemption code`}</label>
							<div className="membership-code-entry">
								<input
									id="membership-code"
									value={code}
									onChange={(event) => setCode(event.target.value)}
									autoComplete="off"
									autoCapitalize="characters"
									spellCheck={false}
									maxLength={128}
									placeholder={t`Enter your code`}
									disabled={busy}
								/>
								<Button
									type="submit"
									disabled={busy || pending !== null || code.trim() === ""}
								>
									{busy ? t`Checking…` : t`Redeem`}
								</Button>
							</div>
						</form>
						{error !== null && (
							<p className="membership-error" role="alert">
								{error}
							</p>
						)}
						{pending !== null && (
							<div className="membership-recovery">
								<Button
									variant="ghost"
									disabled={busy}
									onClick={() => void reconcile(pending)}
								>
									<RefreshCw size={15} />
									{t`Check redemption status`}
								</Button>
								<p>{t`If the request could not reach Kay, enter the same code and retry this request. It cannot activate your membership twice.`}</p>
								<Button
									variant="outline"
									disabled={busy || code.trim() === ""}
									onClick={() => void redeem(true)}
								>{t`Retry this redemption`}</Button>
							</div>
						)}
					</section>
					<section className="membership-plan-section">
						<h3>{t`Kay plans`}</h3>
						<div className="membership-plans">
							{value.plans.map((plan) => (
								<article className="membership-plan" key={plan.id}>
									<span className="membership-plan-mark">
										<Gem size={22} />
									</span>
									<h4>{plan.name}</h4>
									<p className="membership-price">
										{membershipPrice(plan)}
										<span>{t`/ month`}</span>
									</p>
									<span className="membership-currency">USD</span>
									<p>{t`Access to the restricted task environment while your membership is active.`}</p>
									<Button
										variant="outline"
										disabled
									>{t`Purchasing is not available yet`}</Button>
								</article>
							))}
						</div>
						<p className="membership-footnote">{t`Both plans currently provide the same restricted task-environment access. Redeeming a code does not start a payment or automatic renewal.`}</p>
					</section>
				</>
			)}
		</div>
	)
}
