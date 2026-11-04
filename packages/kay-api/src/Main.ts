import { createNativeClient } from "@kaicom/kay-openbot"
import { closeNativeLiveProxy } from "./NativeLiveProxy.ts"
import { makeTelemetry } from "./Telemetry.ts"
import { fromEnvironment } from "./Configuration.ts"
import { runtime } from "./Database.ts"
import { createGateway } from "./Gateway.ts"
import { createExecutionAuthority } from "./ExecutionAuthority.ts"

const config = fromEnvironment(process.env)
const db = runtime(config)
const telemetry = makeTelemetry()
const server = createGateway({
	config,
	db,
	telemetry,
	...(config.nextEnabled === true
		? { nativeProduct: createNativeClient({ origin: config.openbotOrigin }) }
		: {}),
})
server.listen(config.port, "0.0.0.0")
// A fresh native installation has one core and no legacy migration authority.
const authority =
	config.backendRouting === "native"
		? undefined
		: createExecutionAuthority({ config, runtime: db, telemetry })
authority?.listen(config.internalPort, "0.0.0.0")
let stopping: Promise<void> | undefined
const close = (value: typeof server) =>
	new Promise<void>((resolve, reject) =>
		value.close((error) => (error !== undefined ? reject(error) : resolve())),
	)
const stop = () => {
	closeNativeLiveProxy(server)
	stopping ??= Promise.all([
		close(server),
		...(authority === undefined ? [] : [close(authority)]),
	])
		.then(() => undefined)
		.finally(() => db.dispose())
	void stopping
}
process.on("SIGTERM", stop)
process.on("SIGINT", stop)
