/** These changes belong to the managed workspace workflow, not generic device controls. */
export const basicComputeManagedOperation = (id: string) =>
	new Set([
		"computers.updateComputer",
		"computers.deleteComputer",
		"computers.grantComputer",
		"computers.revokeComputer",
		"computers.setConnectorToken",
		"computers.pauseComputer",
		"computers.resumeComputer",
	]).has(id)

export const basicComputeManagedPath = (input: {
	readonly path: string
	readonly method: string
}): string | null => {
	const match = /^\/v1\/computers\/([^/]+)(.*)$/.exec(input.path)
	if (match === null || input.method === "GET" || input.method === "HEAD")
		return null
	const suffix = match[2]
	return suffix === "" ||
		suffix === "/connector-token" ||
		suffix === "/pause" ||
		suffix === "/resume" ||
		suffix?.startsWith("/bots/") === true
		? decodeURIComponent(match[1]!)
		: null
}
