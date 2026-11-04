import { Match, Schema } from "effect"

export const WorkspaceComputer = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	state: Schema.Literals([
		"starting",
		"running",
		"paused",
		"offline",
		"failed",
	]),
	source: Schema.Union([
		Schema.TaggedStruct("Provider", {
			provider: Schema.String,
		}),
		Schema.TaggedStruct("Connector", {}),
	]),
	features: Schema.Struct({
		pause: Schema.Boolean,
		desktop: Schema.Boolean,
		ports: Schema.Boolean,
	}),
	version: Schema.Finite,
})
export type WorkspaceComputer = typeof WorkspaceComputer.Type
export const WorkspaceComputers = Schema.Array(WorkspaceComputer)
export const ComputerProviders = Schema.Array(
	Schema.Struct({ id: Schema.String, name: Schema.String }),
)
export const ComputerFiles = Schema.Array(
	Schema.Struct({
		name: Schema.String,
		kind: Schema.Literals(["file", "directory", "link"]),
		size: Schema.Finite,
		modifiedAt: Schema.Finite,
	}),
)
export type ComputerFile = (typeof ComputerFiles.Type)[number]
export const ComputerFileContent = Schema.Struct({
	path: Schema.String,
	encoding: Schema.Literals(["utf8", "base64"]),
	content: Schema.String,
})
export const ComputerPairing = Schema.Struct({
	code: Schema.String,
	hostname: Schema.String,
	os: Schema.String,
	arch: Schema.String,
	desktop: Schema.Boolean,
	expiresAt: Schema.Finite,
})
export type ComputerPairing = typeof ComputerPairing.Type
export const ComputerAccess = Schema.Array(
	Schema.Struct({ bot: Schema.String }),
)

/** Names from a directory response stay in that directory. */
export const childPath = ({
	directory,
	name,
}: {
	readonly directory: string
	readonly name: string
}): string => {
	if (name === "" || name === "." || name === ".." || /[\\/\u0000]/.test(name))
		throw new Error("The computer returned an invalid file name.")
	return (directory === "/" ? "/" : directory.replace(/\/$/, "") + "/") + name
}
export const parentPath = (path: string): string => {
	const parts = path.replace(/\/$/, "").split("/")
	const parent = parts.slice(0, -1).join("/")
	return parts.length <= 1 ? "." : parent === "" ? "/" : parent
}
export const fileBytes = (value: typeof ComputerFileContent.Type): Uint8Array =>
	Match.value(value.encoding).pipe(
		Match.when("base64", () =>
			Uint8Array.from(atob(value.content), (character) =>
				character.charCodeAt(0),
			),
		),
		Match.when("utf8", () => new TextEncoder().encode(value.content)),
		Match.exhaustive,
	)
export const canUseComputer = (computer: WorkspaceComputer): boolean =>
	computer.state === "running"
