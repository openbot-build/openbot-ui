import { Schema } from "effect"

const FileInvalid = Schema.TaggedStruct("FileInvalid", {
	message: Schema.String,
})
const FileQuotaExceeded = Schema.TaggedStruct("FileQuotaExceeded", {
	message: Schema.String,
	quotaBytes: Schema.Natural,
	usedBytes: Schema.Natural,
})
const uploadOperations = new Set([
	"files.uploadFile",
	"files.createUpload",
	"files.completeUpload",
])
const publicInvalidMessages = new Set([
	"The body is not a valid multipart form.",
	"The form has no file in the field `file`.",
	"The file is not ready.",
	"The bytes of the file are not in storage yet.",
])

/** Only upload validation from the native Files contract is safe to expose. */
export const fileValidationMessage = async ({
	operation,
	response,
}: {
	readonly operation: string
	readonly response: Response
}): Promise<string | null> => {
	if (
		!uploadOperations.has(operation) ||
		(response.status !== 400 && response.status !== 413)
	)
		return null
	let body: unknown
	try {
		body = await response.json()
	} catch {
		return null
	}
	if (response.status === 400 && Schema.is(FileInvalid)(body)) {
		const message = body.message
		return publicInvalidMessages.has(message) ||
			/^The file is larger than [0-9]{1,16} bytes\.$/u.test(message) ||
			/^The platform does not take files of type [A-Za-z0-9!#$&^_.+-]{1,127}\/[A-Za-z0-9!#$&^_.+-]{1,127}\.$/u.test(
				message,
			) ||
			/^The file has [0-9]{1,16} bytes, not [0-9]{1,16}\. Make a new upload\.$/u.test(
				message,
			)
			? message
			: null
	}
	if (response.status === 413 && Schema.is(FileQuotaExceeded)(body)) {
		const match =
			/^You may keep ([0-9]{1,16}) bytes of files\. Your files take ([0-9]{1,16}) bytes now, so a file of ([0-9]{1,16}) bytes does not fit\. Delete some files first\.$/u.exec(
				body.message,
			)
		if (
			match !== null &&
			Number.isSafeInteger(body.quotaBytes) &&
			Number.isSafeInteger(body.usedBytes) &&
			Number(match[1]) === body.quotaBytes &&
			Number(match[2]) === body.usedBytes &&
			Number.isSafeInteger(Number(match[3]))
		)
			return body.message
	}
	return null
}
