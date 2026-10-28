import { FileQuestionIcon } from "lucide-react"
import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty"

/** The page for an address that the app does not know. */
export function NotFoundPage() {
	return (
		<Empty className="min-h-svh">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<FileQuestionIcon />
				</EmptyMedia>
				<EmptyTitle>Page not found</EmptyTitle>
				<EmptyDescription>This page does not exist.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button nativeButton={false} render={<Link to="/" />}>
					Go to the start
				</Button>
			</EmptyContent>
		</Empty>
	)
}
