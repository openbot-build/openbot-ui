import { Schema } from "effect"

const PendingCommand = Schema.Struct({
	token: Schema.String,
	kind: Schema.Literals(["terminal", "desktop"]),
	sessionId: Schema.NullOr(Schema.String),
})
export type PendingCommand = typeof PendingCommand.Type
export interface CommandStorage {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
}
export const computerCommandKey = (scope: {
	readonly organization: string
	readonly user: string
	readonly computer: string
}) =>
	"kay:computer-command:" +
	JSON.stringify([scope.organization, scope.user, scope.computer])
export const readComputerCommand = (options: {
	readonly storage: CommandStorage
	readonly key: string
}): PendingCommand | null => {
	const saved = options.storage.getItem(options.key)
	return saved === null
		? null
		: Schema.decodeUnknownSync(PendingCommand)(JSON.parse(saved))
}
export const startComputerCommand = (options: {
	readonly storage: CommandStorage
	readonly key: string
	readonly command: PendingCommand
}) => {
	if (options.storage.getItem(options.key) !== null) return false
	options.storage.setItem(options.key, JSON.stringify(options.command))
	return true
}
export const finishComputerCommand = (options: {
	readonly storage: CommandStorage
	readonly key: string
	readonly token: string
}) => {
	if (readComputerCommand(options)?.token !== options.token) return false
	options.storage.removeItem(options.key)
	return true
}
export const canReconcileComputerCommand = (options: {
	readonly command: PendingCommand | null
	readonly sessionId: string | null
	readonly running: boolean | null
}) =>
	options.command?.kind === "terminal" &&
	options.command.sessionId !== null &&
	options.command.sessionId === options.sessionId &&
	options.running === false
