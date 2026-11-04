import { object, type Json } from "./Projection.ts"

/** Preserve the status distinction and the unchanged Kay SDK error union. */
export const sessionError = ({
	status,
	value,
	session,
}: {
	readonly status: number
	readonly value: Json
	readonly session: string
}): Json => {
	const body = object(value),
		message =
			typeof body["message"] === "string"
				? body["message"]
				: "The conversation changed. Read it again before continuing."
	if (status === 401) return { _tag: "AuthenticationRequired" }
	if (status === 403)
		return {
			_tag: "PermissionDenied",
			message: "Your account does not have permission for this action.",
		}
	if (status === 404) return { _tag: "SessionNotFound", session }
	if (status === 409) return { _tag: "SessionConflict", message }
	if (status === 400) return { _tag: "SessionInvalidRecord", message }
	if (status === 503) return { _tag: "SessionStorageUnavailable" }
	return value
}
