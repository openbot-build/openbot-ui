import { t } from "@lingui/core/macro"
import { i18n } from "@lingui/core"
import type * as Product from "@kaicom/kay-contracts"
import { RequestFailed, type Client } from "@kaicom/kay-contracts/Client"
import { Match } from "effect"
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUpRight, Box, FolderOpen, RefreshCw } from "lucide-react"
import { Button } from "../../components/ui/button"
import {
	basicComputeIdleDeadline,
	basicComputeKey,
	basicComputeSettled,
	canOpenBasicCompute,
	canPrepareBasicCompute,
	readBasicComputeRequest,
	type PendingBasicCompute,
} from "./BasicComputeState"

const failureMessage = (failure: unknown): string => {
	if (!(failure instanceof RequestFailed))
		return t`The connection was interrupted. Checking your workspace without repeating the request.`
	return Match.value(failure.problem.code).pipe(
		Match.when(
			"basic_compute_busy",
			() => t`The task space is in use. Please come back when it is available.`,
		),
		Match.when(
			"basic_compute_unavailable",
			() =>
				t`The basic task space is not available right now. Your other computers are still available.`,
		),
		Match.when(
			"basic_compute_repair_required",
			() =>
				t`Your workspace connection needs to be restored. Choose Reconnect to continue.`,
		),
		Match.whenOr(
			"membership_required",
			"membership_expired",
			() =>
				t`An active Kay Precious or Kay Flawless membership is needed for this space.`,
		),
		Match.when("forbidden", () => t`You do not have access to this workspace.`),
		Match.orElse(
			() =>
				t`The workspace could not be updated. Its current status will be checked automatically.`,
		),
	)
}

export function useBasicCompute({
	client,
	bootstrap,
}: {
	readonly client: Client | undefined
	readonly bootstrap: Product.Bootstrap | undefined
}) {
	const key =
		bootstrap === undefined ? null : basicComputeKey(bootstrap.identity)
	const [value, setValue] = useState<Product.BasicCompute | null>(null)
	const [pending, setPending] = useState<PendingBasicCompute | null>(null)
	const [missing, setMissing] = useState(false)
	const [continuable, setContinuable] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [storageReady, setStorageReady] = useState(false)
	const current = useRef({ key, client, alive: true, locked: false })
	const check = useCallback(
		async (request?: PendingBasicCompute | null, signal?: AbortSignal) => {
			const scope = current.current
			if (
				client === undefined ||
				key === null ||
				!scope.alive ||
				scope.key !== key ||
				scope.client !== client ||
				scope.locked
			)
				return
			scope.locked = true
			try {
				const receipt =
					request == null
						? null
						: await client.basicComputeRequest(request.requestId, signal)
				const next = await client.basicCompute(signal)
				if (!scope.alive || signal?.aborted === true) return
				const operation =
					receipt ??
					(request == null || next.operation?.requestId === request.requestId
						? next.operation
						: null)
				setValue(next)
				setError(
					request != null && operation?.phase === "failed"
						? t`This workspace request could not be completed. Please try again.`
						: null,
				)
				setMissing(request != null && operation === null)
				setContinuable(
					operation !== null &&
						["pending", "creating", "granting"].includes(operation.phase),
				)
				if (
					request == null &&
					operation !== null &&
					!basicComputeSettled(operation)
				) {
					const restored = {
						requestId: operation.requestId,
						action: operation.action,
					}
					sessionStorage.setItem(key, JSON.stringify(restored))
					setPending(restored)
				}
				if (
					request != null &&
					operation !== null &&
					basicComputeSettled(operation)
				) {
					sessionStorage.removeItem(key)
					setPending(null)
					setMissing(false)
					setContinuable(false)
				}
			} catch (failure) {
				if (scope.alive && signal?.aborted !== true)
					setError(failureMessage(failure))
			} finally {
				scope.locked = false
			}
		},
		[client, key],
	)
	useEffect(() => {
		const scope = { key, client, alive: true, locked: false }
		current.current = scope
		const controller = new AbortController()
		setValue(null)
		setPending(null)
		setMissing(false)
		setContinuable(false)
		setError(null)
		setBusy(false)
		setStorageReady(false)
		try {
			const saved =
				key === null
					? null
					: readBasicComputeRequest({ storage: sessionStorage, key })
			setPending(saved)
			setStorageReady(true)
			void check(saved, controller.signal)
		} catch {
			setError(
				t`Your browser could not restore the workspace request. Allow session storage before continuing.`,
			)
		}
		return () => {
			scope.alive = false
			controller.abort()
		}
	}, [key, client, check])
	useEffect(() => {
		if (client === undefined) return
		const refresh = () => {
			if (document.visibilityState === "visible") void check(pending)
		}
		const timer = window.setInterval(
			refresh,
			pending !== null ||
				value?.state === "connecting" ||
				value?.state === "provisioning"
				? 2500
				: 15000,
		)
		window.addEventListener("online", refresh)
		return () => {
			window.clearInterval(timer)
			window.removeEventListener("online", refresh)
		}
	}, [check, client, pending, value?.state])
	const write = async (
		action: PendingBasicCompute["action"],
		retry = false,
	) => {
		const scope = current.current
		if (
			client === undefined ||
			key === null ||
			!scope.alive ||
			scope.key !== key ||
			scope.client !== client ||
			scope.locked ||
			!storageReady ||
			(pending !== null && !retry)
		)
			return
		const request =
			retry && pending !== null
				? pending
				: { action, requestId: crypto.randomUUID() }
		try {
			sessionStorage.setItem(key, JSON.stringify(request))
		} catch {
			setError(
				t`Your browser could not save this workspace request. Allow session storage before continuing.`,
			)
			return
		}
		scope.locked = true
		setBusy(true)
		setPending(request)
		setMissing(false)
		setError(null)
		try {
			await Match.value(request.action).pipe(
				Match.when("provision", () =>
					client.provisionBasicCompute({ requestId: request.requestId }),
				),
				Match.when("repair", () =>
					client.repairBasicCompute({ requestId: request.requestId }),
				),
				Match.when("release", () =>
					client.releaseBasicCompute({ requestId: request.requestId }),
				),
				Match.exhaustive,
			)
		} catch (failure) {
			if (scope.alive) setError(failureMessage(failure))
		} finally {
			scope.locked = false
			if (scope.alive) {
				setBusy(false)
				void check(request)
			}
		}
	}
	return {
		value,
		pending,
		missing,
		continuable,
		busy,
		error,
		storageReady,
		preview: client === undefined,
		check,
		write,
	}
}

export function BasicComputeCard({
	state,
	selected = false,
	onOpen,
	onMembership,
}: {
	readonly state: ReturnType<typeof useBasicCompute>
	readonly selected?: boolean
	readonly onOpen: (id: string) => void
	readonly onMembership: () => void
}) {
	const { value, pending, missing, busy, error } = state
	const commandSeconds = value?.limits.commandSeconds ?? 120
	const [confirm, setConfirm] = useState<"repair" | "release" | null>(null)
	const blocked = busy || pending !== null || !state.storageReady
	const idleMinutes = Math.ceil((value?.idleSeconds ?? 300) / 60)
	const idleDeadline = basicComputeIdleDeadline(value)
	const endTime =
		idleDeadline === null
			? null
			: new Intl.DateTimeFormat(i18n.locale || "en", {
					timeStyle: "short",
				}).format(idleDeadline)
	const description = state.preview
		? t`Sign in to Kay to check your task space.`
		: value === null
			? t`Checking your task space…`
			: !value.enabled
				? t`The basic task space is not available right now. Your other computers are still available.`
				: !value.entitled
					? t`Included with Kay Precious and Kay Flawless. Redeem a membership code to get started.`
					: value.lease.state === "busy"
						? t`The task space is in use. Please come back when it is available.`
						: value.operation?.phase === "failed"
							? t`This workspace request could not be completed. Please try again.`
							: Match.value(value.state).pipe(
									Match.when(
										"needs_repair",
										() =>
											t`Your workspace connection needs to be restored. Choose Reconnect to continue.`,
									),
									Match.when(
										"provisioning",
										() => t`Preparing your private workspace…`,
									),
									Match.when(
										"connecting",
										() =>
											t`Connecting your workspace. It will become available automatically.`,
									),
									Match.when("ready", () =>
										value.automatic !== true
											? t`Ready for small calculations, scripts, and temporary files.`
											: Match.value(value.lease.activity).pipe(
													Match.when(
														"working",
														() =>
															t`Your task is running. Its workspace stays available until the work finishes.`,
													),
													Match.when(
														"idle",
														() =>
															t`No task is running. Saved results stay in Files when this temporary space is cleared.`,
													),
													Match.orElse(
														() =>
															t`Checking whether your workspace is still in use…`,
													),
												),
									),
									Match.orElse(() =>
										value.automatic === true
											? t`Kay prepares a workspace when your task needs one. There is nothing to set up in advance.`
											: t`A temporary workspace for small calculations and file tasks. Kay can use it with your permission.`,
									),
								)
	return (
		<section className="basic-compute-card" aria-label={t`Basic task space`}>
			<div className="computer-panel-heading">
				<div className="basic-compute-title">
					<Box size={22} />
					<h2>{t`Basic task space`}</h2>
				</div>
				<Button
					variant="ghost"
					size="icon"
					aria-label={t`Refresh task space`}
					disabled={busy}
					onClick={() => void state.check(pending)}
				>
					<RefreshCw size={16} />
				</Button>
			</div>
			<p role="status">{description}</p>
			<p className="basic-compute-limits">{t`0.5 CPU · 512 MiB memory · 64 MiB files · ${commandSeconds} seconds per command`}</p>
			{value?.limits.network === true && (
				<p>{t`Read public web pages, download images, and create files. Saved results are available in Files and as conversation attachments.`}</p>
			)}
			{value?.limits.network === false && (
				<p>{t`This workspace is offline. Kay can work with files you provide.`}</p>
			)}
			<p>
				{value?.automatic === true
					? t`No desktop or interactive terminal. Your workspace stays available throughout the task and is cleared after ${idleMinutes} minutes without work. Results saved in Files stay available after cleanup.`
					: t`No desktop or interactive terminal. A workspace lasts up to 15 minutes. Download results before it ends; temporary files will be cleared.`}
			</p>
			{endTime !== null && (
				<p role="status">{t`If no new work starts, this space will be cleared at ${endTime}.`}</p>
			)}
			{error !== null && (
				<p className="feature-error" role="alert">
					{error}
				</p>
			)}
			{pending !== null && (
				<p role="status">{t`Checking your saved request automatically. It will not be submitted again.`}</p>
			)}
			{confirm !== null ? (
				<div className="basic-compute-confirm">
					<p>
						{confirm === "release"
							? t`End this task space? Running work will stop and temporary files will be deleted.`
							: t`Reconnect this workspace? Its connection will be replaced. Wait for any running work to finish first.`}
					</p>
					<div className="computer-page-actions">
						<Button
							disabled={blocked}
							onClick={() => {
								void state.write(confirm)
								setConfirm(null)
							}}
						>
							{confirm === "release" ? t`End task space` : t`Reconnect`}
						</Button>
						<Button
							variant="ghost"
							onClick={() => setConfirm(null)}
						>{t`Cancel`}</Button>
					</div>
				</div>
			) : (
				<div className="computer-page-actions">
					{value?.enabled && !value.entitled && (
						<Button onClick={onMembership}>
							{t`Redeem membership code`}
							<ArrowUpRight size={16} />
						</Button>
					)}
					{canPrepareBasicCompute(value) && (
						<Button
							disabled={blocked}
							onClick={() => void state.write("provision")}
						>{t`Prepare my space`}</Button>
					)}
					{value?.enabled &&
						value.entitled &&
						value.state === "needs_repair" && (
							<Button
								disabled={blocked}
								onClick={() => setConfirm("repair")}
							>{t`Reconnect`}</Button>
						)}
					{!selected && canOpenBasicCompute(value) && (
						<Button
							disabled={blocked}
							onClick={() => {
								if (value?.computerId != null) onOpen(value.computerId)
							}}
						>
							<FolderOpen size={16} />
							{t`Open workspace`}
						</Button>
					)}
					{value?.enabled && value.lease.state === "active" && (
						<Button
							variant="outline"
							disabled={blocked}
							onClick={() => setConfirm("release")}
						>{t`End task space`}</Button>
					)}
					{(missing || state.continuable) && pending !== null && (
						<Button
							variant="outline"
							disabled={
								busy ||
								value?.enabled !== true ||
								(pending.action !== "release" && value.entitled !== true)
							}
							onClick={() => void state.write(pending.action, true)}
						>
							{missing ? t`Retry this request` : t`Continue setup`}
						</Button>
					)}
				</div>
			)}
		</section>
	)
}
