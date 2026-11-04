import assert from "node:assert/strict"
import { test } from "node:test"
import {
	chooseLocale,
	readLocale,
	saveLocale,
	localeStorageKey,
} from "../src/Localization.ts"

test("a saved supported locale takes priority over browser languages", () => {
	assert.equal(chooseLocale("zh-CN", ["de-DE", "en-US"]), "zh-CN")
	assert.equal(chooseLocale("de", ["en-US"]), "de")
})

test("browser languages match in preference order and unsupported values fall back", () => {
	assert.equal(chooseLocale(null, ["fr-FR", "de-AT", "en-US"]), "de")
	assert.equal(chooseLocale(null, ["zh-TW", "en"]), "zh-CN")
	assert.equal(chooseLocale(null, ["EN-gb", "de"]), "en")
	assert.equal(chooseLocale("invalid", ["de-DE"]), "de")
	assert.equal(chooseLocale(null, ["fr-FR"]), "en")
	assert.equal(chooseLocale(null, []), "en")
})

test("a selected language survives a subsequent visit", () => {
	let saved: string | null = null
	const storage = {
		getItem: (key: string) => {
			assert.equal(key, localeStorageKey)
			return saved
		},
		setItem: (key: string, value: string) => {
			assert.equal(key, localeStorageKey)
			saved = value
		},
	}
	saveLocale(storage, "zh-CN")
	assert.equal(readLocale(storage, ["en-US"]), "zh-CN")
})

test("denied storage does not prevent locale selection", () => {
	const storage = {
		getItem: () => {
			throw new Error("Storage access denied")
		},
		setItem: () => {
			throw new Error("Storage access denied")
		},
	}
	assert.equal(readLocale(storage, ["de-DE"]), "de")
	assert.doesNotThrow(() => saveLocale(storage, "zh-CN"))
	assert.equal(readLocale(undefined, ["zh-HK"]), "zh-CN")
})
