import { dual } from "effect/Function"

/** Product views stay separate from either execution engine's stored records. */
export type Destination =
	| { readonly kind: "kay" }
	| { readonly kind: "conversation"; readonly id: string }
	| { readonly kind: "tasks" }
	| { readonly kind: "files" }
	| { readonly kind: "apps" }
	| { readonly kind: "automations"; readonly conversationId?: string }
	| { readonly kind: "new" }
	| {
			readonly kind: "feature"
			readonly id: string
			readonly title: string
			readonly conversationId?: string
	  }

export interface Companion {
	readonly id: string
	readonly name: string
	readonly description: string
	readonly color: string
	readonly isDefault: boolean
}

export interface Conversation {
	readonly id: string
	readonly botId: string
	readonly kind: "direct" | "conversation"
	readonly title: string
	readonly preview: string
	readonly pinned?: boolean
	readonly color?: string
	readonly archived?: boolean
	readonly automationIds?: ReadonlyArray<string>
}

export interface Message {
	readonly id: string
	readonly role: "user" | "assistant"
	readonly text: string
	readonly streaming?: boolean
	readonly streamRevision?: number
	readonly attachments?: ReadonlyArray<SavedAttachment>
	readonly details?: ReadonlyArray<{
		readonly type: string
		readonly value: unknown
		readonly appView?: { readonly operationId: string; readonly itemId: string }
	}>
}

export interface SavedAttachment {
	readonly fileId: string
	readonly name?: string
}

export interface Attachment {
	readonly fileId: string
	readonly name: string
	readonly type: "file" | "image"
}

export interface Task {
	readonly id: string
	readonly title: string
	readonly summary: string
	readonly state: "review" | "running" | "completed"
	readonly steps: ReadonlyArray<string>
	readonly file: string
}

export interface Workspace {
	readonly source: "preview" | "live"
	readonly account: {
		readonly name: string
		readonly initial: string
		readonly avatarUrl?: string | null | undefined
		readonly planName?: string | undefined
	}
	readonly companions: ReadonlyArray<Companion>
	readonly conversations: ReadonlyArray<Conversation>
	readonly messages: Readonly<Record<string, ReadonlyArray<Message>>>
	readonly tasks: ReadonlyArray<Task>
}

export interface ViewState {
	readonly destination: Destination
	readonly companionId: string
	readonly drafts: Readonly<Record<string, string>>
	readonly navigationOpen: boolean
	readonly detailId: string | null
}

export const initialView: ViewState = {
	destination: { kind: "kay" },
	companionId: "kay",
	drafts: {},
	navigationOpen: false,
	detailId: null,
}

export type ViewAction =
	| { readonly type: "reset" }
	| { readonly type: "navigate"; readonly destination: Destination }
	| { readonly type: "companion"; readonly id: string }
	| { readonly type: "draft"; readonly value: string }
	| { readonly type: "draftFor"; readonly key: string; readonly value: string }
	| {
			readonly type: "acknowledge"
			readonly key: string
			readonly sent: string
	  }
	| { readonly type: "navigation"; readonly open: boolean }
	| { readonly type: "detail"; readonly id: string | null }

export const draftKey = (state: ViewState): string => {
	switch (state.destination.kind) {
		case "kay":
			return "direct:kay"
		case "conversation":
			return "conversation:" + state.destination.id
		default:
			return "new:" + state.companionId
	}
}

/** Layout changes never create a chat, send a message, or discard a draft. */
export const reduceView: {
	(state: ViewState, action: ViewAction): ViewState
	(action: ViewAction): (state: ViewState) => ViewState
} = dual(2, (state: ViewState, action: ViewAction): ViewState => {
	switch (action.type) {
		case "reset":
			return initialView
		case "navigate":
			return {
				...state,
				destination: action.destination,
				navigationOpen: false,
				detailId: null,
			}
		case "companion":
			return {
				...state,
				companionId: action.id,
				destination: { kind: "new" },
				navigationOpen: false,
				detailId: null,
			}
		case "draft":
			return {
				...state,
				drafts: { ...state.drafts, [draftKey(state)]: action.value },
			}
		case "draftFor":
			return {
				...state,
				drafts: { ...state.drafts, [action.key]: action.value },
			}
		case "acknowledge":
			return state.drafts[action.key]?.trim() === action.sent
				? { ...state, drafts: { ...state.drafts, [action.key]: "" } }
				: state
		case "navigation":
			return {
				...state,
				navigationOpen: action.open,
				detailId: action.open ? null : state.detailId,
			}
		case "detail":
			return {
				...state,
				detailId: action.id,
				navigationOpen: action.id !== null ? false : state.navigationOpen,
			}
	}
})
