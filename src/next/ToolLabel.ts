import { t } from "@lingui/core/macro"
import { Match } from "effect"
import { toolPresentation, type ToolMetadata } from "./ToolPresentation"

/** Describe the action independently of whether it is pending or finished. */
// @effect-diagnostics-next-line missingPipeableSignature:off
export const toolLabel = (name: string, metadata?: ToolMetadata): string => {
	const presentation = toolPresentation(name, metadata)
	if (presentation.displayName !== null) return presentation.displayName
	return Match.value(presentation.identifier)
		.pipe(
			Match.when("openbot_computer_exec", () => t`Run command`),
			Match.when("openbot_computer_write_stdin", () => t`Send terminal input`),
			Match.when("openbot_computer_read_file", () => t`Read file`),
			Match.when("openbot_computer_write_file", () => t`Write file`),
			Match.when("openbot_computer_export_file", () => t`Export file`),
			Match.when("openbot_computer_list_files", () => t`Browse files`),
			Match.when("openbot_computer_remove_file", () => t`Remove file`),
			Match.when("openbot_computer_open_port", () => t`Open port`),
			Match.when("openbot_computer_screenshot", () => t`Take screenshot`),
			Match.when("openbot_computer_desktop", () => t`Control desktop`),
			Match.when("openbot_computers_list", () => t`List computers`),
			Match.when("openbot_computers_acquire", () => t`Request computer access`),
			Match.when("openbot_computers_release", () => t`Release computer`),
			Match.when("openbot_computers_create", () => t`Create computer`),
			Match.when("openbot_computers_pause", () => t`Pause computer`),
			Match.when("openbot_computers_resume", () => t`Resume computer`),
		)
		.pipe(
			Match.when("openbot_todos", () => t`Update steps`),
			Match.when("openbot_submit_plan", () => t`Submit plan`),
			Match.when("openbot_remind", () => t`Schedule reminder`),
			Match.when("openbot_delegate", () => t`Assign task`),
			Match.when("openbot_cancel_delegation", () => t`Cancel delegated task`),
			Match.when(
				(value) => /^openbot_search_apps(?:_[1-9]\d*)?$/.test(value),
				() => t`Search Apps`,
			),
			Match.when(
				(value) => /^openbot_app_details(?:_[1-9]\d*)?$/.test(value),
				() => t`Read App details`,
			),
			Match.when(
				(value) => /^openbot_app_access(?:_[1-9]\d*)?$/.test(value),
				() => t`Check App access`,
			),
			Match.when("openbot_code_api", () => t`Read App capabilities`),
			Match.when("openbot_run_code", () => t`Run App code`),
			// An unknown binding, including an App hash, must remain identifiable.
			Match.orElse((identifier) => identifier || t`Unnamed tool`),
		)
}

// @effect-diagnostics-next-line missingPipeableSignature:off
export const toolCategory = (name: string, metadata?: ToolMetadata): string => {
	const presentation = toolPresentation(name, metadata)
	if (presentation.appName !== null) return presentation.appName
	return Match.value(presentation.category).pipe(
		Match.when("terminal", () => t`Terminal`),
		Match.when("files", () => t`Files`),
		Match.when("computer", () => t`Computer`),
		Match.when("plan", () => t`Steps`),
		Match.when("tasks", () => t`Tasks`),
		Match.when("reminders", () => t`Reminders`),
		Match.when("apps", () => t`Apps`),
		Match.when("tools", () => t`Tools`),
		Match.exhaustive,
	)
}
