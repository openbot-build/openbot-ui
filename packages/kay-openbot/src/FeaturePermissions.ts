import generated from "./FeaturePermissions.json" with { type: "json" }

interface Requirement {
	readonly kind: string
	readonly action: string
}
const requirements: Readonly<Record<string, ReadonlyArray<Requirement>>> =
	generated

/** Only the core decides permissions. This controls the product's visible actions. */
export const visibleCatalog = <T extends { readonly id: string }>(input: {
	readonly catalog: ReadonlyArray<T>
	readonly platformAdmin: boolean
	readonly resources: ReadonlyArray<{
		readonly kind: string
		readonly actions: ReadonlyArray<string>
	}>
}): ReadonlyArray<T> =>
	input.catalog.filter((operation) =>
		(requirements[operation.id] ?? []).every(({ kind, action }) =>
			kind === "Platform"
				? input.platformAdmin
				: input.resources.some(
						(resource) =>
							resource.kind === kind && resource.actions.includes(action),
					),
		),
	)
