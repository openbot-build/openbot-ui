import { objectOf } from "./SchemaValues.ts"

export interface Terminal {
	readonly computerId: string
	readonly sessionId: string | null
	readonly running: boolean | null
	readonly output: string
	readonly exitCode: number | null
	readonly truncated: boolean
}
export const restoreTerminalSessions = ({
	saved,
	current,
}: {
	readonly saved: Readonly<Record<string, unknown>>
	readonly current: Readonly<Record<string, Terminal>>
}): Readonly<Record<string, Terminal>> => ({
	...Object.fromEntries(
		Object.entries(current).filter(
			([, terminal]) => terminal.running === false,
		),
	),
	...Object.fromEntries(
		Object.entries(saved).flatMap(([computerId, sessionId]) =>
			typeof sessionId !== "string"
				? []
				: [
						[
							computerId,
							current[computerId]?.sessionId === sessionId
								? current[computerId]
								: ({
										computerId,
										sessionId,
										running: null,
										output: "",
										exitCode: null,
										truncated: false,
									} satisfies Terminal),
						],
					],
		),
	),
})
export const terminalResult = ({
	computerId,
	previous,
	value,
}: {
	readonly computerId: string
	readonly previous?: Terminal
	readonly value: unknown
}): Terminal => {
	const record = objectOf(value)
	if (
		typeof record["output"] !== "string" ||
		typeof record["running"] !== "boolean"
	)
		throw new Error("The computer returned an invalid terminal response.")
	return {
		computerId,
		sessionId:
			typeof record["session"] === "string"
				? record["session"]
				: (previous?.sessionId ?? null),
		running: record["running"],
		output: (previous?.output ?? "") + record["output"],
		exitCode:
			typeof record["exitCode"] === "number" ? record["exitCode"] : null,
		truncated: record["truncated"] === true || previous?.truncated === true,
	}
}
export interface Screenshot {
	readonly url: string
	readonly width: number
	readonly height: number
}
export const screenshotFrom = (value: unknown): Screenshot => {
	const record = objectOf(value),
		data = record["data"],
		width = record["width"],
		height = record["height"]
	if (
		record["mediaType"] !== "image/png" ||
		typeof data !== "string" ||
		!/^[A-Za-z0-9+/=\r\n]+$/.test(data) ||
		typeof width !== "number" ||
		typeof height !== "number" ||
		width <= 0 ||
		height <= 0
	)
		throw new Error("The computer returned an invalid screenshot.")
	return { url: "data:image/png;base64," + data, width, height }
}
export const desktopPoint = ({
	x,
	y,
	left,
	top,
	width,
	height,
	screenshot,
}: {
	readonly x: number
	readonly y: number
	readonly left: number
	readonly top: number
	readonly width: number
	readonly height: number
	readonly screenshot: Screenshot
}) => ({
	x: Math.max(
		0,
		Math.min(
			screenshot.width - 1,
			Math.round(((x - left) * screenshot.width) / width),
		),
	),
	y: Math.max(
		0,
		Math.min(
			screenshot.height - 1,
			Math.round(((y - top) * screenshot.height) / height),
		),
	),
})
