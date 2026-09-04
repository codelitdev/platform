# MCP transport source comparison

Status: accepted for Phase 3 extraction.

Canonical sources for `@codelitdev/mcp-server-kit`. Products keep tool
names, Zod schemas, authorization, and service calls.

| Concern                                | Canonical source                                                                                                            | Origin                                             | Notes                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| Streamable HTTP + request-local server | `frontlit/apps/api/src/mcp/server.ts`, `routes.ts` (`createMcpHandler`, `toNodeHandler`)                                    | FrontLit                                           | One request-local `McpServer`; modern Streamable HTTP.                  |
| Session map + Accept patching          | `medialit/apps/api/src/mcp/routes.ts` (`StreamableHTTPServerTransport`, `Mcp-Session-Id`)                                   | MediaLit                                           | Session store, GET/POST/DELETE, expose `Mcp-Session-Id`.                |
| CORS + protocol headers                | FrontLit `mcpCors` and MediaLit `mcpCors`                                                                                   | FrontLit (header names), MediaLit (session expose) | Allow `Authorization`, API-key header, `MCP-Protocol-Version`.          |
| OAuth bearer + API-key hooks           | FrontLit `mcp/auth-context.ts`, `auth/middleware.ts` (`createAuthMiddleware("mcp")`); SendLit `auth/middleware.ts` MCP mode | FrontLit                                           | MCP is OAuth or API key, never browser sessions.                        |
| Context into tools                     | FrontLit `createFrontLitMcpAuthInfo` + tool handlers calling application services                                           | FrontLit                                           | Kit carries opaque context; product fills principal/tenant/permissions. |
| Error mapping                          | FrontLit MCP tools + platform `PlatformError` mapping                                                                       | Platform kernel                                    | Stable codes; no `cause` leakage.                                       |
| Cancellation / shutdown                | MediaLit session `Map` teardown; FrontLit process shutdown                                                                  | MediaLit sessions                                  | Kit owns session delete + abort signal.                                 |
| Test harness                           | FrontLit `mcp/*.test.ts`; MediaLit `__tests__/mcp/*`                                                                        | FrontLit                                           | Invoke tools with fixture auth without a live MCP client.               |
| OAuth resource metadata                | `@codelitdev/oauth-server-kit/mcp` `createMcpOAuthDiscoveryRoutes` used by FrontLit/SendLit                                 | oauth-server-kit                                   | Remains in oauth-server-kit, not duplicated.                            |

**Selected origin canary (published artifact):** FrontLit, after the kit is published. This workspace cannot land that canary.

Tool catalogs (pages, media, mail, …) stay product-owned.
