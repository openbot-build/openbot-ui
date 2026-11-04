import { FeedbackInbox } from "./FeedbackInbox"
import { t } from "@lingui/core/macro"
import type * as Product from "@kaicom/kay-contracts"
import type { Client } from "@kaicom/kay-contracts/Client"
import {
	Inbox,
	Gift,
	ArrowLeft,
	ArrowUpRight,
	Building2,
	Cable,
	ChartNoAxesCombined,
	Cpu,
	KeyRound,
	Monitor,
	Radio,
	ScrollText,
	ShieldCheck,
	SlidersHorizontal,
} from "lucide-react"
import { Button } from "../../components/ui/button"
import { PageHeading } from "../Shell"
import { MembershipAdmin } from "./MembershipAdmin"
import { AdminWorkflows } from "./AdminWorkflows"
import { adminSections, canOpenAdmin, type AdminSection } from "./SettingsData"
import "./AdminConsole.css"

const sectionDetails = () => ({
	feedback: {
		title: t`Platform reports`,
		description: t`Review problems reported by Kay and track their resolution.`,
		icon: Inbox,
	},
	defaults: {
		title: t`Service defaults`,
		description: t`Set the shared experience, sign-in, storage, and default behavior for Kay.`,
		icon: SlidersHorizontal,
	},
	models: {
		title: t`Models and providers`,
		description: t`Connect model services and decide which models people can use.`,
		icon: Cpu,
	},
	computers: {
		title: t`Computer resources`,
		description: t`Connect cloud computer providers and manage the resources behind tasks.`,
		icon: Monitor,
	},
	credentials: {
		title: t`Service credentials`,
		description: t`Manage shared secret providers and vault access. Personal App accounts stay with their owners.`,
		icon: KeyRound,
	},
	people: {
		title: t`People and access`,
		description: t`Manage organizations, members, roles, and administrator access.`,
		icon: Building2,
	},
	memberships: {
		title: t`Memberships and redemption codes`,
		description: t`Create codes, check who redeemed them, and revoke unused codes.`,
		icon: Gift,
	},
	limits: {
		title: t`Usage and limits`,
		description: t`Review service usage and set the budgets available to your organization.`,
		icon: ChartNoAxesCombined,
	},
	channels: {
		title: t`Messaging channels`,
		description: t`Configure the channels people can connect to Kay.`,
		icon: Radio,
	},
	integrations: {
		title: t`API access`,
		description: t`Manage access tokens for approved integrations.`,
		icon: Cable,
	},
	audit: {
		title: t`Activity and audit`,
		description: t`Review recorded changes to access and service configuration.`,
		icon: ScrollText,
	},
})

export function AdminConsole({
	client,
	bootstrap,
	section,
	onNavigateSection,
	onChanged,
	onSettings,
}: {
	readonly client: Client
	readonly bootstrap: Product.Bootstrap
	readonly section: AdminSection | null
	readonly onNavigateSection: (section: AdminSection | null) => void
	readonly onOpenChat: (id: string) => void
	readonly onChanged?: (() => void | Promise<void>) | undefined
	readonly onSettings: () => void
}) {
	const details = sectionDetails()
	if (!canOpenAdmin(bootstrap.access))
		return (
			<section className="kay-admin-page">
				<PageHeading
					title={t`Administrator access required`}
					description={t`This console is for the team that manages Kay. Your personal settings are available as usual.`}
				/>
				<Button variant="outline" onClick={onSettings}>
					<ArrowLeft size={16} />
					{t`Open personal settings`}
				</Button>
			</section>
		)
	return (
		<section className="kay-admin-page">
			{section === null ? (
				<div className="kay-admin-heading">
					<div>
						<span className="kay-admin-eyebrow">
							<ShieldCheck size={15} />
							{t`Administration`}
						</span>
						<PageHeading
							title={t`Kay console`}
							description={t`Configure the service for everyone, in one place.`}
						/>
					</div>
					<Button variant="ghost" onClick={onSettings}>
						<ArrowLeft size={16} />
						{t`Personal settings`}
					</Button>
				</div>
			) : (
				<div className="kay-admin-compact-heading">
					<div>
						<Button variant="ghost" onClick={() => onNavigateSection(null)}>
							<ArrowLeft size={16} />
							{t`Console overview`}
						</Button>
						<h2>{details[section].title}</h2>
					</div>
					<Button
						variant="ghost"
						onClick={onSettings}
					>{t`Personal settings`}</Button>
				</div>
			)}
			{section === null ? (
				<div className="kay-admin-grid">
					{adminSections.map((id) => {
						const entry = details[id]
						return (
							<button
								key={id}
								className="kay-admin-card"
								onClick={() => onNavigateSection(id)}
							>
								<span className="kay-admin-card-icon">
									<entry.icon size={22} />
								</span>
								<strong>{entry.title}</strong>
								<p>{entry.description}</p>
								<ArrowUpRight className="kay-admin-card-arrow" size={18} />
							</button>
						)
					})}
				</div>
			) : (
				<>
					<div className="kay-admin-section-heading">
						{section === "computers" && (
							<p className="kay-admin-scope">{t`Computer services are saved for the organization by default.`}</p>
						)}
						{section === "models" && (
							<p className="kay-admin-scope">{t`Shared services have explicit access rules; organization services stay within your organization.`}</p>
						)}
					</div>
					<nav
						className="kay-admin-tabs"
						aria-label={t`Administration categories`}
					>
						{adminSections.map((id) => (
							<button
								key={id}
								aria-current={section === id ? "page" : undefined}
								onClick={() => onNavigateSection(id)}
							>
								{details[id].title}
							</button>
						))}
					</nav>
					{section === "feedback" ? (
						<FeedbackInbox client={client} identity={bootstrap.identity} />
					) : section === "memberships" ? (
						<MembershipAdmin client={client} bootstrap={bootstrap} />
					) : (
						<AdminWorkflows
							key={section}
							section={section}
							client={client}
							bootstrap={bootstrap}
							{...(onChanged === undefined ? {} : { onChanged })}
						/>
					)}
				</>
			)}
		</section>
	)
}
