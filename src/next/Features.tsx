import { t } from "@lingui/core/macro"
import type * as Product from "@kaicom/kay-contracts"
import type { Client } from "@kaicom/kay-contracts/Client"
import { Match } from "effect"
import { CheckCheck, Files, Grid2X2, Workflow, Monitor } from "lucide-react"
import type { ViewAction, ViewState } from "./Model"
import type { NavigationItem } from "./Shell"
import { featureDestination } from "./FeatureDestinations"
import { Button } from "../components/ui/button"
import { TasksPage } from "./features/TasksPage"
import { DevicesPage } from "./features/DevicesPage"
import { ComputersPage } from "./features/ComputersPage"
import { ConnectionsPage } from "./features/ConnectionsPage"
import { FilesPage } from "./features/FilesPage"
import {
	AutomationsPage,
	type AutomationsPageProps,
} from "./features/AutomationsPage"
import type { WorkflowProps } from "./features/Workflow"
import { SettingsPage } from "./features/SettingsPage"
import { AdminConsole } from "./features/AdminConsole"
import {
	adminDestination,
	adminRoute,
	personalSettingsDestination,
} from "./features/SettingsData"

export function useFeatureNavigation({
	view,
	dispatch,
	conversationId,
}: {
	readonly client: Client
	readonly bootstrap: Product.Bootstrap | null
	readonly view: ViewState
	readonly conversationId?: string | undefined
	readonly dispatch: (action: ViewAction) => void
}): ReadonlyArray<NavigationItem> {
	return [
		{ id: "tasks", label: t`Tasks and approvals`, icon: CheckCheck },
		{ id: "files", label: t`Files`, icon: Files },
		{ id: "apps", label: t`App Square`, icon: Grid2X2 },
		{ id: "automations", label: t`Automations`, icon: Workflow },
		{ id: "devices", label: t`Devices`, icon: Monitor },
	].map((item) => ({
		...item,
		selected:
			view.destination.kind === "feature" &&
			(view.destination.id === item.id ||
				(item.id === "devices" && view.destination.id === "computers")),
		onSelect: () =>
			dispatch({
				type: "navigate",
				destination: {
					kind: "feature",
					id: item.id,
					title: item.label,
					...(item.id === "files" && conversationId !== undefined
						? { conversationId }
						: {}),
				},
			}),
	}))
}

export function FeatureView(props: {
	readonly id: string
	readonly client: Client
	readonly bootstrap: Product.Bootstrap
	readonly onOpenChat: (id: string) => void
	readonly onStartConversation: WorkflowProps["onStartConversation"]
	readonly onUseFile?: WorkflowProps["onUseFile"]
	readonly onAttachFile?: WorkflowProps["onAttachFile"]
	readonly conversationId?: string | undefined
	readonly automationLinks?: AutomationsPageProps["automationLinks"]
	readonly onLinkAutomation?: AutomationsPageProps["onLinkAutomation"]
	readonly onBackToConversation?: () => void
	readonly onChanged?: () => void | Promise<void>
	readonly authorization?: string | undefined
	readonly developerTest?: string | undefined
	readonly onNavigateFeature: (id: string) => void
}) {
	const key =
		props.id +
		":" +
		props.bootstrap.identity.userId +
		":" +
		props.bootstrap.identity.organizationId
	const destination = featureDestination(props.id)
	return Match.value(destination).pipe(
		Match.when(
			(id) => personalSettingsDestination(id) !== undefined,
			() => (
				<SettingsPage
					key={key}
					{...props}
					initialSection={personalSettingsDestination(destination)}
				/>
			),
		),
		Match.when(
			(id) => id === "admin" || adminDestination(id) !== undefined,
			() => (
				<AdminConsole
					key={key}
					{...props}
					section={adminDestination(destination) ?? null}
					onNavigateSection={(section) =>
						props.onNavigateFeature(adminRoute(section))
					}
					onSettings={() => props.onNavigateFeature("settings")}
				/>
			),
		),
		Match.when("tasks", () => <TasksPage key={key} {...props} />),
		Match.when("files", () => (
			<FilesPage key={key + ":" + (props.conversationId ?? "")} {...props} />
		)),
		Match.when("devices", () => <DevicesPage key={key} {...props} />),
		Match.when("computers", () => <ComputersPage key={key} {...props} />),
		Match.when(
			(id) =>
				id === "apps" || id === "connections" || id === "appAuthorization",
			() => (
				<ConnectionsPage
					key={key}
					{...props}
					initialConnected={
						destination !== "apps" || props.authorization !== undefined
					}
				/>
			),
		),
		Match.when(
			(id) => id === "automations" || id === "triggers",
			() => <AutomationsPage key={key} {...props} />,
		),
		Match.when(
			(id) => id === "bots" || id === "botInvitations",
			() => (
				<div className="next-page">
					<p>{t`Kay Bot and Chat now share one workspace.`}</p>
					<button
						onClick={() => props.onStartConversation()}
					>{t`New chat`}</button>
				</div>
			),
		),
		Match.orElse(() => (
			<section className="next-page">
				<p>{t`This feature is not available for this account yet.`}</p>
				<Button
					onClick={() => props.onStartConversation()}
				>{t`New chat`}</Button>
			</section>
		)),
	)
}
