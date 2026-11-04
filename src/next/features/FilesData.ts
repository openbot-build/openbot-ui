import { Schema } from "effect"
import type { Client } from "@kaicom/kay-contracts/Client"
import type * as Product from "@kaicom/kay-contracts"
import type { SavedAttachment } from "../Model"
import { objectOf } from "./SchemaValues.ts"
import { dual } from "effect/Function"

/** File metadata comes from the product boundary, never from a display name. */
export const WorkspaceFile = Schema.Struct({
	id: Schema.String,
	filename: Schema.String,
	mediaType: Schema.String,
	bytes: Schema.Finite,
	status: Schema.Literals(["pending", "ready"]),
	createdAt: Schema.Finite,
})
export type WorkspaceFile = typeof WorkspaceFile.Type

export const FilePage = Schema.Struct({
	items: Schema.Array(WorkspaceFile),
	next: Schema.NullOr(Schema.String),
})

export const fileCategory = (
	file: WorkspaceFile,
): "documents" | "images" | "other" =>
	file.mediaType.startsWith("image/")
		? "images"
		: file.mediaType.startsWith("text/") ||
			  file.mediaType === "application/pdf" ||
			  file.mediaType.includes("document") ||
			  file.mediaType.includes("spreadsheet") ||
			  file.mediaType.includes("presentation")
			? "documents"
			: "other"

export const filePreviewKind = (
	file: WorkspaceFile,
): "image" | "text" | "download" =>
	file.bytes > 10 * 1024 * 1024
		? "download"
		: /^image\/(png|jpeg|webp|gif|avif)$/.test(file.mediaType)
			? "image"
			: file.bytes <= 1024 * 1024 &&
				  (file.mediaType.startsWith("text/") ||
						file.mediaType === "application/json")
				? "text"
				: "download"

export const mergeFiles: {
	(
		current: ReadonlyArray<WorkspaceFile>,
		incoming: ReadonlyArray<WorkspaceFile>,
	): ReadonlyArray<WorkspaceFile>
	(
		incoming: ReadonlyArray<WorkspaceFile>,
	): (current: ReadonlyArray<WorkspaceFile>) => ReadonlyArray<WorkspaceFile>
} = dual(
	2,
	(
		current: ReadonlyArray<WorkspaceFile>,
		incoming: ReadonlyArray<WorkspaceFile>,
	): ReadonlyArray<WorkspaceFile> => [
		...current.filter((file) => !incoming.some((next) => next.id === file.id)),
		...incoming,
	],
)

/** Only stored file references use the authenticated Files API. Remote URLs stay separate. */
export const savedAttachment = (
	part: typeof Product.MessagePart.Type,
): SavedAttachment | null => {
	const details = part.details ?? {}
	if (
		part.type === "tool-result" &&
		details["name"] === "openbot_computer_export_file" &&
		details["isFailure"] !== true
	) {
		const result = objectOf(details["result"])
		const file = result["file"]
		if (
			Schema.is(WorkspaceFile)(file) &&
			objectOf(file)["object"] === "file" &&
			file.status === "ready" &&
			/^[A-Za-z0-9_-]{1,128}$/.test(file.id) &&
			file.filename.length > 0 &&
			file.bytes >= 0 &&
			Number.isSafeInteger(file.bytes) &&
			result["uri"] === "openbot-file:" + file.id
		)
			return { fileId: file.id, name: file.filename }
		return null
	}
	const data = objectOf(details["data"])
	const uri = data["value"]
	const fileId =
		part.type === "input_file" || part.type === "input_image"
			? details["file_id"]
			: (part.type === "file" || part.type === "image") &&
				  data["_tag"] === "Url" &&
				  typeof uri === "string" &&
				  /^openbot-file:[A-Za-z0-9_-]{1,128}$/.test(uri)
				? uri.slice("openbot-file:".length)
				: null
	if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(fileId))
		return null
	const name = details["filename"] ?? details["name"]
	return {
		fileId,
		...(typeof name === "string" && name.length > 0 ? { name } : {}),
	}
}

/** Read saved bytes and their real name; neither step executes work or changes the file. */
export const readSavedFile = async ({
	client,
	fileId,
	signal,
}: {
	readonly client: Pick<Client, "featureCall" | "featureResponse">
	readonly fileId: string
	readonly signal: AbortSignal
}): Promise<{ readonly filename: string; readonly blob: Blob }> => {
	signal.throwIfAborted()
	const input = { params: { fileId } }
	const file = Schema.decodeUnknownSync(WorkspaceFile)(
		await client.featureCall("files.getFile", input, signal),
	)
	signal.throwIfAborted()
	if (file.id !== fileId || file.status !== "ready")
		throw new Error("The saved file is not ready to download.")
	const response = await client.featureResponse(
		"files.getFileContent",
		input,
		signal,
	)
	const blob = await response.blob()
	signal.throwIfAborted()
	return { filename: file.filename, blob }
}

/** Attach a saved file once, without creating a model Turn or retrying a write. */
export const attachSavedFile = async (input: {
	readonly client: Pick<Client, "conversation" | "attachFile">
	readonly chatId: string
	readonly fileId: string
	readonly requestId: string
	readonly signal: AbortSignal
}) => {
	input.signal.throwIfAborted()
	const chat = await input.client.conversation(input.chatId, input.signal)
	input.signal.throwIfAborted()
	if (chat.id !== input.chatId)
		throw new Error("The conversation could not be verified.")
	return input.client.attachFile(
		input.chatId,
		{
			fileId: input.fileId,
			requestId: input.requestId,
			expected: chat.revision,
		},
		input.signal,
	)
}
