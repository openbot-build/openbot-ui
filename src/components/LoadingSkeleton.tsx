import { t } from "@lingui/core/macro"
import { useLocation } from "react-router"
import { Match } from "effect"

/** Route placeholders never own Kay or participate in destination resolution. */
export function LoadingSkeleton({
	shell = false,
}: {
	readonly shell?: boolean
}) {
	const location = useLocation()
	const search = new URLSearchParams(location.search)
	const kind =
		location.pathname === "/"
			? "home"
			: location.pathname.startsWith("/sessions/")
				? "conversation"
				: location.pathname === "/apps" &&
					  search.get("tab") !== "added" &&
					  (search.has("catalogId") || search.has("cardUrl"))
					? "app-detail"
					: location.pathname === "/apps" &&
						  search.get("tab") !== "added" &&
						  search.has("storyId")
						? "story"
						: location.pathname === "/apps"
							? "apps"
							: "page"
	const filtered =
		search.has("query") ||
		search.has("category") ||
		search.has("source") ||
		search.has("cursor") ||
		search.get("tab") === "added"
	return (
		<div
			className="loading-skeleton"
			data-shell={shell || undefined}
			data-layout={kind}
			role="status"
			aria-live="polite"
			aria-busy="true"
		>
			<span className="sr-only">{t`Loading…`}</span>
			<div aria-hidden="true">
				{shell && (
					<>
						<div className="loading-skeleton-toolbar">
							<Placeholder className="loading-skeleton-control" />
							<Placeholder className="loading-skeleton-control" />
						</div>
						<div className="loading-skeleton-navigation">
							<Placeholder className="loading-skeleton-navigation-action" />
							{Array.from({ length: 3 }, (_, index) => (
								<Placeholder
									key={index}
									className="loading-skeleton-navigation-row"
								/>
							))}
							<div className="loading-skeleton-history">
								{Array.from({ length: 5 }, (_, index) => (
									<Placeholder
										key={index}
										className="loading-skeleton-navigation-row"
									/>
								))}
							</div>
							<Placeholder className="loading-skeleton-account" />
						</div>
					</>
				)}
				{Match.value(kind).pipe(
					Match.when("home", () => (
						<div className="loading-skeleton-home">
							<div className="loading-skeleton-identity-space" />
							<div className="loading-skeleton-welcome">
								<Placeholder className="loading-skeleton-heading" />
								<Placeholder />
								<Placeholder className="loading-skeleton-short" />
							</div>
							<Placeholder className="loading-skeleton-composer" />
							<div className="loading-skeleton-home-actions">
								<Placeholder />
								<Placeholder />
							</div>
						</div>
					)),
					Match.when("conversation", () => (
						<div className="loading-skeleton-conversation">
							<Placeholder className="loading-skeleton-heading" />
							<div className="loading-skeleton-message loading-skeleton-user">
								<Placeholder />
								<Placeholder className="loading-skeleton-short" />
							</div>
							<div className="loading-skeleton-message">
								<Placeholder />
								<Placeholder />
								<Placeholder />
								<Placeholder className="loading-skeleton-short" />
							</div>
							<div className="loading-skeleton-message">
								<Placeholder />
								<Placeholder />
								<Placeholder className="loading-skeleton-short" />
							</div>
							<Placeholder className="loading-skeleton-composer" />
						</div>
					)),
					Match.when("apps", () => (
						<div className="loading-skeleton-page">
							<Placeholder className="loading-skeleton-heading" />
							<Placeholder className="loading-skeleton-search" />
							{!filtered && (
								<div className="loading-skeleton-stories">
									<Placeholder />
									<Placeholder />
								</div>
							)}
							<div className="loading-skeleton-apps">
								{Array.from({ length: 6 }, (_, index) => (
									<AppRow key={index} />
								))}
							</div>
						</div>
					)),
					Match.when("story", () => (
						<div className="loading-skeleton-page loading-skeleton-story">
							<Placeholder className="loading-skeleton-heading" />
							<Placeholder className="loading-skeleton-story-cover" />
							<div className="loading-skeleton-article">
								<Placeholder className="loading-skeleton-heading" />
								{Array.from({ length: 3 }, (_, index) => (
									<div className="loading-skeleton-message" key={index}>
										<Placeholder />
										<Placeholder />
										<Placeholder className="loading-skeleton-short" />
									</div>
								))}
							</div>
						</div>
					)),
					Match.when("app-detail", () => (
						<div className="loading-skeleton-page">
							<Placeholder className="loading-skeleton-heading" />
							<div className="loading-skeleton-detail-heading">
								<Placeholder className="loading-skeleton-app-icon" />
								<div>
									<Placeholder className="loading-skeleton-heading" />
									<Placeholder />
									<Placeholder className="loading-skeleton-short" />
								</div>
							</div>
							<Placeholder className="loading-skeleton-detail-action" />
							<div className="loading-skeleton-article">
								<Placeholder className="loading-skeleton-heading" />
								{Array.from({ length: 3 }, (_, index) => (
									<div className="loading-skeleton-message" key={index}>
										<Placeholder />
										<Placeholder />
										<Placeholder className="loading-skeleton-short" />
									</div>
								))}
							</div>
						</div>
					)),
					Match.when("page", () => (
						<div className="loading-skeleton-page">
							<Placeholder className="loading-skeleton-heading" />
							<div className="loading-skeleton-apps">
								{Array.from({ length: 4 }, (_, index) => (
									<AppRow key={index} />
								))}
							</div>
						</div>
					)),
					Match.exhaustive,
				)}
			</div>
		</div>
	)
}

function Placeholder({ className = "" }: { readonly className?: string }) {
	return <div className={`loading-skeleton-shape ${className}`} />
}

function AppRow() {
	return (
		<div className="loading-skeleton-app-row">
			<Placeholder className="loading-skeleton-app-icon" />
			<div>
				<Placeholder />
				<Placeholder className="loading-skeleton-short" />
			</div>
		</div>
	)
}
