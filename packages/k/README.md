# @kaicom/k

K Protocol V1.1 实现库，使用 Effect 4.0.5，MCP `2026-07-28` 与 MCP Apps `2026-01-26`。当前版本为工作区源码 `0.1.0`，尚未发布到 npm。

```ts
import { McpPublisher } from "@kaicom/k"
import { Document } from "@kaicom/k"
import { Effect, Schema } from "effect"
import { McpServer, Tool, Toolkit } from "effect/ai"

const tools = Toolkit.make(
	Tool.make("Hello", {
		parameters: Schema.Struct({ name: Schema.String }),
		success: Schema.Struct({ greeting: Schema.String }),
	}),
)
const handlers = tools.toLayer({
	Hello: ({ name }) => Effect.succeed({ greeting: `Hello, ${name}` }),
})
const origin = "https://apps.example.com"
const publisher = McpPublisher.layer({
	publication: {
		card: {
			$schema: Document.cardSchemaUrl,
			name: "com.example/hello",
			version: "1.0.0",
			description: "Say hello",
			remotes: [
				{
					type: "streamable-http",
					url: origin + "/mcp",
					supportedProtocolVersions: [Document.protocolVersion],
				},
			],
		},
		cardUrl: origin + "/mcp/server-card",
		catalogUrl: origin + "/.well-known/ai-catalog.json",
		mcpUrl: origin + "/mcp",
		allowedOrigins: ["https://host.example.com"],
	},
	register: McpServer.registerToolkit(tools).pipe(Effect.provide(handlers)),
})
```

将 `publisher` 接入 Effect `HttpRouter.serve` 并装配运行环境 HTTP server Layer。导入及构建 Layer 不执行 I/O，运行和关闭由宿主负责。业务处理使用原生 Effect Toolkit、资源和提示词；标准客户端可直接访问，服务账号、可信确认和持久存储由接入方提供。

Card 与 Catalog 可配置 `etag`、`lastModified`、`cacheControl`；调用方内容变更时更新验证值。`noindex` 设置 Card 的 `X-Robots-Tag`。介绍页使用 `McpPublisher.catalogLinkHtml` 或 `catalogLinkHeader`，二维码内容就是对应 HTTPS 链接。

UI 资源用 `McpPublisher.registerUi` 注册，工具用原生 `Tool.Meta` 的 `_meta.ui` 关联 `ui://` 地址。`McpPublisher.uiToolMeta` 可校验关联声明。工具结果保留标准文本和结构化数据，HTML 资源本身不授予业务许可。

浏览器宿主从 `@kaicom/k/McpApps` 调用 `mount`，为 `McpClient.open` 提供 `Ui.clientCapabilities`，并显式装配 `Apps.HostActions`。UI 资源直接挂载到单个 iframe，使用宿主页面环境。挂载使用已绑定的受控 Client，不向 UI 交出 SDK Client 或凭据；工具结果可先完成，界面失败和重载不会重新调用写工具。普通入口不导出浏览器宿主。

[完整调用说明](../../docs/k-library.md) · [开发 TLS 示例](../../samples/k-protocol/README.md)

发现入口为 `Discovery.resolve`，需要 `CatalogDiscovery.layer`、`CatalogDiscovery.layerRules` 及网络 Layer。公共 Node 网络从 `@kaicom/k/NodeHttpServer` 的 `layerPublicNetwork` 装配；内部网络需明确使用 `layerUserNetwork` 并提供目标许可。普通入口不加载 Node Agent 或浏览器宿主。

确认添加用 `AppConnections.add`，受控调用用 `McpClient.open` 和返回客户端的业务方法。运行入口装配 `Store.AppStore`、`Store.CredentialStore`、`App.ConnectionScopes`、`Client.InvocationPolicy` 及网络能力。进程内 Layer 与调用、分页、后续输入和错误处理见完整调用说明；业务请求先检查当前连接与宿主许可，写请求不自动重试。

需要账户的连接先保存为待授权，再明确调用 `OAuthAuthorization.begin` 和可信回调入口中的 `complete`。装配 `Authorization.FlowStore`、原生 `Crypto.Crypto` 与对应连接的凭据存储；`refresh` 和 `revoke` 是显式操作。`OAuthAuthorization.layerClientMetadata` 发布 CIMD 文档，`readClientMetadata` 供授权服务器校验 client_id 和 redirect URI。

受保护发布者使用 `McpPublisher.layerProtected`，必须提供实际 `Protection.TokenVerifier` 和 `Protection.AccessPolicy`。令牌的 issuer、audience、有效期、权限均经过检查，列表按当前账户过滤；业务处理函数通过 `PublisherProtection.currentIdentity` 取得真实 HTTP 调用身份，并声明原生 `McpSchema.McpRequestContext` 依赖。库不承担身份登录或令牌签发。

`Indexing.sync(added.publicHints)` 独立验证匿名 Card、发布者 Catalog、robots 与 noindex，返回 `Indexed`、`Excluded`、`Withdrawn` 或 `Unconfirmed`。装配 `PublicIndexing.layer`、`CatalogDiscovery.layerRules`、`RobotsPolicy.layer`、`Index.IndexStore` 和独立 `Network.PublicNetwork`；进程内目录为 `MemoryIndex.layer`，不复用私有连接或凭据。公共收录失败不影响已有连接。

`AppConnections.remove(key)` 先停用并释放活动 Scope，再撤销和清理本地凭据；`CleanupPending` 可重试且保持不可调用。`AppConnections.revalidate` 同步描述，端点、issuer、scope 或私有配置变化需要明确确认及新的授权，原凭据不转移。完整契约及发布者证据规则见完整调用说明。

公开契约按能力组织，生产 Layer 与构造器通过具体职责入口选择。`Discovery.Rules` 包含输入解析、连接配置、描述比较和 Catalog 提取算法，由 `CatalogDiscovery.layerRules` 提供；发现、索引和连接维护按服务契约消费这些规则。`Robots.Robots` 由 `RobotsPolicy.layer` 提供，可独立替换索引策略。`Ui.Ui` 由 `AppUi.layer` 提供，浏览器 Apps 在构建时取得资源规则。Node 和浏览器生产适配分别从 `@kaicom/k/NodeHttpServer`、`@kaicom/k/McpApps` 导入，通用根入口保持与运行环境无关。

`Client.Continuation` is the serializable association for a standard MRTR operation. Persist it with the original owner, connection and permission decision; `client.resume(continuation, responses, callOptions)` validates standard responses, negotiated input capabilities and the current invocation policy before echoing the original request state. `McpClient.validateInputs(continuation, responses)` checks IDs and form content without network I/O, so a host can keep invalid input editable. A continuation is not a fresh tool call or a general retry token. Possibly writing calls do not retry after transport loss; protocol and Schema failures after sending report `OutcomeUnknown` with their cause.

## Public App presentation

Reuse standard `card.icons` for App identity. Optional usage examples live at `card._meta[Document.presentationKey]`, where the key is `com.kai/presentation`. Define them with `Document.Presentation.make({ version: "1", examples: [...] })` or validate untrusted author input with `Document.Presentation.decode`. Each example contains `id`, `title`, `prompt`, optional `description` and an optional HTTPS preview image with `src`, `alt`, `width`, `height` and `mimeType`. The [protocol reference](../../docs/k-protocol.md#app-icons-and-usage-examples) contains the complete declaration and bounds.

`McpPublisher.validate` checks declared K presentation. `Document.presentationFromCard(card)` returns an Effect `Option` for host rendering; absent, invalid or unsupported metadata yields `None` without changing compatible remotes. Discovery and Index records retain the complete Card, including standard icons, presentation and unrelated metadata. Reading presentation performs no I/O and never submits an example or grants App access. Keep publisher illustrations distinct from actual account data and runtime-verified capabilities.

`McpApps.UiClient` is the narrow client surface required by `mount`, allowing a Platform HTTP proxy without exposing or fabricating a full protocol client. Mount searches all tool pages for its declaration and rejects repeating cursors. Hosts can declare the content modalities they implement through `HostActions.contentTypes`; the default preserves the existing direct host behavior.

## Read-only publication inspection

`Indexing.inspect` evaluates current anonymous indexing eligibility without requiring an `IndexStore`, writing an Index entry, or opening an MCP connection. `PublicIndexing.layerInspection` and the existing synchronization Layer share the same robots, noindex, publication association and conditional-request rules. Results include `Eligible`, `Excluded` or `Unconfirmed` and timestamped stages; later stages remain `NotChecked` when an earlier stage cannot complete.

```ts
import {
	CatalogDiscovery,
	Indexing,
	PublicIndexing,
	RobotsPolicy,
} from "@kaicom/k"
import * as NodeHttpServer from "@kaicom/k/NodeHttpServer"
import { Effect, Layer } from "effect"

const inspection = PublicIndexing.layerInspection.pipe(
	Layer.provide(CatalogDiscovery.layerRules),
	Layer.provide(RobotsPolicy.layer),
	Layer.provide(NodeHttpServer.layerPublicNetwork()),
)
const check = Indexing.Input.decode({
	cardUrl: "https://example.com/card.json",
}).pipe(Effect.flatMap(Indexing.inspect), Effect.provide(inspection))
```

A source hint does not establish publisher control or authorize indexing a third-party App. The Card and publisher must independently establish the publication association. A live eligible result does not imply that an Index entry has been persisted.

For a host that records each discovery phase separately, `McpClient.open({ ...options, eagerLists: false })` defers capability listing until the host requests it. List methods accept `singlePage: true` to expose a single protocol page and its cursor; their default behavior retains complete list aggregation. `OAuthAuthorization.revokeRemote` performs only the provider revocation step, allowing a host to persist that outcome before separately deleting local credentials.

## Standard hosted MCP interoperability

`McpClient` keeps K publication strict by default. A host may explicitly select standard MCP for an independently configured remote connection, using real negotiated server capabilities and version rather than inventing a K discovery result. Standard connections may have no `discovery`; consumers should use the reported capabilities and server identity. Automatically negotiated connections omit elicitation, sampling and roots for legacy initialize handshakes because those server-initiated request handlers are not implemented. Modern discovery restores the supplied MRTR capabilities by adopting the live result with the SDK prior-discovery connection API. Manual modern endpoints and strict K connections retain the existing MRTR capability and continuation contract; supplying an MRTR handler does not enable older request channels.

For standard remote services, the host may opt into Dynamic Client Registration when the authorization server advertises it and does not support CIMD. CIMD remains preferred and is required for K-published services. Registration uses the host's fixed callback and S256 PKCE. Returned client credentials are owner-bound and persisted through the credential and flow stores; hosts must encrypt those stores. Public clients and supported confidential client methods remain distinct through code exchange, refresh and revocation. Providers with neither supported CIMD nor advertised dynamic registration report an explicit registration failure. No provider consent is granted by discovering or registering a client.

Protocol references: [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) and [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
