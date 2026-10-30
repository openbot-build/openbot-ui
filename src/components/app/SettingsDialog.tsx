import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { CheckIcon, CopyIcon, KeyRoundIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty"
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@/components/ui/input-group"
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@/components/ui/item"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { accountAtom, signOut, type Theme, themeAtom } from "@/atoms/account"
import { createTokenAtom, revokeTokenAtom, tokensAtom } from "@/atoms/tokens"
import { type SettingsTab, settingsTabAtom } from "@/atoms/ui"
import { useCopy } from "@/hooks/use-copy"
import { errorMessage, organizationAtom } from "@/lib/api"
import { resultValue } from "@/lib/utils"

/** The settings of the person: the look, the account and the user tokens. */
export function SettingsDialog() {
	const [tab, setTab] = useAtom(settingsTabAtom)
	return (
		<Dialog
			open={tab !== undefined}
			onOpenChange={(open) => {
				if (!open) setTab(undefined)
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription className="sr-only">
						Change how OpenBot looks and works for you
					</DialogDescription>
				</DialogHeader>
				<Tabs
					className="min-h-0 flex-1"
					value={tab ?? "general"}
					onValueChange={(value) => setTab(value as SettingsTab)}
				>
					<TabsList className="shrink-0">
						<TabsTrigger value="general">General</TabsTrigger>
						<TabsTrigger value="account">Account</TabsTrigger>
						<TabsTrigger value="tokens">API tokens</TabsTrigger>
					</TabsList>
					<DialogBody key={tab}>
						<TabsContent value="general" className="pt-4">
							<GeneralSettings />
						</TabsContent>
						<TabsContent value="account" className="pt-4">
							<AccountSettings />
						</TabsContent>
						<TabsContent value="tokens" className="pt-4">
							<TokenSettings />
						</TabsContent>
					</DialogBody>
				</Tabs>
			</DialogContent>
		</Dialog>
	)
}

const themes: ReadonlyArray<{ readonly value: Theme; readonly label: string }> =
	[
		{ value: "dark", label: "Dark" },
		{ value: "light", label: "Light" },
		{ value: "system", label: "System" },
	]

function GeneralSettings() {
	const [theme, setTheme] = useAtom(themeAtom)
	const account = resultValue(useAtomValue(accountAtom))
	const [organization, setOrganization] = useAtom(organizationAtom)
	const organizations =
		account?.memberships.filter((item) => item.status === "active") ?? []
	return (
		<FieldGroup>
			<FieldSet className="gap-3">
				<FieldLegend variant="label">Theme</FieldLegend>
				<div className="grid grid-cols-3 rounded-lg bg-input p-1 [corner-shape:round]">
					{themes.map((item) => (
						<label key={item.value} className="min-w-0 cursor-pointer">
							<input
								type="radio"
								name="theme"
								value={item.value}
								checked={theme === item.value}
								onChange={() => setTheme(item.value)}
								className="peer sr-only"
							/>
							<span className="flex min-h-11 items-center justify-center rounded-control px-3 text-label-large text-muted-foreground transition-colors hover:text-foreground peer-checked:bg-background peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
								{item.label}
							</span>
						</label>
					))}
				</div>
			</FieldSet>
			{organizations.length > 1 ? (
				<Field orientation="horizontal">
					<FieldLabel htmlFor="settings-organization">Organization</FieldLabel>
					<Select
						items={organizations.map((item) => ({
							value: item.organizationId,
							label: item.name,
						}))}
						value={organization}
						onValueChange={(value) => value && setOrganization(value)}
					>
						<SelectTrigger id="settings-organization" className="w-48 max-w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{organizations.map((item) => (
								<SelectItem
									key={item.organizationId}
									value={item.organizationId}
								>
									{item.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
			) : null}
		</FieldGroup>
	)
}

function AccountSettings() {
	const account = resultValue(useAtomValue(accountAtom))
	const [organization] = useAtom(organizationAtom)
	const membership = account?.memberships.find(
		(item) => item.organizationId === organization,
	)
	return (
		<FieldGroup>
			<Field>
				<FieldLabel>Name</FieldLabel>
				<Input value={account?.profile.name ?? ""} readOnly />
			</Field>
			<Field>
				<FieldLabel>Email</FieldLabel>
				<Input value={account?.profile.email ?? ""} readOnly />
				<FieldDescription>
					Your sign-in provider keeps your name and email.
				</FieldDescription>
			</Field>
			{membership ? (
				<Field>
					<FieldLabel>Roles in {membership.name}</FieldLabel>
					<div className="flex flex-wrap gap-1.5">
						{membership.roles.map((role) => (
							<Badge key={role} variant="secondary">
								{role}
							</Badge>
						))}
					</div>
				</Field>
			) : null}
			<Field orientation="horizontal">
				<Button variant="outline" onClick={() => void signOut()}>
					Sign out
				</Button>
			</Field>
		</FieldGroup>
	)
}

function TokenSettings() {
	const result = useAtomValue(tokensAtom)
	const tokens = resultValue(result)
	const create = useAtomSet(createTokenAtom, { mode: "promise" })
	const revoke = useAtomSet(revokeTokenAtom, { mode: "promise" })
	const [name, setName] = useState("")
	const [secret, setSecret] = useState<string>()
	const { copied, copy } = useCopy()
	const fail = (cause: unknown) => toast.error(errorMessage(cause))

	return (
		<div className="flex flex-col gap-6">
			<form
				onSubmit={(event) => {
					event.preventDefault()
					if (name.trim().length === 0) return
					create({ name: name.trim() }).then((created) => {
						setSecret(created.secret)
						setName("")
					}, fail)
				}}
			>
				<FieldSet>
					<Field>
						<FieldLabel htmlFor="token-name">New token</FieldLabel>
						<div className="flex gap-2">
							<Input
								id="token-name"
								value={name}
								maxLength={80}
								onChange={(event) => setName(event.target.value)}
								placeholder="For example: my script"
							/>
							<Button type="submit" disabled={name.trim().length === 0}>
								Create
							</Button>
						</div>
						<FieldDescription>
							Programs use a token to call the OpenBot API for you. Send it in
							the <code>Authorization: Bearer</code> header.
						</FieldDescription>
					</Field>
				</FieldSet>
			</form>

			{secret ? (
				<Field>
					<FieldLabel>Copy your token now</FieldLabel>
					<InputGroup className="h-11 rounded-full">
						<InputGroupInput value={secret} readOnly className="font-mono" />
						<InputGroupAddon align="inline-end" className="pr-2 has-[>button]:mr-0">
							<InputGroupButton
								size="icon-xs"
								className="size-7 rounded-full"
								aria-label="Copy"
								onClick={() => copy(secret)}
							>
								{copied ? <CheckIcon /> : <CopyIcon />}
							</InputGroupButton>
						</InputGroupAddon>
					</InputGroup>
					<FieldDescription>
						You see this secret only once. Keep it in a safe place.
					</FieldDescription>
				</Field>
			) : null}

			{tokens === undefined ? (
				result._tag === "Failure" ? (
					<p className="text-body-small text-muted-foreground">
						{errorMessage(result.cause)}
					</p>
				) : (
					<Skeleton className="h-16 w-full" />
				)
			) : tokens.length === 0 ? (
				<Empty className="bg-muted/50">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<KeyRoundIcon />
						</EmptyMedia>
						<EmptyTitle>No tokens yet</EmptyTitle>
						<EmptyDescription>Tokens that you make show here.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ItemGroup className="gap-2">
					{tokens.map((token) => (
						<Item key={token.id} variant="outline" size="sm">
							<ItemMedia variant="icon">
								<KeyRoundIcon />
							</ItemMedia>
							<ItemContent>
								<ItemTitle>{token.name}</ItemTitle>
								<ItemDescription>
									<span className="font-mono">{token.prefix}…</span> · made{" "}
									{new Date(token.createdAt).toLocaleDateString()}
									{token.lastUsedAt
										? ` · last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
										: " · never used"}
									{token.expiresAt
										? ` · ends ${new Date(token.expiresAt).toLocaleDateString()}`
										: ""}
								</ItemDescription>
							</ItemContent>
							<ItemActions>
								<Button
									variant="ghost"
									size="icon"
									aria-label={`Revoke ${token.name}`}
									onClick={() =>
										revoke(token.id).then(
											() => toast.success("Token revoked"),
											fail,
										)
									}
								>
									<Trash2Icon />
								</Button>
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
			)}
		</div>
	)
}
