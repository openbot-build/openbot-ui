import assert from "node:assert/strict"
import { test } from "node:test"
import { assertPerformance, compareLatency } from "./Performance.ts"

const samples = (value: number) => Array.from({ length: 40 }, () => value)
const read = compareLatency(samples(5), samples(10))

test("identical bimodal TTFT distributions do not regress when their order changes", () => {
	const direct = [...samples(50).slice(0, 20), ...samples(400).slice(0, 20)]
	const ttft = compareLatency(direct, [...direct].reverse())
	assert.equal(ttft.pairedOverheadP95, 350)
	assert.equal(ttft.p50Regression, 0)
	assert.equal(ttft.p95Regression, 0)
	assert.doesNotThrow(() => assertPerformance({ read, ttft }))
})

test("a uniform 60 ms TTFT regression fails against a 100 ms baseline", () => {
	const ttft = compareLatency(samples(100), samples(160))
	assert.throws(() => assertPerformance({ read, ttft }), /TTFT p50 regression/)
})

test("a tail-only TTFT regression fails even when the median is unchanged", () => {
	const ttft = compareLatency(samples(100), [
		...samples(100).slice(0, 37),
		160,
		160,
		160,
	])
	assert.equal(ttft.p50Regression, 0)
	assert.throws(() => assertPerformance({ read, ttft }), /TTFT p95 regression/)
})

test("a median TTFT regression fails even when the tail is unchanged", () => {
	const direct = [...samples(100).slice(0, 37), 1000, 1000, 1000]
	const gateway = [...samples(160).slice(0, 37), 1000, 1000, 1000]
	const ttft = compareLatency(direct, gateway)
	assert.equal(ttft.p95Regression, 0)
	assert.throws(() => assertPerformance({ read, ttft }), /TTFT p50 regression/)
})

test("the 50 ms TTFT boundary is inclusive", () => {
	assert.doesNotThrow(() =>
		assertPerformance({
			read,
			ttft: compareLatency(samples(100), samples(150)),
		}),
	)
	assert.throws(
		() =>
			assertPerformance({
				read,
				ttft: compareLatency(samples(100), samples(150.001)),
			}),
		/TTFT p50 regression/,
	)
})

test("the 10 percent allowance uses each matching baseline percentile", () => {
	assert.doesNotThrow(() =>
		assertPerformance({
			read,
			ttft: compareLatency(samples(1000), samples(1060)),
		}),
	)
	assert.doesNotThrow(() =>
		assertPerformance({
			read,
			ttft: compareLatency(samples(1000), samples(1100)),
		}),
	)
	assert.throws(
		() =>
			assertPerformance({
				read,
				ttft: compareLatency(samples(1000), samples(1100.001)),
			}),
		/TTFT p50 regression/,
	)
	const direct = [...samples(100).slice(0, 37), 1000, 1000, 1000]
	const atBoundary = [...samples(150).slice(0, 37), 1100, 1100, 1100]
	assert.doesNotThrow(() =>
		assertPerformance({ read, ttft: compareLatency(direct, atBoundary) }),
	)
	assert.throws(
		() =>
			assertPerformance({
				read,
				ttft: compareLatency(direct, [
					...samples(150).slice(0, 37),
					1100.001,
					1100.001,
					1100.001,
				]),
			}),
		/TTFT p95 regression/,
	)
})

test("the read gate still checks paired p95 and includes the 50 ms boundary", () => {
	const ttft = compareLatency(samples(100), samples(100))
	assert.doesNotThrow(() =>
		assertPerformance({ read: compareLatency(samples(5), samples(55)), ttft }),
	)
	assert.throws(
		() =>
			assertPerformance({
				read: compareLatency(samples(5), samples(55.001)),
				ttft,
			}),
		/read paired p95/,
	)
})

test("invalid or mismatched latency samples cannot satisfy the gate", () => {
	assert.throws(() => compareLatency([], []), /non-empty pairs/)
	assert.throws(() => compareLatency([1], [1, 2]), /non-empty pairs/)
	for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1])
		assert.throws(() => compareLatency([1], [value]), /finite non-negative/)
})
