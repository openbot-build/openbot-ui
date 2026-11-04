import { Schema } from "effect"

export const Id = Schema.String.pipe(Schema.brand("@kaicom/e-core/TurnId"))
export type Id = typeof Id.Type
