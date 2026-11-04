/** A process boundary for the core SDK. No Effect value crosses this interface. */
export interface NativeCall {
	readonly operation:
		| "access"
		| "featureResult"
		| "execution"
		| "commandReceipt"
		| "reminders"
		| "reminder"
		| "cancelReminder"
		| "attachFile"
		| "observeExecution"
		| "observeChat"
		| "featureCatalog"
		| "featureDefinition"
		| "visibleFeatureCatalog"
		| "feature"
		| "memberSettings"
		| "bots"
		| "chats"
		| "chat"
		| "create"
		| "fork"
		| "branches"
		| "update"
		| "items"
		| "turns"
		| "wait"
		| "interrupt"
		| "send"
		| "sendToBot"
	readonly id?: string
	readonly query?: Readonly<Record<string, string>>
	readonly payload?: unknown
}
export interface NativeClient {
	readonly request: (call: NativeCall) => Promise<Response>
}
export type NativeClientFactory = (input: {
	readonly headers: Headers
	readonly signal: AbortSignal
}) => NativeClient
