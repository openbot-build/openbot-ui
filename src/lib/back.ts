const dismissals = new Set<() => void>()

/** Open surfaces register in order, so Back closes only the top one. */
export function registerBackDismiss(close: () => void): () => void {
	dismissals.add(close)
	return () => { dismissals.delete(close) }
}

export function consumeBackPress(): boolean {
	const close = [...dismissals].at(-1)
	if (!close) return false
	close()
	return true
}
