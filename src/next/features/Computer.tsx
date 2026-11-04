import { useEffect, useRef, useState } from "react"
import { t } from "@lingui/core/macro"
import type { Client } from "@kaicom/kay-contracts/Client"
import { RequestFailed } from "@kaicom/kay-contracts/Client"
import type { Bootstrap } from "@kaicom/kay-contracts"
import type { Schema } from "effect"
import { Button } from "../../components/ui/button"
import { objectOf, type JsonObject } from "./SchemaValues"
import { rowsOf, safeLink } from "./FeatureData"
import {
	terminalResult,
	restoreTerminalSessions,
	screenshotFrom,
	desktopPoint,
	type Terminal,
	type Screenshot,
} from "./ComputerModel"
import "./Computer.css"
import type { WorkspaceComputer } from "./ComputersData"
import {
	computerCommandKey,
	readComputerCommand,
	startComputerCommand,
	finishComputerCommand,
	canReconcileComputerCommand,
	type PendingCommand,
} from "./ComputerCommands"

export function Computer({
	client,
	bootstrap,
	selected,
	pane = "terminal",
	interactive = true,
}: {
	readonly client: Client
	readonly bootstrap: Bootstrap
	readonly selected?: WorkspaceComputer | undefined
	readonly pane?: "terminal" | "desktop"
	readonly interactive?: boolean
}) {
	const [computers, setComputers] = useState<ReadonlyArray<JsonObject>>([])
	const [computerId, setComputerId] = useState("")
	const [terminals, setTerminals] = useState<
		Readonly<Record<string, Terminal>>
	>({})
	const [screenshots, setScreenshots] = useState<
		Readonly<Record<string, Screenshot>>
	>({})
	const [links, setLinks] = useState<Readonly<Record<string, string>>>({})
	const [command, setCommand] = useState("")
	const [cwd, setCwd] = useState("")
	const [input, setInput] = useState("")
	const [rows, setRows] = useState(30)
	const [cols, setCols] = useState(100)
	const [desktopText, setDesktopText] = useState("")
	const [keys, setKeys] = useState("Enter")
	const [clicks, setClicks] = useState(false)
	const [busy, setBusy] = useState(false)
	const [pending, setPending] = useState<PendingCommand | null>(null)
	const [storageReady, setStorageReady] = useState(false)
	const unknown = pending !== null || !storageReady
	const [error, setError] = useState<unknown>(null)
	const lock = useRef(false),
		mounted = useRef(true)
	const storageKey =
		"kay:computer-sessions:" +
		bootstrap.identity.organizationId +
		":" +
		bootstrap.identity.userId
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const refresh = async () => {
		if (selected !== undefined) {
			setComputers([selected])
			setComputerId(selected.id)
			return
		}
		const value = await client.featureCall("computers.listComputers")
		if (!mounted.current) return
		const list = rowsOf(value).map(objectOf)
		setComputers(list)
		setComputerId((current) =>
			list.some((item) => item["id"] === current)
				? current
				: typeof list[0]?.["id"] === "string"
					? list[0]["id"]
					: "",
		)
	}
	useEffect(() => {
		const syncSessions = () => {
			try {
				const saved = objectOf(
					JSON.parse(localStorage.getItem(storageKey) ?? "{}"),
				)
				setTerminals((current) => restoreTerminalSessions({ saved, current }))
			} catch {
				/* Direct controls stay disabled if their status cannot be stored. */
			}
		}
		syncSessions()
		window.addEventListener("storage", syncSessions)
		window.addEventListener("kay-computer-command", syncSessions)
		void refresh().catch(setError)
		return () => {
			window.removeEventListener("storage", syncSessions)
			window.removeEventListener("kay-computer-command", syncSessions)
		}
	}, [storageKey])

	const commandKey = computerCommandKey({
		organization: bootstrap.identity.organizationId,
		user: bootstrap.identity.userId,
		computer: computerId,
	})
	const notifyCommands = () =>
		window.dispatchEvent(new Event("kay-computer-command"))
	useEffect(() => {
		const sync = () => {
			try {
				setPending(
					readComputerCommand({ storage: localStorage, key: commandKey }),
				)
				setStorageReady(true)
			} catch {
				setStorageReady(false)
				setError(
					new Error(
						t`This browser could not save the command status. Allow browser storage before using direct controls.`,
					),
				)
			}
		}
		sync()
		window.addEventListener("storage", sync)
		window.addEventListener("kay-computer-command", sync)
		return () => {
			window.removeEventListener("storage", sync)
			window.removeEventListener("kay-computer-command", sync)
		}
	}, [commandKey])
	const mutate = async (
		work: () => Promise<unknown>,
		kind: "terminal" | "desktop",
		sessionId: string | null = null,
	) => {
		if (lock.current) return
		if (navigator.locks === undefined) {
			setError(
				new Error(
					t`This browser cannot safely coordinate direct controls across tabs. Open this workspace in an up-to-date browser.`,
				),
			)
			return
		}
		await navigator.locks.request(
			commandKey,
			{ ifAvailable: true },
			async (browserLock) => {
				if (browserLock === null || lock.current) return
				const token = crypto.randomUUID()
				let started = false
				try {
					started = startComputerCommand({
						storage: localStorage,
						key: commandKey,
						command: { token, kind, sessionId },
					})
				} catch {
					setError(
						new Error(
							t`This browser could not save the command status. Allow browser storage before using direct controls.`,
						),
					)
					return
				}
				if (!started) return
				notifyCommands()
				const finish = () => {
					finishComputerCommand({
						storage: localStorage,
						key: commandKey,
						token,
					})
					notifyCommands()
				}
				await run(async () => {
					try {
						await work()
						finish()
					} catch (failure) {
						if (
							failure instanceof RequestFailed &&
							failure.problem.code !== "outcome_unknown"
						)
							finish()
						throw failure
					}
				})
			},
		)
	}
	const run = async (work: () => Promise<unknown>) => {
		if (lock.current) return
		lock.current = true
		setBusy(true)
		setError(null)
		try {
			await work()
		} catch (failure) {
			if (mounted.current) {
				setError(failure)
			}
		} finally {
			lock.current = false
			if (mounted.current) setBusy(false)
		}
	}
	const terminal = terminals[computerId]
	const screenshot = screenshots[computerId]
	const computer = computers.find((item) => item["id"] === computerId)
	const applyTerminal = (id: string, value: unknown, fresh = false) => {
		const result = terminalResult({ computerId: id, value })
		const mergedSession =
			result.sessionId ?? (fresh ? null : (terminals[id]?.sessionId ?? null))
		try {
			const key = computerCommandKey({
				organization: bootstrap.identity.organizationId,
				user: bootstrap.identity.userId,
				computer: id,
			})
			const saved = readComputerCommand({ storage: localStorage, key })
			if (
				saved !== null &&
				canReconcileComputerCommand({
					command: saved,
					sessionId: mergedSession,
					running: result.running,
				})
			) {
				finishComputerCommand({
					storage: localStorage,
					key,
					token: saved.token,
				})
				notifyCommands()
			}
			if (mergedSession !== null || fresh) {
				const previous = objectOf(
					JSON.parse(localStorage.getItem(storageKey) ?? "{}"),
				)
				const sessions = Object.fromEntries(
					Object.entries(previous).filter(([key]) => key !== id),
				)
				localStorage.setItem(
					storageKey,
					JSON.stringify({
						...sessions,
						...(mergedSession === null ? {} : { [id]: mergedSession }),
					}),
				)
			}
		} catch {
			/* A failed status save does not authorize a command to be sent again. */
		}
		if (mounted.current)
			setTerminals((current) => {
				const previous = fresh ? undefined : current[id]
				return {
					...current,
					[id]: {
						...result,
						sessionId: result.sessionId ?? previous?.sessionId ?? null,
						output: (previous?.output ?? "") + result.output,
						truncated: result.truncated || previous?.truncated === true,
					},
				}
			})
	}
	const sessionAction = (operation: string, payload?: Schema.Json) => {
		if (terminal?.sessionId === null || terminal === undefined) return
		const id = computerId,
			sessionId = terminal.sessionId
		const readOnly =
			operation === "computers.writeStdin" && objectOf(payload)["chars"] === ""
		const work = async () => {
			const result = await client.featureCall(operation, {
				params: { computerId: id, sessionId },
				...(payload === undefined ? {} : { payload }),
			})
			if (operation !== "computers.resizeSession") applyTerminal(id, result)
		}
		if (readOnly) void run(work)
		else void mutate(work, "terminal", sessionId)
	}
	useEffect(() => {
		if (computerId === "" || pending?.kind === "desktop") return
		const sessionId = pending === null ? terminal?.sessionId : pending.sessionId
		if (sessionId == null || (pending === null && terminal?.running === false))
			return
		let stopped = false
		const poll = async () => {
			if (stopped || lock.current) return
			await run(async () => {
				const value = await client.featureCall("computers.writeStdin", {
					params: { computerId, sessionId },
					payload: { chars: "", yieldTimeMs: 1000, maxOutputBytes: 65536 },
				})
				if (!stopped) applyTerminal(computerId, value)
			})
		}
		void poll()
		const timer = window.setInterval(() => void poll(), 3000)
		return () => {
			stopped = true
			window.clearInterval(timer)
		}
	}, [pending?.token, computerId, terminal?.sessionId, terminal?.running])
	const showScreenshot = (id: string, value: unknown) => {
		const next = screenshotFrom(value)
		if (mounted.current)
			setScreenshots((current) => ({ ...current, [id]: next }))
	}
	const desktopAction = (action: Schema.JsonObject) => {
		if (computerId === "" || unknown) return
		const id = computerId
		void mutate(
			async () =>
				showScreenshot(
					id,
					await client.featureCall("computers.useDesktop", {
						params: { computerId: id },
						payload: { actions: [action] },
					}),
				),
			"desktop",
		)
	}
	return (
		<section className="feature-command feature-computer">
			{selected === undefined && (
				<>
					<h2>{t`Computer workspace`}</h2>
					<label className="feature-field">
						<span>{t`Computer`}</span>
						<select
							value={computerId}
							onChange={(event) => {
								setComputerId(event.target.value)
								setClicks(false)
							}}
						>
							<option value="">{t`Choose…`}</option>
							{computers.map((item) => (
								<option key={String(item["id"])} value={String(item["id"])}>
									{String(item["name"])} · {String(item["state"])}
								</option>
							))}
						</select>
					</label>
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => {
							void run(refresh)
						}}
					>{t`Refresh`}</Button>
				</>
			)}
			{error !== null && (
				<p role="alert" className="feature-error">
					{error instanceof Error
						? error.message
						: t`This request could not be completed.`}
				</p>
			)}
			{pending !== null && !busy && (
				<div className="feature-error">
					<p>
						{pending.kind === "terminal" && pending.sessionId !== null
							? t`Checking the previous command. Its output will update automatically; no command will be sent again.`
							: t`The previous action has not returned a confirmed result. Direct controls are paused for this computer. Ask your administrator to check it; refreshing or switching pages will not send the action again.`}
					</p>
				</div>
			)}
			{computer !== undefined && (
				<>
					{pane === "terminal" && (
						<>
							<h3>{t`Terminal`}</h3>
							<p className="computer-panel-description">{t`Run a command when you need direct control. For everyday work, describe your task to Kay.`}</p>
							<form
								onSubmit={(event) => {
									event.preventDefault()
									if (
										command.trim() === "" ||
										unknown ||
										(terminal !== undefined && terminal.running !== false)
									)
										return
									const id = computerId
									void mutate(
										async () =>
											applyTerminal(
												id,
												await client.featureCall("computers.exec", {
													params: { computerId: id },
													payload: {
														command,
														tty: interactive,
														...(interactive ? { rows, cols } : {}),
														yieldTimeMs: 1000,
														maxOutputBytes: 65536,
														...(cwd.trim() === "" ? {} : { cwd: cwd.trim() }),
													},
												}),
												true,
											),
										"terminal",
									)
								}}
							>
								<label className="feature-field">
									<span>{t`Command`}</span>
									<textarea
										required
										value={command}
										rows={3}
										placeholder={t`Enter a command…`}
										onChange={(event) => setCommand(event.target.value)}
									/>
								</label>
								<details className="computer-advanced">
									<summary>{t`Command options`}</summary>
									<label className="feature-field">
										<span>{t`Working directory`}</span>
										<input
											value={cwd}
											onChange={(event) => setCwd(event.target.value)}
										/>
									</label>
								</details>
								<Button
									type="submit"
									disabled={
										busy ||
										unknown ||
										command.trim() === "" ||
										(terminal !== undefined && terminal.running !== false)
									}
								>{t`Run command`}</Button>
							</form>
							{terminal !== undefined && (
								<>
									<p>
										{terminal.running === true
											? t`Running`
											: terminal.running === null
												? t`Read output to check status`
												: t`Completed`}{" "}
										{terminal.exitCode !== null ? `(${terminal.exitCode})` : ""}
									</p>
									<pre
										className="feature-computer-output"
										aria-label={t`Terminal output`}
									>
										{terminal.output}
									</pre>
									{terminal.truncated && (
										<p>{t`Some output was truncated by the computer.`}</p>
									)}
									{terminal.sessionId !== null &&
										terminal.running !== false && (
											<>
												<div className="feature-toolbar">
													<Button
														variant="outline"
														disabled={busy || terminal.sessionId === null}
														onClick={() =>
															sessionAction("computers.writeStdin", {
																chars: "",
																yieldTimeMs: 1000,
																maxOutputBytes: 65536,
															})
														}
													>{t`Read output`}</Button>
													<Button
														variant="outline"
														disabled={
															busy || unknown || terminal.sessionId === null
														}
														onClick={() =>
															sessionAction("computers.closeSession")
														}
													>{t`Stop command`}</Button>
												</div>
												{interactive && (
													<>
														<form
															onSubmit={(event) => {
																event.preventDefault()
																sessionAction("computers.writeStdin", {
																	chars: input,
																	yieldTimeMs: 1000,
																	maxOutputBytes: 65536,
																})
															}}
														>
															<label className="feature-field">
																<span>{t`Terminal input`}</span>
																<textarea
																	rows={2}
																	value={input}
																	onChange={(event) =>
																		setInput(event.target.value)
																	}
																/>
															</label>
															<Button
																type="submit"
																disabled={
																	busy || unknown || terminal.sessionId === null
																}
															>{t`Send input`}</Button>
															<Button
																type="button"
																variant="outline"
																disabled={
																	busy || unknown || terminal.sessionId === null
																}
																onClick={() =>
																	sessionAction("computers.writeStdin", {
																		chars: input + "\n",
																		yieldTimeMs: 1000,
																		maxOutputBytes: 65536,
																	})
																}
															>{t`Send with Enter`}</Button>
														</form>
														<details className="computer-advanced">
															<summary>{t`Terminal size`}</summary>
															<div className="feature-toolbar">
																<label>
																	{t`Rows`}
																	<input
																		type="number"
																		min={1}
																		max={1000}
																		value={rows}
																		onChange={(event) =>
																			setRows(Number(event.target.value))
																		}
																	/>
																</label>
																<label>
																	{t`Columns`}
																	<input
																		type="number"
																		min={1}
																		max={1000}
																		value={cols}
																		onChange={(event) =>
																			setCols(Number(event.target.value))
																		}
																	/>
																</label>
																<Button
																	variant="outline"
																	disabled={
																		busy ||
																		unknown ||
																		terminal.sessionId === null
																	}
																	onClick={() =>
																		sessionAction("computers.resizeSession", {
																			rows,
																			cols,
																		})
																	}
																>{t`Resize terminal`}</Button>
															</div>
														</details>
													</>
												)}
											</>
										)}
								</>
							)}
						</>
					)}
					{pane === "desktop" &&
						objectOf(computer["features"])["desktop"] === true && (
							<>
								<h3>{t`Desktop`}</h3>
								<div className="feature-toolbar">
									<Button
										variant="outline"
										disabled={busy}
										onClick={() => {
											const id = computerId
											void run(async () =>
												showScreenshot(
													id,
													await client.featureCall("computers.takeScreenshot", {
														params: { computerId: id },
													}),
												),
											)
										}}
									>{t`Take screenshot`}</Button>
									<Button
										variant="outline"
										disabled={busy}
										onClick={() => {
											const id = computerId
											void run(async () => {
												const result = objectOf(
													await client.featureCall("computers.streamDesktop", {
														params: { computerId: id },
													}),
												)
												const url = safeLink(result["url"])
												if (url === undefined)
													throw new Error(
														t`The computer did not return a valid desktop address.`,
													)
												if (mounted.current)
													setLinks((current) => ({ ...current, [id]: url }))
											})
										}}
									>{t`Get desktop link`}</Button>
									{links[computerId] !== undefined && (
										<a
											href={links[computerId]}
											target="_blank"
											rel="noopener noreferrer"
										>{t`Open live desktop`}</a>
									)}
								</div>
								{screenshot !== undefined && (
									<>
										<label className="feature-checkbox">
											<input
												type="checkbox"
												checked={clicks}
												onChange={(event) => setClicks(event.target.checked)}
											/>
											{t`Send clicks to the computer`}
										</label>
										<img
											className="feature-computer-screen"
											src={screenshot.url}
											width={screenshot.width}
											height={screenshot.height}
											alt={t`Computer screenshot`}
											onClick={(event) => {
												if (!clicks || busy || unknown) return
												const box = event.currentTarget.getBoundingClientRect()
												const point = desktopPoint({
													x: event.clientX,
													y: event.clientY,
													left: box.left,
													top: box.top,
													width: box.width,
													height: box.height,
													screenshot,
												})
												desktopAction({ _tag: "Click", ...point })
											}}
										/>
									</>
								)}
								<form
									onSubmit={(event) => {
										event.preventDefault()
										desktopAction({ _tag: "Type", text: desktopText })
									}}
								>
									<label className="feature-field">
										<span>{t`Text to type`}</span>
										<textarea
											rows={2}
											value={desktopText}
											onChange={(event) => setDesktopText(event.target.value)}
										/>
									</label>
									<Button
										type="submit"
										disabled={busy || unknown || desktopText === ""}
									>{t`Type on computer`}</Button>
								</form>
								<form
									onSubmit={(event) => {
										event.preventDefault()
										desktopAction({
											_tag: "Key",
											keys: keys
												.split("+")
												.map((key) => key.trim())
												.filter((key) => key !== ""),
										})
									}}
								>
									<label className="feature-field">
										<span>{t`Keys separated by +`}</span>
										<input
											value={keys}
											onChange={(event) => setKeys(event.target.value)}
										/>
									</label>
									<Button
										type="submit"
										disabled={busy || unknown || keys.trim() === ""}
									>{t`Press keys`}</Button>
								</form>
							</>
						)}
				</>
			)}
		</section>
	)
}
