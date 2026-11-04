/** A key identifies one explicit command; observing it never creates another key. */
export const commandPayload = (input: unknown): unknown => {
	if (input === undefined) return { commandKey: crypto.randomUUID() }
	if (input === null || typeof input !== "object" || Array.isArray(input))
		return input
	return "commandKey" in input
		? input
		: { ...input, commandKey: crypto.randomUUID() }
}
