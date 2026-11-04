import { Schema } from "effect"

export const VersionId = Schema.String.pipe(
	Schema.brand("@kaicom/e-core/MemoryVersionId"),
)
export type VersionId = typeof VersionId.Type
