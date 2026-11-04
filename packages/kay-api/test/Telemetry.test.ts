import { test } from "node:test"
import assert from "node:assert/strict"
import { makeTelemetry } from "../src/Telemetry.ts"

test("stream measurements survive split headers and keep message content out of bounded metrics", () => {
	const telemetry = makeTelemetry(),
		stream = telemetry.stream(performance.now() - 10),
		encoder = new TextEncoder()
	stream(
		encoder.encode(
			'event: response.created\ndata: {"secret":"private"}\n\nevent: response.output_',
		),
	)
	assert.equal(telemetry.snapshot().counters["turn_first_text"], undefined)
	stream(encoder.encode('text.delta\ndata: {"delta":"private"}\n\n'))
	stream(encoder.encode("event: response.output_text.delta\ndata: {}\n\n"))
	const snapshot = telemetry.snapshot()
	assert.equal(snapshot.counters["turn_first_text"], 1)
	assert.ok((snapshot.latency["turn_first_text_ms"]?.p95 ?? 0) >= 10)
	assert.equal(JSON.stringify(snapshot).includes("private"), false)
	for (let i = 0; i < 2000; i++) telemetry.observe("request_ms", i)
	assert.equal(telemetry.snapshot().latency["request_ms"]?.count, 1024)
})

test("numeric observers see stream milestones and cannot interrupt delivery", () => {
	const observations: Array<[string, number]> = []
	const telemetry = makeTelemetry({
		onObservation: (name, value) => {
			observations.push([name, value])
			throw new Error("Observer unavailable")
		},
	})
	telemetry.observe("auth_session_ms", 5)
	const stream = telemetry.stream(performance.now() - 10)
	stream(
		new TextEncoder().encode("event: response.output_text.delta\ndata: {}\n\n"),
	)
	assert.deepEqual(observations[0], ["auth_session_ms", 5])
	assert.equal(observations[1]?.[0], "turn_first_text_ms")
	assert.equal(telemetry.snapshot().counters["turn_first_text"], 1)
})
