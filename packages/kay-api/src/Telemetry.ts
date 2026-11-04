/** Bounded process-local operational counters. No account, message, token or URL labels. */
export const makeTelemetry = (options?: {
	readonly onObservation?: (name: string, value: number) => void
}) => {
	const counters = new Map<string, number>()
	const samples = new Map<string, number[]>()
	const increment = (name: string) =>
		counters.set(name, (counters.get(name) ?? 0) + 1)
	const observe = (name: string, value: number) => {
		const values = samples.get(name) ?? []
		if (values.length === 1024) values.shift()
		values.push(value)
		samples.set(name, values)
		try {
			options?.onObservation?.(name, value)
		} catch {
			// An observer must never interrupt a request or its response stream.
		}
	}
	const snapshot = () => ({
		since: started,
		counters: Object.fromEntries(counters),
		latency: Object.fromEntries(
			[...samples].map(([name, values]) => {
				const sorted = [...values].sort((a, b) => a - b)
				return [
					name,
					{
						count: values.length,
						p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
						p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
					},
				]
			}),
		),
	})
	const started = new Date().toISOString()
	const stream = (startedAt: number) => {
		let tail = "",
			seen = false
		const decoder = new TextDecoder()
		return (chunk: Uint8Array) => {
			if (seen) return
			const text = tail + decoder.decode(chunk, { stream: true })
			if (/(?:^|\n)event:\s*response\.output_text\.delta(?:\r?\n)/.test(text)) {
				seen = true
				increment("turn_first_text")
				observe("turn_first_text_ms", performance.now() - startedAt)
			}
			// Only retain a possible event-header fragment, never a message payload.
			const end = text.slice(text.lastIndexOf("\n") + 1)
			tail =
				end.startsWith("event:") || "event:".startsWith(end)
					? end.slice(0, 128)
					: ""
		}
	}
	return { increment, observe, snapshot, stream }
}
export type Telemetry = ReturnType<typeof makeTelemetry>
