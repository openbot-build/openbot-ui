import { Context, Schema } from "effect"

export const Caller = Schema.Struct({
	userId: Schema.String,
	tenantId: Schema.String,
})
export class Identity extends Context.Service<Identity, typeof Caller.Type>()(
	"@kaicom/e-platform-api/Identity",
) {}
