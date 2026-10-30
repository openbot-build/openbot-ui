import { useAtomValue } from "@effect/atom-react"
import { ShieldCheckIcon } from "lucide-react"
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { allRequestsAtom, pendingRequestsAtom } from "@/atoms/chats"
import { PageHeader } from "@/components/app/PageHeader"
import { RequestCard } from "@/components/app/RequestCard"
import { errorMessage } from "@/lib/api"
import { resultValue } from "@/lib/utils"

/**
 * The requests of Bots. A Bot asks before it does something that no
 * Grant or Rule covers yet.
 */
export function RequestsPage() {
	return (
		<div className="flex h-full flex-col overflow-y-auto">
			<PageHeader title="Requests" />
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
				<div className="flex flex-col gap-1">
					<h1 className="text-headline-small">Requests</h1>
				</div>
				<Tabs defaultValue="pending">
					<TabsList>
						<TabsTrigger value="pending">Waiting</TabsTrigger>
						<TabsTrigger value="all">All</TabsTrigger>
					</TabsList>
					<TabsContent value="pending" className="pt-4">
						<RequestList
							atom={pendingRequestsAtom}
							empty="Nothing waits for you."
						/>
					</TabsContent>
					<TabsContent value="all" className="pt-4">
						<RequestList atom={allRequestsAtom} empty="No requests yet." />
					</TabsContent>
				</Tabs>
			</div>
		</div>
	)
}

function RequestList({
	atom,
	empty,
}: {
	readonly atom: typeof pendingRequestsAtom
	readonly empty: string
}) {
	const result = useAtomValue(atom)
	const requests = resultValue(result)
	if (requests === undefined)
		return result._tag === "Failure" ? (
			<p className="text-body-medium text-muted-foreground">
				{errorMessage(result.cause)}
			</p>
		) : (
			<div className="flex flex-col gap-2">
				{[0, 1].map((index) => (
					<Skeleton key={index} className="h-36 w-full rounded-surface" />
				))}
			</div>
		)
	if (requests.length === 0)
		return (
			<Empty className="bg-muted/50">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<ShieldCheckIcon />
					</EmptyMedia>
					<EmptyTitle>All clear</EmptyTitle>
					<EmptyDescription>{empty}</EmptyDescription>
				</EmptyHeader>
			</Empty>
		)
	return (
		<div className="flex flex-col gap-2">
			{requests.map((request) => (
				<RequestCard key={request.id} request={request} showChat />
			))}
		</div>
	)
}
