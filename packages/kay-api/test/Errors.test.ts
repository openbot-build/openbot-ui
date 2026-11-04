import assert from "node:assert/strict"
import { test } from "node:test"
import { Schema } from "effect"
import { AuthApi } from "@kaicom/e-platform-api"
import { SessionOperationErrors } from "../../e-platform-api/src/SessionsApi.ts"
import { sessionError } from "../src/compatibility/Errors.ts"

test("native request errors decode in the unchanged Kay SDK and preserve 401 versus 403", () => {
	for (const status of [400, 404, 409, 503]) {
		const result = sessionError({
			status,
			session: "s",
			value: { _tag: "RequestConflict", message: "Changed" },
		})
		assert.doesNotThrow(() =>
			Schema.decodeUnknownSync(Schema.Union(SessionOperationErrors))(result),
		)
	}
	assert.deepEqual(
		Schema.decodeUnknownSync(AuthApi.PermissionDenied)(
			sessionError({ status: 403, session: "s", value: {} }),
		)._tag,
		"PermissionDenied",
	)
	assert.equal(
		Schema.decodeUnknownSync(AuthApi.AuthenticationRequired)(
			sessionError({ status: 401, session: "s", value: {} }),
		)._tag,
		"AuthenticationRequired",
	)
})
