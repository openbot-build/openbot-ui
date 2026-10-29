/** Accept only an absolute path on this origin, including after browser URL normalization. */
export function safeReturn(value: string | null): string {
	if (
		value === null ||
		!value.startsWith("/") ||
		value.startsWith("//") ||
		/[\\\x00-\x20]/.test(value)
	)
		return "/"
	const url = new URL(value, "https://openbot.example")
	return url.origin === "https://openbot.example"
		? url.pathname + url.search + url.hash
		: "/"
}
