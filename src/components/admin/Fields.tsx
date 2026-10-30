import { useId, type ReactNode } from "react"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/api"
import type { AsyncResult } from "effect/reactivity"
export function TextField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
 const id = useId()
 return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} value={value} onChange={e => onChange(e.target.value)} />{hint && <FieldDescription>{hint}</FieldDescription>}</Field>
}
export function Choice<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
 const id = useId()
 return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Select value={value} onValueChange={v => { if (v !== null) onChange(v as T) }}><SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{choices.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></Field>
}
export function Load<T, E>({ result, children }: { result: AsyncResult.AsyncResult<T, E>; children: (v: T) => ReactNode }) {
 if (result._tag === "Initial") return <Spinner aria-label="Loading" />
 if (result._tag === "Failure") return <p role="alert">{errorMessage(result.cause)}</p>
 return <>{children(result.value)}</>
}
export function Pager({ next, onPage }: { next: string | null; onPage: (p: string | undefined) => void }) {
 return <div className="flex gap-2 pt-4"><Button variant="secondary" onClick={() => onPage(undefined)}>First page</Button><Button variant="secondary" disabled={next === null} onClick={() => { if (next !== null) onPage(next) }}>Next page</Button></div>
}
export const words = (value: string) => value.split(/[\s,]+/).filter(Boolean)
