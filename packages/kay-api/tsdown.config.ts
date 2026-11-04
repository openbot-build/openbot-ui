import config from "../../tsdown.config.ts"
import { defineConfig } from "tsdown"
export default defineConfig({
	...config,
	entry: {
		index: "src/index.ts",
		Main: "src/Main.ts",
		Migrate: "src/Migrate.ts",
		Readiness: "src/Readiness.ts",
		BasicComputeBrokerMain: "src/BasicComputeBrokerMain.ts",
	},
})
