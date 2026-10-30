import { Option } from "effect"
import * as AsyncResult from "effect/reactivity/AsyncResult"

export { cn } from "./cn"

/** The value of a result, or the last value while it loads again. */
export const resultValue = <A, E>(
	result: AsyncResult.AsyncResult<A, E>,
): A | undefined => Option.getOrUndefined(AsyncResult.value(result))

/** True on Apple systems, where shortcuts use the Command key. */
export const isApple = () =>
	/Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "")

/** The name of the main shortcut key on this system. */
export const modKey = () => (isApple() ? "⌘" : "Ctrl")
