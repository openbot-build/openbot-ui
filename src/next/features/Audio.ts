/** Resample consecutive mono blocks using an absolute sample index, without phase drift. */
export class PcmEncoder {
	private previous: number | undefined
	private inputSamples = 0
	private outputSamples = 0
	readonly sourceRate: number
	readonly targetRate: number
	constructor(sourceRate: number, targetRate: number) {
		if (
			!Number.isFinite(sourceRate) ||
			!Number.isFinite(targetRate) ||
			sourceRate <= 0 ||
			targetRate <= 0
		)
			throw new Error("Audio sample rates must be positive.")
		this.sourceRate = sourceRate
		this.targetRate = targetRate
	}
	private encode(values: readonly number[]): ArrayBuffer {
		const bytes = new ArrayBuffer(values.length * 2)
		const view = new DataView(bytes)
		values.forEach((sample, index) => {
			const value = Math.max(-1, Math.min(1, sample))
			view.setInt16(
				index * 2,
				Math.round(value * (value < 0 ? 32768 : 32767)),
				true,
			)
		})
		return bytes
	}
	push(samples: Float32Array): ArrayBuffer {
		if (samples.length === 0) return new ArrayBuffer(0)
		const hasPrevious = this.previous !== undefined
		const data = new Float32Array(samples.length + (hasPrevious ? 1 : 0))
		if (hasPrevious) data[0] = this.previous!
		data.set(samples, hasPrevious ? 1 : 0)
		const first = this.inputSamples - (hasPrevious ? 1 : 0)
		this.inputSamples += samples.length
		const last = this.inputSamples - 1
		const output: number[] = []
		while ((this.outputSamples * this.sourceRate) / this.targetRate < last) {
			const position = (this.outputSamples * this.sourceRate) / this.targetRate
			const whole = Math.floor(position),
				fraction = position - whole,
				local = whole - first
			output.push(
				(data[local] ?? 0) * (1 - fraction) + (data[local + 1] ?? 0) * fraction,
			)
			this.outputSamples++
		}
		this.previous = samples[samples.length - 1]
		return this.encode(output)
	}
	/** Finish a push-to-talk block, retaining the final sample. */
	flush(): ArrayBuffer {
		const output: number[] = []
		if (this.previous !== undefined)
			while (
				this.outputSamples * this.sourceRate <
				this.inputSamples * this.targetRate
			) {
				output.push(this.previous)
				this.outputSamples++
			}
		this.previous = undefined
		this.inputSamples = 0
		this.outputSamples = 0
		return this.encode(output)
	}
}

export function decodePcm(bytes: ArrayBuffer): Float32Array<ArrayBuffer> {
	if (bytes.byteLength % 2 !== 0)
		throw new Error("PCM audio has an incomplete sample.")
	const view = new DataView(bytes)
	const output = new Float32Array(bytes.byteLength / 2)
	for (let index = 0; index < output.length; index++)
		output[index] = view.getInt16(index * 2, true) / 32768
	return output
}
