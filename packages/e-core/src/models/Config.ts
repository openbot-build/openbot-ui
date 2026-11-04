import { Context, Data, Schema, type Effect } from "effect"
import * as ModelRuntime from "./Model.ts"
import * as ProviderRuntime from "./Provider.ts"
import type * as Session from "../session/Session.ts"
import type * as SessionStore from "../store/SessionStore.ts"

/** Serializable provider catalog data; executable providers live in Provider. */
export const Provider = Schema.Struct({
	id: ProviderRuntime.Id,
	name: Schema.String,
	endpoint: Schema.optional(Schema.String),
})
export type Provider = typeof Provider.Type

export class Selection extends Schema.TaggedClass<Selection>()(
	"Config.Selection",
	{
		provider: ProviderRuntime.Id,
		model: ModelRuntime.Id,
		reasoningEffort: Schema.optional(Schema.String),
		serviceTier: Schema.optional(Schema.String),
	},
) {}

const CompactionSchema = Schema.TaggedUnion({
	Native: {},
	NonNative: {
		model: Schema.optional(Selection),
		keepRecentMessages: Schema.optional(
			Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
		),
	},
})
export type Compaction = typeof CompactionSchema.Type
export const Compaction = Data.taggedEnum<Compaction>()

export const ReasoningLevel = Schema.Struct({
	effort: Schema.NonEmptyString,
	description: Schema.String,
})
export const ServiceTier = Schema.Struct({
	id: Schema.NonEmptyString,
	name: Schema.String,
	description: Schema.String,
})

export interface ContextLimits {
	readonly contextWindow?: number
	readonly inputTokens?: number
	readonly autoCompactTokens?: number
}

/** Serializable model catalog data; executable models live in Model. */
export class Model extends Schema.TaggedClass<Model>()("Config.Model", {
	provider: ProviderRuntime.Id,
	id: ModelRuntime.Id,
	name: Schema.String,
	description: Schema.optional(Schema.String),
	visibility: Schema.optional(Schema.Literals(["list", "hide", "none"])),
	priority: Schema.optional(Schema.Int),
	defaultReasoningLevel: Schema.optional(Schema.NonEmptyString),
	reasoningLevels: Schema.optional(Schema.Array(ReasoningLevel)),
	defaultServiceTier: Schema.optional(Schema.NonEmptyString),
	serviceTierOptions: Schema.optional(Schema.Array(ServiceTier)),
	maxContextWindow: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
	effectiveContextWindowPercent: Schema.optional(
		Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
	),
	effectiveContextWindow: Schema.optional(
		Schema.Int.check(Schema.isGreaterThan(0)),
	),
	instructionsTemplate: Schema.optional(Schema.String),
	supportVerbosity: Schema.optional(Schema.Boolean),
	defaultVerbosity: Schema.optional(Schema.Literals(["low", "medium", "high"])),
	supportsReasoningSummaryParameter: Schema.optional(Schema.Boolean),
	defaultReasoningSummary: Schema.optional(
		Schema.Literals(["auto", "concise", "detailed", "none"]),
	),
	reasoningEfforts: Schema.Array(Schema.String),
	serviceTiers: Schema.Array(Schema.String),
	maxInputTokens: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
	maxOutputTokensLimit: Schema.optional(
		Schema.Int.check(Schema.isGreaterThan(0)),
	),
	maxOutputTokens: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
	temperature: Schema.optional(Schema.Finite),
	topP: Schema.optional(Schema.Finite),
	tokenCounting: Schema.optional(Schema.Literals(["native", "estimate"])),
	contextWindow: Schema.optional(
		Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
	),
	compaction: Schema.optional(CompactionSchema),
	autoCompactTokenLimit: Schema.optional(
		Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
	),
}) {}

export const Mode = Schema.Literals(["default", "plan"])
export type Mode = typeof Mode.Type

export class ModelConfigurationError extends Data.TaggedError(
	"ModelConfigurationError",
)<{
	readonly reason:
		| "provider-not-found"
		| "model-not-found"
		| "unsupported-option"
		| "unavailable"
	readonly message: string
}> {}

export interface ModelConfigurationOperations<
	ReadError = ModelConfigurationError,
	SelectError = ModelConfigurationError,
	SelectServices = never,
> {
	readonly get: Effect.Effect<Selection, ReadError>
	readonly select: (
		selection: Selection,
	) => Effect.Effect<Selection, SelectError, SelectServices>
	readonly listProviders: Effect.Effect<
		ReadonlyArray<Provider>,
		ModelConfigurationError
	>
	readonly listModels: (
		provider?: ProviderRuntime.Id,
	) => Effect.Effect<ReadonlyArray<Model>, ModelConfigurationError>
}

export interface ModelConfigurationOptions<P = {}> {
	readonly store: Pick<
		SessionStore.Store<P>,
		"read" | "updateSettings" | "modifyEffect"
	>
	readonly models: ReadonlyArray<Model>
	readonly session: Session.Id
	readonly providers: ReadonlyArray<Provider>
}

export type RuntimeModelConfiguration = ModelConfigurationOperations<
	| Session.SessionNotFound
	| SessionStore.SessionStoreError
	| ModelConfigurationError,
	| Session.SessionNotFound
	| Session.Conflict
	| import("../memory/Memory.ts").VersionError
	| SessionStore.SessionStoreError
	| ModelConfigurationError,
	never
>

/** Manages host configuration; Provider constructs the executable model separately. */
export class ModelConfiguration extends Context.Service<
	ModelConfiguration,
	ModelConfigurationOperations
>()("@kaicom/e-core/models/Config/ModelConfiguration") {}

export class ExecutionModeError extends Data.TaggedError("ExecutionModeError")<{
	readonly reason: "session-not-found" | "unavailable"
	readonly message: string
}> {}

export interface ExecutionModeOperations<
	ReadError = ExecutionModeError,
	WriteError = ExecutionModeError,
	WriteServices = never,
> {
	readonly get: Effect.Effect<Mode, ReadError>
	readonly set: (mode: Mode) => Effect.Effect<Mode, WriteError, WriteServices>
}

export interface ExecutionModeOptions<P = {}> {
	readonly store: Pick<SessionStore.Store<P>, "read" | "modifyEffect">
	readonly session: Session.Id
}

export type RuntimeExecutionMode = ExecutionModeOperations<
	Session.SessionNotFound | SessionStore.SessionStoreError,
	| Session.SessionNotFound
	| Session.Conflict
	| import("../memory/Memory.ts").VersionError
	| SessionStore.SessionStoreError,
	never
>

/** Host-bound configuration for the current session. */
export class ExecutionMode extends Context.Service<
	ExecutionMode,
	ExecutionModeOperations
>()("@kaicom/e-core/models/Config/ExecutionMode") {}
