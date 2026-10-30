import { useAtomValue } from "@effect/atom-react"
import { Link, Navigate, Outlet, useLocation } from "react-router"
import { accountAtom } from "@/atoms/account"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/api"
/** Platform management needs an account, even when it has no organization. */
export function AdminLayout() {
 const account = useAtomValue(accountAtom)
 const location = useLocation()
 if (account._tag === "Initial") return <Spinner />
 if (account._tag === "Failure") return <Navigate replace to={"/sign-in?returnTo=" + encodeURIComponent(location.pathname + location.search)} />
 if (!account.value.platformAdmin) return <main className="p-10"><p role="alert">{errorMessage({ _tag: "Forbidden" })}</p><Link to="/">Back to OpenBot</Link></main>
 return <main className="mx-auto max-w-5xl space-y-8 p-6 md:p-10"><Link to="/" className="text-body-medium text-muted-foreground">← OpenBot</Link><h1 className="text-headline-large font-semibold">Platform administration</h1><Outlet /></main>
}
