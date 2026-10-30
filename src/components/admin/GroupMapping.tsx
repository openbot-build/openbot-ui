import { AccessApi } from "@openbot-build/client/Api"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { TextField, words } from "./Fields"
export function GroupMapping({
	value,
	onChange,
	organizationId,
	platform = false,
}: {
	value: AccessApi.ProviderAccess
	onChange: (v: AccessApi.ProviderAccess) => void
	organizationId?: string
	platform?: boolean
}) {
	const change = (p: Partial<AccessApi.ProviderAccess>) =>
		onChange({ ...value, ...p })
	return (
		<div className="space-y-5">
			{platform && (
				<label className="flex items-center gap-3">
					<Switch
						checked={value.trusted}
						onCheckedChange={(trusted) => change({ trusted })}
					/>
					Allow this provider to use the trusted SSO policy
				</label>
			)}
			<TextField
				label="Extra scopes"
				value={value.scopes.join(" ")}
				onChange={(v) => change({ scopes: words(v) })}
				hint="Separate scope names with spaces."
			/>
			<TextField
				label="Groups claim"
				value={value.groupsClaim ?? ""}
				onChange={(v) => change({ groupsClaim: v || null })}
				hint="An array of exact group names in the signed ID token. When set, default organization roles are not added."
			/>
			<TextField
				label="Required groups"
				value={value.requiredGroups.join(", ")}
				onChange={(v) =>
					change({
						requiredGroups: v
							.split(",")
							.map((x) => x.trim())
							.filter(Boolean),
					})
				}
				hint="At least one must match. Group names are case sensitive."
			/>
			<div className="space-y-4">
				{value.mappings.map((m, i) => (
					<div key={i} className="space-y-3 rounded-action-panel nested-controls bg-muted p-(--action-inset)">
						<TextField
							label="Group value"
							value={m.group}
							onChange={(group) =>
								change({
									mappings: value.mappings.map((x, n) =>
										n === i ? { ...x, group } : x,
									),
								})
							}
						/>
						{!organizationId && (
							<TextField
								label="Organization ID"
								value={m.organizationId}
								onChange={(id) =>
									change({
										mappings: value.mappings.map((x, n) =>
											n === i ? { ...x, organizationId: id } : x,
										),
									})
								}
							/>
						)}
						<TextField
							label="Role IDs"
							value={m.roles.join(", ")}
							hint="Separate roles with commas. Use member, auditor, administrator_read_only, administrator, or a custom role ID. Super Administrator is not allowed."
							onChange={(v) =>
								change({
									mappings: value.mappings.map((x, n) =>
										n === i ? { ...x, roles: words(v) as typeof x.roles } : x,
									),
								})
							}
						/>
						<Button
							type="button"
							variant="secondary"
							onClick={() =>
								change({ mappings: value.mappings.filter((_, n) => n !== i) })
							}
						>
							Remove mapping
						</Button>
					</div>
				))}
			</div>
			<Button
				type="button"
				variant="secondary"
				onClick={() =>
					change({
						mappings: [
							...value.mappings,
							{
								group: "",
								organizationId: organizationId ?? "",
								roles: ["member"],
							},
						],
					})
				}
			>
				Add group mapping
			</Button>
			<p className="text-body-medium text-muted-foreground">
				Roles are checked again at the next SSO sign-in. Suspend the account for
				immediate removal of access. Manual roles stay in place. The Super
				Administrator role must be granted by hand.
			</p>
		</div>
	)
}
