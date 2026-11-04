import { Schema } from "effect"

export const Id = Schema.String.pipe(Schema.brand("@kaicom/e-core/SessionId"))
export type Id = typeof Id.Type
export const Revision = Schema.Natural.pipe(
	Schema.brand("@kaicom/e-core/SessionRevision"),
)
export type Revision = typeof Revision.Type
