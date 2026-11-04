import { Schema } from "effect"

/** OpenBot verifies the credential; Kay selects only its explicitly configured organization. */
const AccountSession = Schema.Struct({
	userId: Schema.NonEmptyString,
	profile: Schema.JsonObject,
	expiresAt: Schema.String,
	memberships: Schema.Array(
		Schema.Struct({
			organizationId: Schema.NonEmptyString,
			status: Schema.Literals(["active", "suspended"]),
		}),
	),
})

export class OrganizationUnavailable extends Error {}
export class MembershipDenied extends Error {}

// Match KAI Auth's avatar byte limit; Auth owns image decoding and dimensions.
const avatarDataPrefix = "data:image/jpeg;base64,"
const avatarMaxBytes = 2 * 1024 * 1024
const avatarMaxEncodedLength = Math.ceil(avatarMaxBytes / 3) * 4

/** Only use the image supplied by the verified identity provider. */
export const avatarUrl = (
	profile: Readonly<Record<string, unknown>>,
): string | null => {
	const value = profile["picture"] ?? profile["image"]
	if (typeof value !== "string" || value.length === 0) return null
	if (value.startsWith(avatarDataPrefix)) {
		const encoded = value.slice(avatarDataPrefix.length)
		if (
			encoded.length === 0 ||
			encoded.length > avatarMaxEncodedLength ||
			encoded.length % 4 !== 0 ||
			!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
		)
			return null
		const bytes = Buffer.from(encoded, "base64")
		return bytes.byteLength >= 8 &&
			bytes.byteLength <= avatarMaxBytes &&
			bytes.toString("base64") === encoded &&
			bytes[0] === 0xff &&
			bytes[1] === 0xd8 &&
			bytes[2] === 0xff &&
			bytes.at(-2) === 0xff &&
			bytes.at(-1) === 0xd9
			? value
			: null
	}
	try {
		const url = new URL(value)
		return (url.protocol === "https:" || url.protocol === "http:") &&
			url.username === "" &&
			url.password === ""
			? url.href
			: null
	} catch {
		return null
	}
}

export const accountId = (value: unknown): string =>
	Schema.decodeUnknownSync(AccountSession)(value).userId

// @effect-diagnostics-next-line missingPipeableSignature:off
export const session = (value: unknown, organizationId: string | undefined) => {
	const account = Schema.decodeUnknownSync(AccountSession)(value)
	if (organizationId === undefined || organizationId === "")
		throw new OrganizationUnavailable(
			"Kay's target organization is not configured.",
		)
	const matching = account.memberships.filter(
		(member) => member.organizationId === organizationId,
	)
	if (matching.length !== 1 || matching[0]?.status !== "active")
		throw new MembershipDenied(
			"This account does not have an active Kay membership.",
		)
	return {
		identity: { userId: account.userId, organizationId },
		profile: account.profile,
		expiresAt: account.expiresAt,
	}
}
