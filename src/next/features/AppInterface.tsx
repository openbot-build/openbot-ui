// @effect-diagnostics strictEffectProvide:off
import * as Apps from "@kaicom/k/Apps"
import * as McpApps from "@kaicom/k/McpApps"
import { AppUi, AppConnections } from "@kaicom/k"
import { RequestFailed, type Client } from "@kaicom/kay-contracts/Client"
import { t } from "@lingui/core/macro"
import { Effect, Exit, Layer, Option, Schema, Scope } from "effect"
import { useEffect, useRef, useState } from "react"
import { Button } from "../../components/ui/button"
import { Surface } from "../../components/Surface"
import { Anchor } from "../../components/mascot/Mascot"
import { OpenedView, toolResult, viewClient } from "./AppViewTransport"
import { objectOf } from "./SchemaValues"
import "../../experience/AppView.css"
import "./AppInterface.css"

export function AppInterface(props: {
	readonly client: Client
	readonly owner: string
	readonly opened: unknown
	readonly onChanged?: (() => void | Promise<void>) | undefined
	readonly onClose?: (() => void) | undefined
}) {
	const opened = Schema.decodeUnknownOption(OpenedView)(props.opened)
	if (Option.isNone(opened))
		return <p role="alert">{t`The App interface could not be opened.`}</p>
	return (
		<Mounted
			key={props.owner + ":" + opened.value.id}
			{...props}
			opened={opened.value}
		/>
	)
}

function Mounted({
	client,
	owner,
	opened,
	onChanged,
	onClose,
}: {
	readonly client: Client
	readonly owner: string
	readonly opened: OpenedView
	readonly onChanged?: (() => void | Promise<void>) | undefined
	readonly onClose?: (() => void) | undefined
}) {
	const container = useRef<HTMLDivElement>(null)
	const panel = useRef<HTMLDivElement>(null)
	const callbacks = useRef({ onChanged, onClose })
	callbacks.current = { onChanged, onClose }
	const [state, setState] = useState("Loading")
	const [mode, setMode] = useState<"inline" | "fullscreen">("inline")
	const [closed, setClosed] = useState(false)
	const [operation, setOperation] = useState<{
		readonly requestId: string
		readonly status: string
	} | null>(null)
	const [unknown, setUnknown] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [observed, setObserved] = useState<unknown>(null)
	const [reading, setReading] = useState(false)
	const readController = useRef<AbortController | null>(null)
	const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const [pending, setPending] = useState<{
		readonly title: string
		readonly value: unknown
		readonly reply: (allow: boolean) => void
	} | null>(null)
	const asking = useRef(false)
	useEffect(() => {
		const element = container.current
		if (element === null || closed) return
		// React may recreate effects while retaining the same server-owned view.
		// Only an actual departure releases that capability.
		if (closeTimer.current !== null) {
			clearTimeout(closeTimer.current)
			closeTimer.current = null
		}
		const scope = Scope.makeUnsafe()
		const controller = new AbortController()
		let writable = !opened.readOnly
		const changed = () => {
			void Promise.resolve(callbacks.current.onChanged?.()).catch(() => {})
		}
		const denied = () =>
			new Apps.HostActionDenied({ action: "The App request was not confirmed" })
		const confirm = (title: string, value: unknown) =>
			Effect.callback<boolean, Apps.HostActionDenied>((resume) => {
				if (asking.current) {
					resume(Effect.fail(denied()))
					return
				}
				asking.current = true
				setPending({
					title,
					value,
					reply: (allow) => {
						asking.current = false
						setPending(null)
						resume(Effect.succeed(allow))
					},
				})
				return Effect.sync(() => {
					asking.current = false
					setPending(null)
				})
			}).pipe(
				Effect.flatMap((allow) =>
					allow ? Effect.void : Effect.fail(denied()),
				),
			)
		const write = (id: string, payload: Schema.JsonObject) =>
			Effect.gen(function* () {
				if (!writable) return yield* denied()
				return yield* Effect.tryPromise({
					try: (signal) =>
						client.featureCall(
							id,
							{ params: { viewId: opened.id }, payload },
							signal,
						),
					catch: (error) => {
						writable = false
						setUnknown(
							!(error instanceof RequestFailed) ||
								error.problem.code === "outcome_unknown",
						)
						setError(
							error instanceof RequestFailed
								? error.problem.message
								: "Unavailable",
						)
						return denied()
					},
				}).pipe(Effect.tap(() => Effect.sync(changed)))
			})
		const program = Effect.gen(function* () {
			let revision = opened.interaction.revision
			const actions = Apps.HostActions.of({
				contentTypes: { text: {} },
				message: (_source, params) => {
					if (!writable) return Effect.fail(denied())
					return confirm(
						t`Send this App message to the conversation?`,
						params,
					).pipe(
						Effect.andThen(
							Schema.decodeUnknownEffect(Schema.JsonObject)(params),
						),
						Effect.flatMap((content) => write("appViews.message", { content })),
						Effect.as({}),
						Effect.mapError(denied),
					)
				},
				updateModelContext: (_source, params) => {
					if (!writable) return Effect.fail(denied())
					return confirm(
						t`Use this selection in future conversation turns?`,
						params,
					).pipe(
						Effect.andThen(
							Schema.decodeUnknownEffect(Schema.JsonObject)(params),
						),
						Effect.flatMap((context) =>
							write("appViews.confirmContext", { revision, context }),
						),
						Effect.tap((result) =>
							Effect.sync(() => {
								const value = objectOf(result)["revision"]
								if (typeof value === "number") revision = value
							}),
						),
						Effect.asVoid,
						Effect.mapError(denied),
					)
				},
				openLink: (_source, params) =>
					Effect.gen(function* () {
						const url = yield* Effect.try({
							try: () => new URL(params.url),
							catch: denied,
						})
						if (
							url.protocol !== "https:" ||
							url.username !== "" ||
							url.password !== ""
						)
							return yield* denied()
						yield* confirm(t`Open this link in the current page?`, url.href)
						window.location.assign(url.href)
						return {}
					}),
				displayMode: (_source, params) =>
					Effect.sync(() => {
						const next =
							params.mode === "fullscreen"
								? ("fullscreen" as const)
								: ("inline" as const)
						setMode(next)
						return { mode: next }
					}),
				size: (_source, params) =>
					Effect.sync(() => {
						element.style.blockSize =
							Math.max(
								160,
								Math.min(params.height ?? 360, window.innerHeight - 160),
							) + "px"
					}),
			})
			const transport = viewClient({
				client,
				opened,
				owner,
				onOperation: (value) => {
					setOperation(value)
					if (value.status === "OutcomeUnknown") setUnknown(true)
				},
				onChanged: changed,
			})
			const result =
				opened.result === undefined
					? undefined
					: yield* toolResult(opened.result)
			const mounted = yield* McpApps.mount({
				container: element,
				client: transport,
				tool: opened.source.name,
				arguments: opened.arguments,
				...(result === undefined ? {} : { result }),
				hostInfo: { name: "Kay", version: "1.0.0" },
				hostContext: {
					theme: document.documentElement.classList.contains("dark")
						? "dark"
						: "light",
					displayMode: "inline",
					availableDisplayModes: ["inline", "fullscreen"],
				},
			}).pipe(Effect.provideService(Apps.HostActions, actions))
			const runUi = Effect.runPromiseWith(yield* Effect.context<never>())
			const observer = new MutationObserver(() => {
				void runUi(
					mounted.hostContext({
						theme: document.documentElement.classList.contains("dark")
							? "dark"
							: "light",
						displayMode:
							panel.current?.dataset["mode"] === "fullscreen"
								? "fullscreen"
								: "inline",
						availableDisplayModes: ["inline", "fullscreen"],
					}),
				).catch(() => {})
			})
			observer.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ["class"],
			})
			if (panel.current !== null)
				observer.observe(panel.current, {
					attributes: true,
					attributeFilter: ["data-mode"],
				})
			yield* Effect.addFinalizer(() => Effect.sync(() => observer.disconnect()))
			while (true) {
				const status = yield* mounted.state
				setState(status._tag === "Failed" ? status.issue : status._tag)
				yield* Effect.sleep("250 millis")
			}
		}).pipe(
			Effect.provideService(Scope.Scope, scope),
			Effect.provide(
				Layer.mergeAll(AppUi.layer, AppConnections.layerConnectionScopes),
			),
		)
		void Effect.runPromise(program, { signal: controller.signal }).catch(() => {
			if (!controller.signal.aborted) setState("Unavailable")
		})
		return () => {
			controller.abort()
			readController.current?.abort()
			void Effect.runPromise(Scope.close(scope, Exit.void))
			closeTimer.current = setTimeout(() => {
				closeTimer.current = null
				void client
					.featureCall("appViews.close", { params: { viewId: opened.id } })
					.catch(() => {})
			}, 0)
		}
	}, [client, owner, opened.id, closed])
	const close = () => {
		pending?.reply(false)
		setClosed(true)
		callbacks.current.onClose?.()
	}
	if (closed) return <p>{t`App interface closed.`}</p>
	return (
		<section
			ref={panel}
			className="app-view next-app-interface next-detail"
			data-mode={mode}
			data-mascot-boundary={mode === "fullscreen" ? "surface" : undefined}
			aria-label={t`App interface`}
			onKeyDown={(event) => {
				if (event.key === "Escape" && pending === null) {
					event.stopPropagation()
					setMode("inline")
				}
			}}
		>
			<div className="app-view-toolbar">
				<span>
					{mode === "fullscreen" && (
						<Anchor placement="header" className="next-surface-mascot" />
					)}
					{opened.source.appName} · {opened.source.connectionName}
				</span>
				<span role="status">{state}</span>
				{mode === "fullscreen" && (
					<Button
						variant="ghost"
						onClick={() => setMode("inline")}
					>{t`Exit full screen`}</Button>
				)}
				<Button
					variant="ghost"
					onClick={close}
				>{t`Close App interface`}</Button>
			</div>
			{opened.readOnly && <p>{t`This App interface is read-only.`}</p>}
			{operation !== null && (
				<div>
					<p role="status">
						{operation.status} · <code>{operation.requestId}</code>
					</p>
					<Button
						variant="outline"
						disabled={reading}
						onClick={() => {
							const controller = new AbortController()
							readController.current?.abort()
							readController.current = controller
							setReading(true)
							void client
								.featureCall(
									"appViews.operation",
									{
										params: {
											viewId: opened.id,
											requestId: operation.requestId,
										},
									},
									controller.signal,
								)
								.then((result) => {
									if (controller.signal.aborted) return
									setObserved(result)
									const status = objectOf(result)["status"]
									if (typeof status === "string")
										setOperation({ ...operation, status })
								})
								.catch(() => {
									if (!controller.signal.aborted) setState("Unavailable")
								})
								.finally(() => {
									if (!controller.signal.aborted) setReading(false)
								})
						}}
					>{t`Read saved operation`}</Button>
					{observed !== null && (
						<details>
							<summary>{t`Operation result`}</summary>
							<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">
								{JSON.stringify(observed, null, 2)}
							</pre>
						</details>
					)}
				</div>
			)}
			{unknown && (
				<p role="alert">{t`The App operation outcome is unknown. Review saved operations before using this App again.`}</p>
			)}
			{error !== null && <p role="alert">{error}</p>}
			<div ref={container} className="app-view-frame" />
			<Surface
				open={pending !== null}
				onOpenChange={(open) => {
					if (!open) pending?.reply(false)
				}}
				title={pending?.title ?? ""}
				titleLeading={
					<Anchor placement="header" className="next-surface-mascot" />
				}
				description={
					opened.source.appName + " / " + opened.source.connectionName
				}
			>
				<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">
					{JSON.stringify(pending?.value, null, 2)}
				</pre>
				<div className="flex justify-end gap-2">
					<Button
						variant="outline"
						onClick={() => pending?.reply(false)}
					>{t`Cancel`}</Button>
					<Button onClick={() => pending?.reply(true)}>{t`Confirm`}</Button>
				</div>
			</Surface>
		</section>
	)
}
