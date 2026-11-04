import config from "../../tsdown.config.ts"
export default {
	...config,
	entry: ["src/index.ts", "src/Client.ts", "src/Native.ts"],
	platform: "neutral" as const,
}
