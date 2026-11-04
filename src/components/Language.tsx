import { i18n } from "@lingui/core"
import { I18nProvider, useLingui } from "@lingui/react"
import { t } from "@lingui/core/macro"
import { Schema } from "effect"
import { useEffect, useId, useState, type ReactNode } from "react"
import { Locale, chooseLocale, readLocale, saveLocale } from "../Localization"
import { messages as en } from "../locales/en.po"
import { messages as zh } from "../locales/zh-CN.po"
import { messages as de } from "../locales/de.po"
import { NativeSelect, NativeSelectOption } from "./ui/native-select"

export function initializeLocalization() {
	i18n.load({ en, "zh-CN": zh, de })
	if (i18n.locale === "") i18n.activate("en")
	return i18n
}

export function LocalizationProvider({
	children,
}: {
	readonly children: ReactNode
}) {
	const [instance] = useState(initializeLocalization)
	useEffect(() => {
		let locale: Locale
		try {
			locale = readLocale(window.localStorage, navigator.languages)
		} catch {
			locale = chooseLocale(undefined, navigator.languages)
		}
		instance.activate(locale)
	}, [instance])
	return (
		<I18nProvider i18n={instance}>
			<DocumentLanguage />
			{children}
		</I18nProvider>
	)
}

function DocumentLanguage() {
	const { i18n } = useLingui()
	useEffect(() => {
		document.documentElement.lang = i18n.locale
	}, [i18n, i18n.locale])
	return null
}

export function Language() {
	const { i18n } = useLingui()
	const id = useId()
	return (
		<section className="flex items-center justify-between gap-4 text-sm">
			<label htmlFor={id}>{t`Interface language`}</label>
			<NativeSelect
				id={id}
				value={i18n.locale}
				onChange={(event) => {
					const locale = Schema.decodeUnknownSync(Locale)(event.target.value)
					i18n.activate(locale)
					try {
						saveLocale(window.localStorage, locale)
					} catch {
						/* Storage access can be denied by the browser. */
					}
				}}
			>
				<NativeSelectOption value="en" lang="en">
					English
				</NativeSelectOption>
				<NativeSelectOption value="zh-CN" lang="zh-CN">
					简体中文
				</NativeSelectOption>
				<NativeSelectOption value="de" lang="de">
					Deutsch
				</NativeSelectOption>
			</NativeSelect>
		</section>
	)
}
