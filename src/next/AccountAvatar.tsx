import { useState } from "react"

export function AccountAvatar({
	initial,
	url,
}: {
	readonly initial: string
	readonly url: string | null | undefined
}) {
	const [failed, setFailed] = useState<string | null>(null)
	return (
		<span className="next-account-avatar">
			{url != null && failed !== url ? (
				<img
					src={url}
					alt=""
					referrerPolicy="no-referrer"
					onError={() => setFailed(url)}
				/>
			) : (
				initial
			)}
		</span>
	)
}
