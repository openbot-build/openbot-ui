/** Owns resources acquired asynchronously for one connection attempt. */
export class ConnectionLifetime {
	private generation = 0
	private readonly resources = new Set<() => void>()
	begin(): number {
		this.close()
		return this.generation
	}
	current(generation: number): boolean {
		return generation === this.generation
	}
	track(generation: number, release: () => void): void {
		if (this.current(generation)) this.resources.add(release)
		else release()
	}
	close(): void {
		this.generation++
		for (const release of this.resources) release()
		this.resources.clear()
	}
}

export type CreationReceipt = {
	readonly phase: "idle" | "pending" | "unknown" | "known"
	readonly chatId: string
}
/** Native Live creation is not idempotent. An uncertain receipt must be resolved by reading history. */
export class LiveCreation {
	private receipt: CreationReceipt
	constructor(saved?: CreationReceipt) {
		this.receipt =
			saved?.phase === "known" && saved.chatId !== ""
				? saved
				: saved?.phase === "pending" || saved?.phase === "unknown"
					? { phase: "unknown", chatId: "" }
					: { phase: "idle", chatId: "" }
	}
	get snapshot(): CreationReceipt {
		return this.receipt
	}
	begin(): void {
		if (this.receipt.phase === "pending" || this.receipt.phase === "unknown")
			throw new Error(
				"Read the saved voice conversations before creating another.",
			)
		this.receipt = { phase: "pending", chatId: "" }
	}
	complete(chatId: string): void {
		if (chatId === "")
			throw new Error("A saved voice conversation needs an ID.")
		this.receipt = { phase: "known", chatId }
	}
	fail(uncertain: boolean): void {
		this.receipt = { phase: uncertain ? "unknown" : "idle", chatId: "" }
	}
	clear(): void {
		if (this.receipt.phase === "known")
			this.receipt = { phase: "idle", chatId: "" }
	}
}
