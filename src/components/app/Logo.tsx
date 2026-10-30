import { cn } from "@/lib/utils"

/** A wordmark, with no character or avatar. */
export function Logo({ className }: { readonly className?: string }) {
  return <span className={cn("text-headline-small font-semibold tracking-tight", className)}>OpenBot</span>
}
