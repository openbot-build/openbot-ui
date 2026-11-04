// @effect-diagnostics missingPipeableSignature:off
import { Array, Option, Schema } from "effect"

export const Locale = Schema.Literals(["en", "zh-CN", "de"])
export type Locale = typeof Locale.Type
export const localeStorageKey = "e-locale"

export const chooseLocale = (
	saved: unknown,
	languages: ReadonlyArray<string>,
): Locale =>
	Schema.decodeUnknownOption(Locale)(saved).pipe(
		Option.orElse(() =>
			Array.findFirst(
				Array.getSomes(
					Array.map(languages, (language) => {
						const base = language.toLowerCase().split("-")[0]
						return base === "zh"
							? Option.some<Locale>("zh-CN")
							: Schema.decodeUnknownOption(Locale)(base)
					}),
				),
				() => true,
			),
		),
		Option.getOrElse((): Locale => "en"),
	)

export const readLocale = (
	storage: Pick<Storage, "getItem"> | undefined,
	languages: ReadonlyArray<string>,
): Locale => {
	try {
		return chooseLocale(storage?.getItem(localeStorageKey), languages)
	} catch {
		return chooseLocale(undefined, languages)
	}
}

export const saveLocale = (
	storage: Pick<Storage, "setItem"> | undefined,
	locale: Locale,
): void => {
	try {
		storage?.setItem(localeStorageKey, locale)
	} catch {
		// The current visit can still use the selected language without storage.
	}
}
