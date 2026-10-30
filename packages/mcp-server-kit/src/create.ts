import {
  type AuthenticationResult,
  captureAndMapException,
  createPlatformError,
  type HeaderMap,
  mapTransportAuthentication,
  type PlatformError,
  selectMcpCredential,
  toPublicHttpError,
} from "@codelitdev/platform";
import {
  type CacheHint,
  type CallToolResult,
  createMcpHandler,
  McpServer,
  type ServerContext,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { z } from "zod";
import { mcpCorsHeaders } from "./cors.js";
import { toMcpInputSchema } from "./schema.js";
import { patchMcpAccept, readMcpResponse, toWebRequest } from "./streamable-http.js";

export type McpToolRisk = "read" | "write" | "destructive";

export type McpToolDefinition<Context> = {
  name: string;
  description: string;
  risk: McpToolRisk;
  inputSchema: z.ZodType;
  handler: (input: {
    context: Context;
    args: unknown;
    signal: AbortSignal;
  }) => Promise<unknown>;
};

export type CreateMcpServerKitOptions<Context> = {
  name: string;
  version: string;
  /** Shown to clients in `server/discover` and `initialize`. */
  description?: string;
  instructions?: string;
  authenticate: (headers: HeaderMap) => Promise<AuthenticationResult<string>>;
  resolveContext: (input: {
    principalId: string;
    credential: AuthenticationResult<string> & { kind: "authenticated" };
    headers: HeaderMap;
  }) => Promise<{ ok: true; context: Context } | { ok: false; error: PlatformError }>;
  /** Registered, and listed by `tools/list`, in this order. */
  tools: readonly McpToolDefinition<Context>[];
  /**
   * Cache hint for `tools/list` and `server/discover` results (MCP
   * 2026-07-28). The catalog is static per deployment but only served to
   * authenticated callers, so the default is five minutes, private.
   */
  catalogCacheHint?: CacheHint;
  onError?: (input: { error: unknown; source: string }) => void;
};

export type McpKitRequest = {
  method: string;
  headers: HeaderMap;
  /** The parsed JSON-RPC body. */
  body?: unknown;
  signal?: AbortSignal;
};

export type McpKitResponse = {
  status: number;
  headers: Record<string, string>;
  /** A JSON-RPC message, a platform error body, or null for an empty response. */
  body: unknown;
};

const DEFAULT_CATALOG_CACHE_HINT: CacheHint = {
  ttlMs: 5 * 60 * 1000,
  cacheScope: "private",
};

function toolAnnotations(risk: McpToolRisk): ToolAnnotations {
  if (risk === "read") return { readOnlyHint: true };
  return { readOnlyHint: false, destructiveHint: risk === "destructive" };
}

/**
 * A tool failure is a tool result, not a JSON-RPC error, so the model sees the
 * stable platform code and can correct its call (MCP "tool execution errors").
 */
function platformToolError(error: PlatformError): CallToolResult {
  const mapped = toPublicHttpError(error);
  const structured = {
    code: mapped.body.code,
    message: mapped.body.message,
    details: mapped.body.details ?? null,
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

function isPlatformErrorResult(value: unknown): value is { error: PlatformError } {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return Boolean(error && typeof error === "object" && "code" in error);
}

function toolResult(result: unknown): CallToolResult {
  const structured =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : { value: result ?? null };
  return {
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

function platformErrorResponse(
  error: PlatformError,
  cors: Record<string, string>,
): McpKitResponse {
  const mapped = toPublicHttpError(error);
  return { status: mapped.status, headers: { ...cors }, body: mapped.body };
}

/**
 * A stateless MCP endpoint serving protocol 2026-07-28 and, through the SDK's
 * stateless legacy mode, 2025-era Streamable HTTP clients. Every request is
 * authenticated and resolved to a product context before a fresh, request-local
 * server handles it; nothing is kept between requests.
 */
export function createMcpServerKit<Context>(
  options: CreateMcpServerKitOptions<Context>,
) {
  // Zod-to-JSON-Schema conversion happens once per process, not per request.
  const tools = options.tools.map((tool) => ({
    tool,
    inputSchema: toMcpInputSchema(tool.inputSchema),
  }));
  const catalogCacheHint = options.catalogCacheHint ?? DEFAULT_CATALOG_CACHE_HINT;

  function reportError(error: unknown, source: string) {
    try {
      options.onError?.({ error, source });
    } catch {
      // Error reporting must not alter the MCP response.
    }
  }

  function contextFrom(ctx: ServerContext): Context | undefined {
    return ctx.http?.authInfo?.extra?.context as Context | undefined;
  }

  function buildServer(): McpServer {
    const server = new McpServer(
      {
        name: options.name,
        version: options.version,
        ...(options.description ? { description: options.description } : {}),
      },
      {
        ...(options.instructions ? { instructions: options.instructions } : {}),
        cacheHints: {
          "tools/list": catalogCacheHint,
          "server/discover": catalogCacheHint,
        },
      },
    );
    for (const { tool, inputSchema } of tools) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema,
          annotations: toolAnnotations(tool.risk),
          _meta: { risk: tool.risk },
        },
        async (args, ctx) => {
          const context = contextFrom(ctx);
          if (!context) {
            return platformToolError(createPlatformError("unauthenticated"));
          }
          const signal = ctx.mcpReq.signal;
          if (signal.aborted) {
            return platformToolError(createPlatformError("internal_error"));
          }
          const rawArgs = (args ?? {}) as Record<string, unknown>;
          if (tool.risk === "destructive" && rawArgs.confirm !== true) {
            return platformToolError(
              createPlatformError("forbidden", {
                safeDetails: { confirmation: "required" },
              }),
            );
          }
          const parsed = tool.inputSchema.safeParse(rawArgs);
          if (!parsed.success) {
            return platformToolError(createPlatformError("validation_failed"));
          }
          try {
            const result = await tool.handler({ context, args: parsed.data, signal });
            return isPlatformErrorResult(result)
              ? platformToolError(result.error)
              : toolResult(result);
          } catch (thrown) {
            reportError(thrown, "mcp.tool");
            return platformToolError(captureAndMapException(thrown));
          }
        },
      );
    }
    return server;
  }

  const handler = createMcpHandler(() => buildServer(), {
    legacy: "stateless",
    onerror: (error) => reportError(error, "mcp.protocol"),
  });
  let closed = false;

  async function authenticateHeaders(headers: HeaderMap) {
    const selected = selectMcpCredential(headers);
    let auth: AuthenticationResult<string>;
    if (selected.kind === "absent") {
      auth = { kind: "absent" };
    } else if (selected.kind === "ambiguous" || selected.kind === "malformed") {
      auth = { kind: "rejected", error: selected.error };
    } else {
      auth = await options.authenticate(headers);
    }
    return mapTransportAuthentication(auth, { transport: "mcp" });
  }

  async function handle(request: McpKitRequest): Promise<McpKitResponse> {
    const headers = patchMcpAccept(request.headers);
    const cors = mcpCorsHeaders(headers);
    const method = request.method.toUpperCase();
    if (method === "OPTIONS") {
      return { status: 204, headers: cors, body: null };
    }
    if (closed) {
      return {
        ...platformErrorResponse(createPlatformError("internal_error"), cors),
        status: 503,
      };
    }
    // Streamable HTTP without sessions is POST-only: there is no standalone
    // GET stream and no session to DELETE.
    if (method !== "POST") {
      return {
        status: 405,
        headers: { ...cors, Allow: "POST, OPTIONS" },
        body: toPublicHttpError(createPlatformError("validation_failed")).body,
      };
    }

    // Every MCP request is protected, `server/discover` and legacy
    // `initialize` included.
    const auth = await authenticateHeaders(headers);
    if (auth.kind !== "authenticated") {
      return platformErrorResponse(
        auth.kind === "rejected" ? auth.error : createPlatformError("unauthenticated"),
        cors,
      );
    }
    const resolved = await options.resolveContext({
      principalId: auth.principalId,
      credential: auth,
      headers,
    });
    if (!resolved.ok) return platformErrorResponse(resolved.error, cors);
    if (request.signal?.aborted) {
      return platformErrorResponse(createPlatformError("internal_error"), cors);
    }

    const response = await handler.fetch(
      toWebRequest({ headers, body: request.body, signal: request.signal }),
      {
        parsedBody: request.body,
        authInfo: {
          // The credential never enters the MCP layer; tools read the
          // resolved product context instead.
          token: "kit",
          clientId: auth.principalId,
          scopes: [],
          extra: { context: resolved.context },
        },
      },
    );
    const result = await readMcpResponse(response);
    return {
      status: result.status,
      headers: { ...cors, ...result.headers },
      body: result.body,
    };
  }

  return {
    handle,
    listTools: () => [...options.tools],
    shutdown: async () => {
      closed = true;
      await handler.close();
    },
  };
}

export type McpServerKit<Context> = ReturnType<typeof createMcpServerKit<Context>>;
