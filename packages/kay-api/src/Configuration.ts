import { Schema } from "effect"

export const Configuration = Schema.Struct({
	port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
	publicOrigin: Schema.String,
	eOrigin: Schema.String,
	openbotOrigin: Schema.String,
	openbotOrganizationId: Schema.optionalKey(Schema.NonEmptyString),
	/** Only this verified account may administer membership codes, with native admin permission. */
	membershipCodeManagerAccountId: Schema.optionalKey(Schema.NonEmptyString),
	basicComputeSocket: Schema.optionalKey(Schema.NonEmptyString),
	basicComputeKeyFile: Schema.optionalKey(Schema.NonEmptyString),
	/** Only an accepted native Chat release can enable the new product API. */
	nextEnabled: Schema.optionalKey(Schema.Boolean),
	authBackend: Schema.Literals(["e", "openbot", "ledger"]),
	/** Extraction keeps e authoritative until the identity and data gates pass. */
	backendRouting: Schema.Literals(["e", "ledger", "native"]),
	databaseUrl: Schema.String,
	internalPort: Schema.Int.check(
		Schema.isBetween({ minimum: 1, maximum: 65535 }),
	),
	internalToken: Schema.NonEmptyString.check(Schema.isMinLength(32)),
})
export type Configuration = typeof Configuration.Type

/** Database-only commands share the server's connection configuration. */
export const databaseFromEnvironment = (
	env: NodeJS.ProcessEnv,
): Pick<Configuration, "databaseUrl"> => {
	try {
		const databaseUrl = Schema.decodeUnknownSync(
			Configuration.fields.databaseUrl,
		)(env["KAY_DATABASE_URL"])
		const parsed = new URL(databaseUrl)
		if (
			!["postgres:", "postgresql:"].includes(parsed.protocol) ||
			parsed.hash !== ""
		)
			throw new Error("Invalid database URL")
		return { databaseUrl }
	} catch {
		// Connection strings can contain credentials; do not include their values.
		throw new Error("KAY_DATABASE_URL must be a non-empty PostgreSQL URL.")
	}
}

export const fromEnvironment = (env: NodeJS.ProcessEnv): Configuration => {
	if (
		env["KAY_NEXT_ENABLED"] !== undefined &&
		!["true", "false"].includes(env["KAY_NEXT_ENABLED"]!)
	)
		throw new Error("KAY_NEXT_ENABLED must be true or false.")
	const config = Schema.decodeUnknownSync(Configuration)({
		port: Number(env["PORT"] ?? "3100"),
		publicOrigin: env["KAY_PUBLIC_ORIGIN"],
		eOrigin:
			env["KAY_E_ORIGIN"] ??
			(env["KAY_BACKEND_ROUTING"] === "native"
				? env["KAY_OPENBOT_ORIGIN"]
				: undefined),
		openbotOrigin: env["KAY_OPENBOT_ORIGIN"],
		nextEnabled: env["KAY_NEXT_ENABLED"] === "true",
		...(env["KAY_BASIC_COMPUTE_SOCKET"] !== undefined &&
		env["KAY_BASIC_COMPUTE_SOCKET"] !== ""
			? { basicComputeSocket: env["KAY_BASIC_COMPUTE_SOCKET"] }
			: {}),
		...(env["KAY_BASIC_COMPUTE_KEY_FILE"] !== undefined &&
		env["KAY_BASIC_COMPUTE_KEY_FILE"] !== ""
			? { basicComputeKeyFile: env["KAY_BASIC_COMPUTE_KEY_FILE"] }
			: {}),
		...(env["KAY_MEMBERSHIP_CODE_MANAGER_ACCOUNT_ID"] !== undefined &&
		env["KAY_MEMBERSHIP_CODE_MANAGER_ACCOUNT_ID"] !== ""
			? {
					membershipCodeManagerAccountId:
						env["KAY_MEMBERSHIP_CODE_MANAGER_ACCOUNT_ID"],
				}
			: {}),
		...(env["KAY_TARGET_ORGANIZATION_ID"] !== undefined &&
		env["KAY_TARGET_ORGANIZATION_ID"] !== ""
			? { openbotOrganizationId: env["KAY_TARGET_ORGANIZATION_ID"] }
			: {}),
		authBackend: env["KAY_AUTH_BACKEND"] ?? "e",
		backendRouting: env["KAY_BACKEND_ROUTING"] ?? "e",
		...databaseFromEnvironment(env),
		internalPort: Number(env["KAY_INTERNAL_PORT"] ?? "3101"),
		internalToken: env["KAY_INTERNAL_TOKEN"],
	})
	for (const origin of [
		config.publicOrigin,
		config.eOrigin,
		config.openbotOrigin,
	]) {
		const parsed = new URL(origin)
		if (
			!["http:", "https:"].includes(parsed.protocol) ||
			parsed.username !== "" ||
			parsed.password !== "" ||
			parsed.pathname !== "/" ||
			parsed.search !== "" ||
			parsed.hash !== ""
		)
			throw new Error("Use a plain HTTP origin.")
	}
	if (config.backendRouting === "ledger" && config.authBackend === "e")
		throw new Error("Unify authentication before enabling account migration.")
	if (
		config.backendRouting === "native" &&
		(config.authBackend !== "openbot" ||
			config.nextEnabled !== true ||
			config.openbotOrganizationId === undefined)
	)
		throw new Error(
			"Native routing requires OpenBot authentication, the new workspace and an explicit Kay organization.",
		)
	if (
		(config.basicComputeSocket === undefined) !==
		(config.basicComputeKeyFile === undefined)
	)
		throw new Error(
			"Basic compute needs both its private socket and persistent key file.",
		)
	for (const path of [config.basicComputeSocket, config.basicComputeKeyFile])
		if (path !== undefined && (!path.startsWith("/") || path.includes("\0")))
			throw new Error("Basic compute paths must be absolute local paths.")
	return config
}
