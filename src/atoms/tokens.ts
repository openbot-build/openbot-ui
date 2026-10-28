import { UserTokensApi } from "@openbot-build/client/Api"
import { Effect, Redacted, Schema } from "effect"
import * as Atom from "effect/reactivity/Atom"
import { Api, apiRuntime } from "@/lib/api"

const tokensKey = "tokens"

/** The user tokens of the person. Programs use them to call the API. */
export const tokensAtom = apiRuntime
	.atom(
		Effect.gen(function* () {
			const client = yield* Api
			const list = yield* client.api.userTokens.listTokens()
			return list.items
		}),
	)
	.pipe(Atom.withReactivity([tokensKey]))

/** Makes a token. The answer has the secret, and only this once. */
export const createTokenAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (input: {
		readonly name: string
		readonly expiresInDays?: number
	}) {
		const client = yield* Api
		const created = yield* client.api.userTokens.createToken({
			payload: {
				name: input.name,
				...(input.expiresInDays ? { expiresInDays: input.expiresInDays } : {}),
			},
		})
		return { ...created, secret: Redacted.value(created.secret) }
	}),
	{ reactivityKeys: [tokensKey] },
)

/** Revokes a token, so it stops working at once. */
export const revokeTokenAtom = apiRuntime.fn(
	Effect.fnUntraced(function* (id: string) {
		const client = yield* Api
		const tokenId = yield* Schema.decodeUnknownEffect(UserTokensApi.TokenId)(id)
		yield* client.api.userTokens.revokeToken({ params: { tokenId } })
	}),
	{ reactivityKeys: [tokensKey] },
)
