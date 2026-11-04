import { make } from "@kaicom/kay-contracts/Client"
import { nativeRuntime } from "./runtime.ts"

/** A native shell keeps credentials in its transport. Browsers use their session cookie. */
export const createProductClient = () => {
	const native = nativeRuntime()
	return make(native === undefined ? {} : {
		baseUrl: `${native.apiOrigin}/api/kay/v1`,
		fetch: native.fetch,
	})
}
