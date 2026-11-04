import { nativeRuntime } from "../lib/runtime.ts"

export const requestSignOut = async (baseUrl: string): Promise<void> => {
	const native = nativeRuntime()
	if (native !== undefined) return native.signOut()
	const response = await fetch(new URL("/auth/sign-out", baseUrl), {
		method: "POST",
		credentials: "same-origin",
		headers: { "content-type": "application/json" },
		body: "{}",
	})
	if (!response.ok) throw new Error("Could not sign out. Try again.")
}

/** Only confirmed revocation clears the workspace; transport failures remain visible. */
export async function signOutWorkspace({
	request,
	clear,
	navigate,
}: {
	readonly request: () => Promise<unknown>
	readonly clear: () => void
	readonly navigate: () => void
}): Promise<void> {
	await request()
	clear()
	navigate()
}

export function clearPrivateViewStorage(
	storage: Pick<Storage, "removeItem">,
): void {
	// Account-scoped operation receipts must survive re-login to prevent duplicate writes.
	for (const key of [
		"kay:drafts:v1",
		"kay:surface:v1",
		"kay:reading-position:v1",
	])
		try {
			storage.removeItem(key)
		} catch {
			// Storage may be unavailable; confirmed logout still closes the document.
		}
}
