import { FilesApi } from "@openbot-build/client/Api"
import { Effect, Schema, Stream } from "effect"
import * as Atom from "effect/reactivity/Atom"
import { Api, apiRuntime } from "@/lib/api"

/**
 * Uploads one file for a message. It sends the file through OpenBot first. When
 * the platform turned that way off, it asks for an address in object storage
 * and puts the bytes there itself. Call it for one file at a time: a promise of
 * an atom function gives the latest result, so two calls at once could both get
 * the same file.
 */
export const uploadFileAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (file: File) {
		const client = yield* Api
		const form = new FormData()
		form.append("file", file, file.name)
		return yield* client.api.files.uploadFile({ payload: form }).pipe(
			Effect.catchTag("FilesDisabled", () =>
				Effect.gen(function* () {
					const upload = yield* client.api.files.createUpload({
						payload: {
							filename: file.name,
							mediaType: file.type || "application/octet-stream",
							bytes: file.size,
						},
					})
					yield* Effect.tryPromise({
						try: () =>
							fetch(upload.url, {
								method: upload.method,
								headers: upload.headers,
								body: file,
							}).then((response) => {
								if (!response.ok)
									throw new Error("The storage did not take the file.")
							}),
						catch: () => new UploadFailed(),
					})
					return yield* client.api.files.completeUpload({
						params: { fileId: upload.file.id },
					})
				}),
			),
		)
	}),
)

class UploadFailed extends Error {
	override readonly message = "The file did not upload. Try again."
}

/**
 * The content of a file as an address that an `<img>` can show. The page loads
 * it through the API, so it sends the organization like every other call. The
 * key is `<id> <media type>`, because a family keeps one atom for each key.
 */
const fileUrlFamily = Atom.family((key: string) =>
	apiRuntime.atom(
		Effect.gen(function* () {
			const [id = "", mediaType = ""] = key.split(" ")
			const client = yield* Api
			const fileId = yield* Schema.decodeUnknownEffect(FilesApi.FileId)(id)
			const stream = yield* client.api.files.getFileContent({
				params: { fileId },
			})
			const chunks = yield* Stream.runCollect(stream)
			const blob = new Blob(chunks as Array<BlobPart>, { type: mediaType })
			return yield* Effect.acquireRelease(
				Effect.sync(() => URL.createObjectURL(blob)),
				(url) => Effect.sync(() => URL.revokeObjectURL(url)),
			)
		}),
	),
)

export const fileUrlAtom = (id: string, mediaType: string) =>
	fileUrlFamily(`${id} ${mediaType}`)
