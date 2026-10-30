import { useAtomValue } from "@effect/atom-react"
import { CircleAlertIcon, FileIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { fileUrlAtom } from "@/atoms/files"
import { cn, resultValue } from "@/lib/utils"

const isImage = (mediaType: string) => mediaType.startsWith("image/")

/** An image that the page loads from OpenBot. Until it loads, the box is empty. */
function StoredImage({
	id,
	name,
	mediaType,
	className,
}: {
	readonly id: string
	readonly name: string
	readonly mediaType: string
	readonly className?: string
}) {
	const url = resultValue(useAtomValue(fileUrlAtom(id, mediaType)))
	return (
		<span className={cn("block overflow-hidden bg-muted", className)}>
			{url === undefined ? null : (
				<img src={url} alt={name} className="size-full object-cover" />
			)}
		</span>
	)
}

/**
 * A file in a message. An image that OpenBot keeps shows as a picture. Any
 * other file shows its name.
 */
export function FilePreview({
	id,
	name,
	mediaType,
	className,
}: {
	readonly id: string | undefined
	readonly name: string
	readonly mediaType: string
	readonly className?: string
}) {
	if (id !== undefined && isImage(mediaType))
		return (
			<StoredImage
				id={id}
				name={name}
				mediaType={mediaType}
				className={cn("size-40 rounded-2xl", className)}
			/>
		)
	return (
		<span
			className={cn(
				"flex max-w-64 items-center gap-2 rounded-lg bg-muted px-3 py-2 text-body-medium",
				className,
			)}
		>
			<FileIcon className="size-4 shrink-0 text-muted-foreground" />
			<span className="truncate">{name}</span>
		</span>
	)
}

/** A file that the person added to the composer. It uploads while they write. */
export interface Draft {
	readonly key: string
	readonly name: string
	readonly mediaType: string
	/** A local address of an image, for its picture before the upload ends. */
	readonly preview: string | undefined
	readonly status: "uploading" | "ready" | "failed"
	readonly error?: string
}

/**
 * The files in the composer, in one row. Each one has a button that takes it
 * out. The corner is the corner of the composer minus the space to its edge.
 */
export function DraftFiles({
	drafts,
	onRemove,
}: {
	readonly drafts: ReadonlyArray<Draft>
	readonly onRemove: (key: string) => void
}) {
	return (
		<div className="flex w-full flex-wrap gap-2">
			{drafts.map((draft) => (
				<div
					key={draft.key}
					title={draft.error ?? draft.name}
					className={cn(
						"group/draft relative flex h-16 max-w-56 items-center gap-2 overflow-hidden rounded-draft bg-background",
						draft.preview === undefined ? "pr-9 pl-3" : "w-16",
						draft.status === "failed" && "text-destructive",
					)}
				>
					{draft.preview !== undefined ? (
						<img
							src={draft.preview}
							alt={draft.name}
							className="size-full object-cover"
						/>
					) : (
						<>
							{draft.status === "failed" ? (
								<CircleAlertIcon className="size-4 shrink-0" />
							) : (
								<FileIcon className="size-4 shrink-0 text-muted-foreground" />
							)}
							<span className="truncate text-body-medium font-normal text-foreground">
								{draft.name}
							</span>
						</>
					)}
					{draft.status === "uploading" ? (
						<span className="absolute inset-0 flex items-center justify-center bg-background/60">
							<Spinner className="size-4 text-muted-foreground" />
						</span>
					) : null}
					{draft.status === "failed" && draft.preview !== undefined ? (
						<span className="absolute inset-0 flex items-center justify-center bg-background/70 text-destructive">
							<CircleAlertIcon className="size-4" />
						</span>
					) : null}
					<Button
						variant="secondary"
						size="icon-xs"
						aria-label={`Take out ${draft.name}`}
						onClick={() => onRemove(draft.key)}
						className="absolute top-1 right-1 size-6 rounded-full opacity-100 transition-opacity md:opacity-0 md:group-hover/draft:opacity-100 md:focus-visible:opacity-100"
					>
						<XIcon />
					</Button>
				</div>
			))}
		</div>
	)
}
