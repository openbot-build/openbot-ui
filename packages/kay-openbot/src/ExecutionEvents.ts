import * as Api from "@openbot-build/client/Api"
import type { Client, ClientError } from "@openbot-build/client"
import { Effect, Schema, Stream } from "effect"

/** Read only the saved boundary, even when more events arrive during pagination. */
export const readExecutionEvents = ({
	api,
	execution,
	keep,
}: {
	readonly api: typeof Client.Service.api
	readonly execution: Api.ExecutionsApi.Execution.Record
	readonly keep: (event: Api.ExecutionsApi.Execution.Event) => boolean
}): Effect.Effect<
	| { readonly events: ReadonlyArray<Api.ExecutionsApi.Execution.Event> }
	| { readonly response: Response },
	ClientError
> => {
	const unavailable = () => ({
		response: Response.json(
			{
				code: "unavailable",
				message: "The saved execution events could not be read completely.",
			},
			{ status: 503 },
		),
	})
	return Effect.gen(function* () {
		let afterSequence = 0
		let events: ReadonlyArray<Api.ExecutionsApi.Execution.Event> = []
		while (afterSequence < execution.sequence) {
			const response = yield* api.executions.events({
				params: { executionId: execution.id },
				query: { afterSequence },
				responseMode: "response-only",
			})
			if (response.status !== 200)
				return {
					response: new Response(Stream.toReadableStream(response.stream), {
						status: response.status,
						headers: response.headers,
					}),
				}
			const page = yield* Schema.decodeUnknownEffect(
				Api.ExecutionsApi.EventPage,
			)(yield* response.json)
			let previous = afterSequence
			for (const event of page.events) {
				if (event.executionId !== execution.id || event.sequence <= previous)
					return unavailable()
				previous = event.sequence
			}
			// The native cursor is the last event, not the execution's current revision.
			if (previous <= afterSequence || page.afterSequence !== previous)
				return unavailable()
			events = [
				...events,
				...page.events.filter(
					(event) => event.sequence <= execution.sequence && keep(event),
				),
			]
			afterSequence = page.afterSequence
		}
		return { events }
	}).pipe(Effect.catchTag("SchemaError", () => Effect.succeed(unavailable())))
}
