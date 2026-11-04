import { request } from "node:http"

export interface BasicComputeBrokerClient {
	readonly health: () => Promise<void>
	readonly wake: (starting?: {
		readonly accountId: string
		readonly organizationId: string
	}) => Promise<void>
	readonly release: (owner: {
		readonly accountId: string
		readonly organizationId: string
		readonly maxGeneration: number
	}) => Promise<void>
}

/** Only an operator-configured Unix socket is accepted. No browser controls the target. */
export const makeBasicComputeBrokerClient = (
	socketPath: string,
): BasicComputeBrokerClient => {
	if (!socketPath.startsWith("/") || socketPath.includes("\0"))
		throw new Error("Use an absolute compute broker socket path.")
	const call = (path: string, payload: unknown = {}) =>
		new Promise<void>((resolve, reject) => {
			const data = JSON.stringify(payload)
			const req = request(
				{
					socketPath,
					path,
					method: "POST",
					headers: {
						"content-type": "application/json",
						"content-length": Buffer.byteLength(data),
					},
					timeout: 10000,
				},
				(res) => {
					res.resume()
					res.on("end", () =>
						res.statusCode === 204
							? resolve()
							: reject(
									new Error("The compute broker could not finish the request."),
								),
					)
				},
			)
			req.on("timeout", () =>
				req.destroy(new Error("The compute broker did not respond.")),
			)
			req.on("error", () =>
				reject(new Error("The compute broker is unavailable.")),
			)
			req.end(data)
		})
	return {
		health: () => call("/health"),
		wake: (starting) =>
			call("/wake", starting === undefined ? {} : { starting }),
		release: (owner) => call("/release", owner),
	}
}
