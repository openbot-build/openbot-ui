import { Match } from "effect"

export type ToolCategory =
	| "terminal"
	| "files"
	| "computer"
	| "plan"
	| "tasks"
	| "reminders"
	| "apps"
	| "tools"

export interface ToolMetadata {
	readonly displayName?: string | null
	readonly appName?: string | null
}

/** Names come from the saved tool binding, never from its execution status. */
// @effect-diagnostics-next-line missingPipeableSignature:off
export const toolPresentation = (name: string, metadata?: ToolMetadata) => {
	const identifier = name.trim()
	const displayName = metadata?.displayName?.trim() || null
	const appName = metadata?.appName?.trim() || null
	const category: ToolCategory = Match.value(identifier).pipe(
		Match.when(
			Match.is("openbot_computer_exec", "openbot_computer_write_stdin"),
			() => "terminal" as const,
		),
		Match.when(
			Match.is(
				"openbot_computer_read_file",
				"openbot_computer_write_file",
				"openbot_computer_export_file",
				"openbot_computer_list_files",
				"openbot_computer_remove_file",
			),
			() => "files" as const,
		),
		Match.when(
			Match.is(
				"openbot_computer_open_port",
				"openbot_computer_screenshot",
				"openbot_computer_desktop",
				"openbot_computers_list",
				"openbot_computers_acquire",
				"openbot_computers_release",
				"openbot_computers_create",
				"openbot_computers_pause",
				"openbot_computers_resume",
			),
			() => "computer" as const,
		),
		Match.when(
			Match.is("openbot_todos", "openbot_submit_plan"),
			() => "plan" as const,
		),
		Match.when(
			Match.is("openbot_delegate", "openbot_cancel_delegation"),
			() => "tasks" as const,
		),
		Match.when("openbot_remind", () => "reminders" as const),
		Match.when(
			(value) =>
				/^openbot_(?:search_apps|app_details|app_access)(?:_[1-9]\d*)?$/.test(
					value,
				) || /^openbot_[a-f0-9]{40}$/.test(value),
			() => "apps" as const,
		),
		Match.when(
			Match.is("openbot_code_api", "openbot_run_code"),
			() => "apps" as const,
		),
		Match.orElse(() => (appName === null ? "tools" : "apps")),
	)
	return { identifier, displayName, appName, category }
}
