// @effect-diagnostics missingPipeableSignature:off
// Test comparisons name both experimental arms explicitly.
import assert from "node:assert/strict"

const percentile = (values: ReadonlyArray<number>, p: number) =>
	[...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]!

export const compareLatency = (
	direct: ReadonlyArray<number>,
	gateway: ReadonlyArray<number>,
) => {
	assert.ok(
		direct.length > 0 && direct.length === gateway.length,
		"Latency samples must form non-empty pairs",
	)
	assert.ok(
		[...direct, ...gateway].every(
			(value) => Number.isFinite(value) && value >= 0,
		),
		"Latency samples must be finite non-negative durations",
	)
	const paired = gateway.map((value, index) => value - direct[index]!)
	const directP50 = percentile(direct, 0.5)
	const directP95 = percentile(direct, 0.95)
	const gatewayP50 = percentile(gateway, 0.5)
	const gatewayP95 = percentile(gateway, 0.95)
	return {
		pairedOverheadP50: percentile(paired, 0.5),
		pairedOverheadP95: percentile(paired, 0.95),
		directP50,
		directP95,
		gatewayP50,
		gatewayP95,
		p50Regression: gatewayP50 - directP50,
		p95Regression: gatewayP95 - directP95,
	}
}

export const assertPerformance = (report: {
	readonly read: ReturnType<typeof compareLatency>
	readonly ttft: ReturnType<typeof compareLatency>
}) => {
	assert.ok(
		report.read.pairedOverheadP95 <= 50,
		"Gateway read paired p95 overhead exceeds 50 ms",
	)
	// Sequential TTFT probes do not share a GC/scheduling event. Compare their
	// endpoint distributions; paired differences remain diagnostic observations.
	assert.ok(
		report.ttft.p50Regression <= Math.max(50, report.ttft.directP50 * 0.1),
		"TTFT p50 regression exceeds 50 ms or 10% of the direct p50 baseline",
	)
	assert.ok(
		report.ttft.p95Regression <= Math.max(50, report.ttft.directP95 * 0.1),
		"TTFT p95 regression exceeds 50 ms or 10% of the direct p95 baseline",
	)
}
