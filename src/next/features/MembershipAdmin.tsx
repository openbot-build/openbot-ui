import { writeClipboard } from "../../lib/runtime"
import { t, plural } from "@lingui/core/macro"
import type * as Product from "@kaicom/kay-contracts"
import type { Client } from "@kaicom/kay-contracts/Client"
import { Match } from "effect"
import { useEffect, useRef, useState } from "react"
import {
	ArrowUpRight,
	Check,
	Copy,
	Plus,
	RefreshCw,
	Ticket,
	X,
} from "lucide-react"
import { Button } from "../../components/ui/button"
import {
	membershipDate,
	membershipError,
	membershipPlanName,
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

const codeStatus = (status: Product.MembershipCode["status"]): string =>
	Match.value(status).pipe(
		Match.when("available", () => t`Available`),
		Match.when("redeemed", () => t`Redeemed`),
		Match.when("revoked", () => t`Revoked`),
		Match.exhaustive,
	)

export function MembershipAdmin({
	client,
	bootstrap,
}: {
	readonly client: Client
	readonly bootstrap: Product.Bootstrap
}) {
	const membership = useMembership({ client, bootstrap })
	const [records, setRecords] = useState<ReadonlyArray<Product.MembershipCode>>(
		[],
	)
	const [next, setNext] = useState<string | null>(null)
	const [loaded, setLoaded] = useState(false)
	const [reading, setReading] = useState(false)
	const [creating, setCreating] = useState(false)
	const [plan, setPlan] = useState<Product.MembershipPlanId>("precious")
	const [months, setMonths] = useState(1)
	const [selected, setSelected] = useState<string | null>(null)
	const [confirming, setConfirming] = useState<string | null>(null)
	const [secret, setSecret] = useState<{
		readonly code: string
		readonly record: Product.MembershipCode
	} | null>(null)
	const [copied, setCopied] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const [pending, setPending] = useState<PendingMembershipChange | null>(null)
	const alive = useRef(true)
	const lock = useRef(false)
	const listGeneration = useRef(0)
	const requestKey = membershipRequestKey({
		userId: bootstrap.identity.userId,
		organizationId: bootstrap.identity.organizationId,
		kind: "create",
	})
	const allowed = membership.value?.canManageCodes === true
	const updateRecord = (record: Product.MembershipCode) => {
		listGeneration.current++
		setReading(false)
		setRecords((items) =>
			[record, ...items.filter((item) => item.id !== record.id)].sort(
				(left, right) => right.createdAt - left.createdAt,
			),
		)
	}
	const refresh = async (before?: string, signal?: AbortSignal) => {
		if (!allowed) return
		const current = ++listGeneration.current
		setReading(true)
		try {
			const page = await client.membershipCodes({
				...(before === undefined ? {} : { before }),
				...(signal === undefined ? {} : { signal }),
			})
			if (
				!alive.current ||
				signal?.aborted === true ||
				current !== listGeneration.current
			)
				return
			setRecords((items) =>
				before === undefined
					? page.items
					: [
							...items,
							...page.items.filter(
								(item) => !items.some((existing) => existing.id === item.id),
							),
						],
			)
			setNext(page.next)
			setLoaded(true)
			setError(null)
		} catch (failure) {
			if (
				alive.current &&
				signal?.aborted !== true &&
				current === listGeneration.current
			)
				setError(membershipError(failure))
		} finally {
			if (alive.current && current === listGeneration.current) setReading(false)
		}
	}
	const reconcile = async (
		request: PendingMembershipChange,
		signal?: AbortSignal,
	) => {
		if (!allowed || lock.current) return
		lock.current = true
		setBusy(true)
		try {
			const record = await client.membershipCodeRequest(
				request.requestId,
				signal,
			)
			if (!alive.current || signal?.aborted === true) return
			if (record === null) {
				setError(
					t`The code creation has not been confirmed yet. Its status will be checked without creating another code.`,
				)
				return
			}
			saveMembershipRequest({
				storage: sessionStorage,
				key: requestKey,
				value: null,
			})
			setPending(null)
			setCreating(false)
			updateRecord(record)
			setSelected(record.id)
			setNotice(
				t`The code was created, but its full value cannot be shown again. Revoke this code and create a new one if you did not save it.`,
			)
			setError(null)
		} catch (failure) {
			if (alive.current && signal?.aborted !== true)
				setError(membershipError(failure))
		} finally {
			lock.current = false
			if (alive.current) setBusy(false)
		}
	}
	useEffect(() => {
		alive.current = true
		const controller = new AbortController()
		if (allowed) {
			void refresh(undefined, controller.signal)
			const saved = readMembershipRequest({
				storage: sessionStorage,
				key: requestKey,
			})
			setPending(saved)
			if (saved !== null) void reconcile(saved, controller.signal)
		} else {
			setSecret(null)
			setRecords([])
		}
		return () => {
			alive.current = false
			controller.abort()
			listGeneration.current++
		}
	}, [allowed, requestKey, client])
	useEffect(() => {
		if (pending === null || !allowed) return
		const check = () => {
			if (document.visibilityState === "visible") void reconcile(pending)
		}
		const timer = window.setInterval(check, 5000)
		window.addEventListener("online", check)
		return () => {
			window.clearInterval(timer)
			window.removeEventListener("online", check)
		}
	}, [pending, allowed, client])
	const create = async (retry = false) => {
		if (
			!allowed ||
			lock.current ||
			(pending !== null && !retry) ||
			secret !== null
		)
			return
		const request: PendingMembershipChange =
			retry && pending?.kind === "create"
				? pending
				: {
						kind: "create",
						requestId: crypto.randomUUID(),
						planId: plan,
						months,
					}
		if (request.kind !== "create") return
		try {
			saveMembershipRequest({
				storage: sessionStorage,
				key: requestKey,
				value: request,
			})
		} catch {
			setError(
				t`Your browser could not save this request. Allow session storage before creating a code.`,
			)
			return
		}
		lock.current = true
		setBusy(true)
		setPending(request)
		setError(null)
		setNotice(null)
		try {
			const result = await client.createMembershipCode({
				requestId: request.requestId,
				planId: request.planId,
				months: request.months,
			})
			if (!alive.current) return
			saveMembershipRequest({
				storage: sessionStorage,
				key: requestKey,
				value: null,
			})
			setPending(null)
			setCreating(false)
			setSecret(
				result.code === null
					? null
					: { code: result.code, record: result.record },
			)
			setCopied(false)
			setSelected(result.record.id)
			updateRecord(result.record)
			if (result.code === null)
				setNotice(
					t`The code was created, but its full value cannot be shown again. Revoke this code and create a new one if you did not save it.`,
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
			} else
				setError(
					t`Checking whether the code was created. It will not be submitted again.`,
				)
		} finally {
			lock.current = false
			if (alive.current) setBusy(false)
		}
	}
	const revoke = async (record: Product.MembershipCode) => {
		if (!allowed || lock.current || record.status !== "available") return
		lock.current = true
		setBusy(true)
		setError(null)
		try {
			const result = await client.revokeMembershipCode(record.id)
			if (!alive.current) return
			updateRecord(result)
			setConfirming(null)
			setSecret((visible) =>
				visible?.record.id === record.id ? null : visible,
			)
			setNotice(t`Code revoked. It can no longer be redeemed.`)
		} catch (failure) {
			if (!alive.current) return
			setError(membershipError(failure))
			if (!membershipWriteRejected(failure)) {
				try {
					const current = await client.membershipCodeRequest(record.requestId)
					if (!alive.current) return
					if (current !== null) updateRecord(current)
					if (current?.status === "revoked") {
						setConfirming(null)
						setSecret((visible) =>
							visible?.record.id === record.id ? null : visible,
						)
						setError(null)
						setNotice(t`Code revoked. It can no longer be redeemed.`)
					}
				} catch {
					/* The failed state read leaves the revocation unconfirmed. */
				}
			}
		} finally {
			lock.current = false
			if (alive.current) setBusy(false)
		}
	}
	const copy = async () => {
		if (secret === null) return
		try {
			await writeClipboard(secret.code)
			if (alive.current) setCopied(true)
		} catch {
			if (alive.current)
				setError(
					t`The code could not be copied. Select it and copy it manually.`,
				)
		}
	}
	const current = records.find((record) => record.id === selected)
	return (
		<section className="kay-membership">
			<p className="kay-admin-scope">{t`Create a code for a plan and a duration. The first person to redeem it receives the membership.`}</p>
			{membership.loading && membership.value === null ? (
				<div
					className="feature-skeleton"
					role="status"
				>{t`Loading membership…`}</div>
			) : membership.error !== null ? (
				<div className="membership-notice" role="alert">
					<p>{membership.error}</p>
					<Button
						variant="outline"
						onClick={() => void membership.reload()}
					>{t`Try again`}</Button>
				</div>
			) : !allowed ? (
				<p className="membership-notice">{t`You do not have access to manage redemption codes.`}</p>
			) : (
				<>
					<div className="membership-admin-toolbar">
						<p>{t`Purchasing is not available yet. Codes activate membership without charging a payment method.`}</p>
						<div>
							<Button
								variant="ghost"
								size="icon"
								disabled={reading}
								aria-label={t`Refresh codes`}
								onClick={() => void refresh()}
							>
								<RefreshCw size={17} />
							</Button>
							<Button
								disabled={busy || pending !== null || secret !== null}
								onClick={() => {
									setCreating(true)
									setMonths(1)
									setSelected(null)
									setConfirming(null)
									setNotice(null)
									setError(null)
								}}
							>
								<Plus size={16} />
								{t`Create code`}
							</Button>
						</div>
					</div>
					{notice !== null && (
						<p className="membership-notice" role="status">
							{notice}
						</p>
					)}
					{error !== null && (
						<p className="membership-error" role="alert">
							{error}
						</p>
					)}
					{pending !== null && (
						<div className="membership-notice">
							<p>{t`This request is being checked. No additional code will be created automatically.`}</p>
							<Button
								variant="outline"
								disabled={busy}
								onClick={() => void reconcile(pending)}
							>{t`Check creation status`}</Button>
							<p>{t`If the request could not reach Kay, retry the original plan and duration. A second code will not be created.`}</p>
							<Button
								variant="outline"
								disabled={busy}
								onClick={() => void create(true)}
							>{t`Retry this creation`}</Button>
						</div>
					)}
					{secret !== null && (
						<section className="membership-secret">
							<span className="membership-eyebrow">
								<Check size={16} />
								{t`Code created`}
							</span>
							<h3>{t`Save this code now`}</h3>
							<p>
								<strong>{membershipPlanName(secret.record.planId)}</strong> ·{" "}
								{plural(secret.record.months, {
									one: "# month",
									other: "# months",
								})}
							</p>
							<p>{t`This is the only time the full code is shown. Save it before leaving this page.`}</p>
							<label
								className="sr-only"
								htmlFor="created-membership-code"
							>{t`New redemption code`}</label>
							<input
								id="created-membership-code"
								value={secret.code}
								readOnly
								autoComplete="off"
								spellCheck={false}
								onFocus={(event) => event.target.select()}
							/>
							<div>
								<Button onClick={() => void copy()}>
									{copied ? <Check size={16} /> : <Copy size={16} />}{" "}
									{copied ? t`Copied` : t`Copy code`}
								</Button>
								<Button
									variant="ghost"
									onClick={() => setSecret(null)}
								>{t`I have saved the code`}</Button>
							</div>
						</section>
					)}
					{creating && (
						<form
							className="membership-create"
							onSubmit={(event) => {
								event.preventDefault()
								void create()
							}}
						>
							<div className="membership-create-title">
								<h3>{t`Create a redemption code`}</h3>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									disabled={busy || pending !== null}
									aria-label={t`Close`}
									onClick={() => setCreating(false)}
								>
									<X size={17} />
								</Button>
							</div>
							<fieldset disabled={busy || pending !== null}>
								<label>
									{t`Plan`}
									<select
										value={plan}
										onChange={(event) =>
											setPlan(
												event.target.value === "precious"
													? "precious"
													: "flawless",
											)
										}
									>
										{membership.value?.plans.map((item) => (
											<option key={item.id} value={item.id}>
												{item.name} · {membershipPrice(item)} USD {t`/ month`}
											</option>
										))}
									</select>
								</label>
								<label>
									{t`Duration in months`}
									<select
										value={months}
										onChange={(event) => setMonths(Number(event.target.value))}
									>
										{Array.from({ length: 12 }, (_, index) => index + 1).map(
											(value) => (
												<option key={value} value={value}>
													{plural(value, { one: "# month", other: "# months" })}
												</option>
											),
										)}
									</select>
								</label>
							</fieldset>
							<p>{t`The duration starts when the code is redeemed. A code for an active membership extends the same plan; a different plan can be activated after it expires.`}</p>
							<Button type="submit" disabled={busy || pending !== null}>
								{busy ? t`Creating…` : t`Create code`}
							</Button>
						</form>
					)}
					{current !== undefined && !creating && (
						<section className="membership-code-detail">
							<div className="membership-create-title">
								<div>
									<span className="membership-eyebrow">{t`Redemption code`}</span>
									<h3>{membershipPlanName(current.planId)}</h3>
								</div>
								<Button
									variant="ghost"
									size="icon"
									aria-label={t`Close details`}
									onClick={() => {
										setSelected(null)
										setConfirming(null)
									}}
								>
									<X size={17} />
								</Button>
							</div>
							<dl>
								<div>
									<dt>{t`Status`}</dt>
									<dd>{codeStatus(current.status)}</dd>
								</div>
								<div>
									<dt>{t`Duration`}</dt>
									<dd>
										{plural(current.months, {
											one: "# month",
											other: "# months",
										})}
									</dd>
								</div>
								<div>
									<dt>{t`Created`}</dt>
									<dd>{membershipDate(current.createdAt)}</dd>
								</div>
								{current.redeemedAt !== null && (
									<div>
										<dt>{t`Redeemed`}</dt>
										<dd>{membershipDate(current.redeemedAt)}</dd>
									</div>
								)}
								{current.redeemedBy !== null && (
									<div>
										<dt>{t`Redeemed by`}</dt>
										<dd>{current.redeemedBy.displayName}</dd>
									</div>
								)}
								{current.revokedAt !== null && (
									<div>
										<dt>{t`Revoked`}</dt>
										<dd>{membershipDate(current.revokedAt)}</dd>
									</div>
								)}
							</dl>
							{current.status === "available" && (
								<>
									{confirming === current.id ? (
										<div className="membership-notice">
											<p>{t`Revoke this unused code? Anyone who has a copy will no longer be able to redeem it.`}</p>
											<div className="membership-inline-actions">
												<Button
													variant="outline"
													disabled={busy}
													onClick={() => setConfirming(null)}
												>{t`Cancel`}</Button>
												<Button
													variant="destructive"
													disabled={busy}
													onClick={() => void revoke(current)}
												>{t`Revoke code`}</Button>
											</div>
										</div>
									) : (
										<Button
											variant="outline"
											disabled={busy || pending !== null}
											onClick={() => setConfirming(current.id)}
										>{t`Revoke code`}</Button>
									)}
								</>
							)}
						</section>
					)}
					<section className="membership-code-list">
						<h3>{t`Redemption codes`}</h3>
						{reading && !loaded ? (
							<div
								className="feature-skeleton"
								role="status"
							>{t`Loading codes…`}</div>
						) : loaded && records.length === 0 ? (
							<div className="membership-empty">
								<Ticket size={26} />
								<h4>{t`No codes created yet`}</h4>
								<p>{t`Create your first code, save it once, and share it with the person who will redeem it.`}</p>
							</div>
						) : (
							<ul>
								{records.map((record) => (
									<li key={record.id}>
										<button
											aria-current={selected === record.id ? "true" : undefined}
											onClick={() => {
												setSelected(record.id)
												setCreating(false)
												setConfirming(null)
											}}
										>
											<Ticket size={19} />
											<span>
												<strong>{membershipPlanName(record.planId)}</strong>
												<small>
													{plural(record.months, {
														one: "# month",
														other: "# months",
													})}{" "}
													· {membershipDate(record.createdAt)}
													{record.redeemedBy !== null
														? ` · ${record.redeemedBy.displayName}`
														: ""}
												</small>
											</span>
											<span className="membership-status">
												{codeStatus(record.status)}
											</span>
											<ArrowUpRight size={16} />
										</button>
									</li>
								))}
							</ul>
						)}
						{next !== null && (
							<Button
								variant="outline"
								disabled={reading}
								onClick={() => void refresh(next)}
							>{t`Load more`}</Button>
						)}
					</section>
				</>
			)}
		</section>
	)
}
