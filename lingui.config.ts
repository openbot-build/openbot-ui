import { defineConfig } from "@lingui/cli"
import { formatter } from "@lingui/format-po"

export default defineConfig({
	locales: ["en", "zh-CN", "de"],
	sourceLocale: "en",
	catalogs: [{ path: "src/locales/{locale}", include: ["src"] }],
	format: formatter({ lineNumbers: false }),
})
