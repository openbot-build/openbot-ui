import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { open } from "node:fs/promises"
import { constants } from "node:fs"

export interface ComputeBinding {
	readonly accountId: string
	readonly organizationId: string
	readonly computerId: string
	readonly generation: number
}

/** The operator keeps this independent key in a private, persistent secret file. */
export const readComputeKey = async (path: string): Promise<Buffer> => {
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
	try {
		const stat = await file.stat()
		if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size !== 32)
			throw new Error(
				"The compute key must be a private file containing exactly 32 bytes.",
			)
		return await file.readFile()
	} finally {
		await file.close()
	}
}

const associated = (binding: ComputeBinding) =>
	Buffer.from(
		JSON.stringify([
			"kay-basic-compute-v1",
			binding.accountId,
			binding.organizationId,
			binding.computerId,
			binding.generation,
		]),
	)

export const sealComputeToken = (input: {
	readonly key: Buffer
	readonly binding: ComputeBinding
	readonly token: string
}): string => {
	const iv = randomBytes(12)
	const cipher = createCipheriv("aes-256-gcm", input.key, iv)
	cipher.setAAD(associated(input.binding))
	const ciphertext = Buffer.concat([
		cipher.update(input.token, "utf8"),
		cipher.final(),
	])
	return [
		"v1",
		iv.toString("base64url"),
		cipher.getAuthTag().toString("base64url"),
		ciphertext.toString("base64url"),
	].join(".")
}

export const openComputeToken = (input: {
	readonly key: Buffer
	readonly binding: ComputeBinding
	readonly ciphertext: string
}): string => {
	try {
		const [version, nonce, tag, data, extra] = input.ciphertext.split(".")
		if (
			version !== "v1" ||
			nonce === undefined ||
			tag === undefined ||
			data === undefined ||
			extra !== undefined
		)
			throw new Error()
		const decipher = createDecipheriv(
			"aes-256-gcm",
			input.key,
			Buffer.from(nonce, "base64url"),
		)
		decipher.setAAD(associated(input.binding))
		decipher.setAuthTag(Buffer.from(tag, "base64url"))
		return Buffer.concat([
			decipher.update(Buffer.from(data, "base64url")),
			decipher.final(),
		]).toString("utf8")
	} catch {
		throw new Error("The compute connector credential could not be opened.")
	}
}
