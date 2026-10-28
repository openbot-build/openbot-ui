import { ExecutionsApi } from "@openbot-build/client/Api"
import { Client as Api, Executions } from "@openbot-build/client"
import { Effect, Schema, Stream } from "effect"

const { Execution } = ExecutionsApi

/** A command ended without the result that the person asked for. */
export class ExecutionFailed extends Schema.TaggedError<ExecutionFailed>()(
	"ExecutionFailed",
	{
		executionId: Execution.Id,
		status: Execution.Status,
		failure: Schema.NullOr(Execution.Failure),
		message: Schema.String,
	},
) {}

/** Wait for saved work to end before showing that a command is done. */
export const waitForExecution = Effect.fn("waitForExecution")(function* (
	receipt: ExecutionsApi.Execution.Receipt,
	options: {
		readonly success?: ReadonlyArray<ExecutionsApi.Execution.Status>
	} = {},
) {
	yield* Stream.runDrain(
		Executions.observe(receipt.executionId, receipt.sequence),
	)
	const client = yield* Api
	const record = yield* client.api.executions.get({
		params: { executionId: receipt.executionId },
	})
	if (!(options.success ?? ["completed"]).includes(record.status))
		return yield* new ExecutionFailed({
			executionId: record.id,
			status: record.status,
			failure: record.failure,
			message:
				record.failure === null
					? "The work did not finish. Try again."
					: `The work failed. Error ID: ${record.failure.errorId}`,
		})
	return record
})
