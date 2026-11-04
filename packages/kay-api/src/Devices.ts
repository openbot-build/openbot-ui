import { Match, Schema } from "effect"
import type { DevicesOverview, DeviceSummary } from "@kaicom/kay-contracts"
import type { NativeClient } from "@kaicom/kay-contracts/Native"

export class DevicesFailure extends Schema.TaggedError<DevicesFailure>()(
	"DevicesFailure",
	{
		status: Schema.Int,
		message: Schema.String,
	},
) {}

const computer = Schema.Struct({
	id: Schema.NonEmptyString,
	name: Schema.String,
	version: Schema.Natural,
	state: Schema.Literals([
		"starting",
		"running",
		"paused",
		"offline",
		"failed",
	]),
	source: Schema.TaggedUnion({ Provider: {}, Connector: {} }),
	owner: Schema.TaggedUnion({
		Member: { userId: Schema.String },
		Organization: {},
	}),
	features: Schema.Struct({
		pause: Schema.Boolean,
		desktop: Schema.Boolean,
		ports: Schema.Boolean,
	}),
	lastActiveAt: Schema.NullOr(Schema.Finite),
	executionId: Schema.optionalKey(Schema.NonEmptyString),
})
const computers = Schema.Array(computer)

export interface DevicesReader {
	readonly client: NativeClient
	readonly userId: string
	readonly defaultBotId: string | null
	readonly isManaged: (computerId: string) => Promise<boolean>
	readonly observedAt?: number
}

/** Reads authorized core records. Pairing and changes retain the native command workflow. */
export const readDevices = async (
	input: DevicesReader,
): Promise<DevicesOverview> => {
	const list = async (botId: string | null) => {
		const response = await input.client.request({
			operation: "feature",
			id: "computers.listComputers",
			payload: botId === null ? {} : { query: { bot: botId } },
		})
		if (!response.ok)
			throw DevicesFailure.make({
				status: response.status,
				message: "Your connected computers could not be read.",
			})
		return Schema.decodeUnknownSync(computers)(await response.json())
	}
	// Administrator visibility belongs in the console, not the member's device shelf.
	const visible = (await list(null)).filter((record) =>
		Match.value(record.owner).pipe(
			Match.tag("Member", (owner) => owner.userId === input.userId),
			Match.tag("Organization", () => true),
			Match.exhaustive,
		),
	)
	const granted =
		input.defaultBotId === null ? [] : await list(input.defaultBotId)
	const devices: ReadonlyArray<DeviceSummary> = await Promise.all(
		visible.map(async (record): Promise<DeviceSummary> => ({
			id: record.id,
			kind: "computer",
			name: record.name,
			version: record.version,
			state: record.state,
			source: Match.value(record.source).pipe(
				Match.tag("Provider", () => "provider" as const),
				Match.tag("Connector", () => "connector" as const),
				Match.exhaustive,
			),
			management: (await input.isManaged(record.id))
				? "managed"
				: Match.value(record.owner).pipe(
						Match.tag("Member", () => "personal" as const),
						Match.tag("Organization", () => "shared" as const),
						Match.exhaustive,
					),
			capabilities: { commands: true, files: true, ...record.features },
			kayAccess:
				input.defaultBotId === null
					? "unconfigured"
					: granted.some((entry) => entry.id === record.id)
						? "granted"
						: "not_granted",
			lastActiveAt: record.lastActiveAt,
			executionId: record.executionId ?? null,
		})),
	)
	return {
		observedAt: input.observedAt ?? Date.now(),
		defaultBotId: input.defaultBotId,
		groups: [
			{
				category: "computer",
				connection: { status: "available", reason: null, action: "pairing" },
				devices,
			},
			{
				category: "phone",
				connection: {
					status: "unavailable",
					reason: "mobile_connector_unavailable",
					action: null,
				},
				devices: [],
			},
			{
				category: "smart",
				connection: {
					status: "unavailable",
					reason: "smart_device_adapter_unavailable",
					action: null,
				},
				devices: [],
			},
		],
	}
}
