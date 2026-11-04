import { Schema } from "effect"

export const DeviceCategory = Schema.Literals(["computer", "phone", "smart"])
export type DeviceCategory = typeof DeviceCategory.Type

/** Reported by the connected core, rather than inferred from a saved device name. */
export const DeviceState = Schema.Literals([
	"starting",
	"running",
	"paused",
	"offline",
	"failed",
])
export type DeviceState = typeof DeviceState.Type

/** Capabilities describe the connector. Access is granted to the whole computer. */
export const DeviceCapabilities = Schema.Struct({
	commands: Schema.Boolean,
	files: Schema.Boolean,
	desktop: Schema.Boolean,
	ports: Schema.Boolean,
	pause: Schema.Boolean,
})
export type DeviceCapabilities = typeof DeviceCapabilities.Type

export const DeviceSummary = Schema.Struct({
	id: Schema.NonEmptyString,
	kind: Schema.Literal("computer"),
	name: Schema.String,
	version: Schema.Natural,
	state: DeviceState,
	source: Schema.Literals(["connector", "provider"]),
	/** Managed task workspaces keep their existing setup and repair controls. */
	management: Schema.Literals(["personal", "shared", "managed"]),
	capabilities: DeviceCapabilities,
	kayAccess: Schema.Literals(["granted", "not_granted", "unconfigured"]),
	lastActiveAt: Schema.NullOr(Schema.Finite),
	/** A maintenance receipt must be resolved before another command is sent. */
	executionId: Schema.NullOr(Schema.NonEmptyString),
})
export type DeviceSummary = typeof DeviceSummary.Type

export const DeviceConnectionAvailability = Schema.Union([
	Schema.Struct({
		status: Schema.Literal("available"),
		reason: Schema.Null,
		action: Schema.Literal("pairing"),
	}),
	Schema.Struct({
		status: Schema.Literal("unavailable"),
		reason: Schema.Literals([
			"mobile_connector_unavailable",
			"smart_device_adapter_unavailable",
		]),
		/** App setup is available independently of direct device controls. */
		action: Schema.NullOr(Schema.Literal("apps")),
	}),
])
export type DeviceConnectionAvailability =
	typeof DeviceConnectionAvailability.Type

export const DeviceGroup = Schema.Struct({
	category: DeviceCategory,
	connection: DeviceConnectionAvailability,
	devices: Schema.Array(DeviceSummary),
})
export type DeviceGroup = typeof DeviceGroup.Type

export const DevicesOverview = Schema.Struct({
	/** When Kay read the core's current device records; not a hardware heartbeat. */
	observedAt: Schema.Finite,
	defaultBotId: Schema.NullOr(Schema.NonEmptyString),
	groups: Schema.Array(DeviceGroup),
})
export type DevicesOverview = typeof DevicesOverview.Type
