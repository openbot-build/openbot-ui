import { defineConfig } from "tsdown"

export default defineConfig([
	...(["Main", "Migrate", "Readiness"] as const).map((name) => ({
		cwd: "../packages/kay-api",
		entry: { [name]: `src/${name}.ts` },
		outDir: "../../.devenv/kay-api/dist",
		clean: false,
		format: "esm" as const,
		fixedExtension: true,
		platform: "node" as const,
		target: "node26",
		dts: false,
		deps: { alwaysBundle: [/.*/] },
		outputOptions: { codeSplitting: false },
	})),
])
