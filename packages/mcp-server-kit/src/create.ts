import { AsyncLocalStorage } from "node:async_hooks";
import type { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  captureAndMapException,
  createPlatformError,
  mapTransportAuthentication,
  PLATFORM_ERROR_CODES,
  selectMcpCredential,
  toPublicHttpError,
  type AuthenticationResult,
  type HeaderMap,
  type PlatformError,
  type PlatformErrorCode,
} from "@codelitdev/platform";
import { mcpCorsHeaders } from "./cors.js";
import { createMcpSessionStore } from "./sessions.js";
import {
  createStreamableSession,
  dispatchWebStandard,
  headerString,
  patchMcpAccept,
  type WebStandardStreamableHTTPServerTransport,
} from "./streamable-http.js";

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
  authenticate: (headers: HeaderMap) => Promise<AuthenticationResult<string>>;
  resolveContext: (input: {
    principalId: string;
    credential: AuthenticationResult<string> & { kind: "authenticated" };
    headers: HeaderMap;
  }) => Promise<
    { ok: true; context: Context } | { ok: false; error: PlatformError }
  >;
  tools: readonly McpToolDefinition<Context>[];
  onError?: (input: { error: unknown; source: string }) => void;
};

type ToolScope<Context> = {
  context: Context;
  signal: AbortSignal;
};

function isPlatformErrorCode(value: unknown): value is PlatformErrorCode {
  return (
    typeof value === "string" &&
    (PLATFORM_ERROR_CODES as readonly string[]).includes(value)
  );
}

function platformToolError(error: PlatformError) {
  const mapped = toPublicHttpError(error);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: mapped.body.message }],
    structuredContent: {
      code: mapped.body.code,
      message: mapped.body.message,
      details: mapped.body.details ?? null,
    },
  };
}

export function createMcpServerKit<Context>(
  options: CreateMcpServerKitOptions<Context>,
) {
  const transports = new Map<
    string,
    WebStandardStreamableHTTPServerTransport
  >();
  const sessions = createMcpSessionStore({
    onExpire(session) {
      const transport = transports.get(session.id);
      transports.delete(session.id);
      if (transport) {
        void transport.close().catch(() => {
          // Expiry cleanup is best effort; the session has already been
          // removed, so it cannot be reused even if close fails.
        });
      }
    },
  });
  const requestScope = new AsyncLocalStorage<ToolScope<Context>>();

  function jsonRpcError(id: unknown, error: PlatformError) {
    const mapped = toPublicHttpError(error);
    return {
      status: mapped.status,
      headers: {} as Record<string, string>,
      body: {
        jsonrpc: "2.0",
        id: id ?? null,
        error: {
          code: mapped.body.code,
          message: mapped.body.message,
          data: mapped.body.details,
        },
      },
    };
  }

  function registerTools(server: McpServer) {
    for (const tool of options.tools) {
      const shape =
        tool.inputSchema &&
        typeof tool.inputSchema === "object" &&
        "shape" in tool.inputSchema
          ? (tool.inputSchema as { shape: Record<string, z.ZodType> }).shape
          : undefined;
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          ...(shape ? { inputSchema: shape } : {}),
          annotations: {
            readOnlyHint: tool.risk === "read",
            destructiveHint: tool.risk === "destructive",
          },
          _meta: { risk: tool.risk },
        },
        async (args, extra) => {
          const scope = requestScope.getStore();
          const context =
            scope?.context ??
            (extra.authInfo?.extra?.context as Context | undefined);
          if (!context) {
            return platformToolError(createPlatformError("unauthenticated"));
          }
          const signal = extra.signal ?? scope?.signal;
          if (signal?.aborted) {
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
            const result = await tool.handler({
              context,
              args: parsed.data,
              signal: signal ?? new AbortController().signal,
            });
            if (
              result &&
              typeof result === "object" &&
              "error" in result &&
              result.error &&
              typeof result.error === "object" &&
              "code" in result.error
            ) {
              return platformToolError(result.error as PlatformError);
            }
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result) },
              ],
              structuredContent:
                result && typeof result === "object"
                  ? (result as Record<string, unknown>)
                  : { value: result },
            };
          } catch (thrown) {
            try {
              options.onError?.({ error: thrown, source: "mcp.tool" });
            } catch {
              // Error reporting must not alter the MCP response.
            }
            return platformToolError(captureAndMapException(thrown));
          }
        },
      );
    }
  }

  async function attachSession(sessionId?: string) {
    const live = createStreamableSession({
      name: options.name,
      version: options.version,
      sessionId,
      registerTools,
      onclosed: (id) => {
        transports.delete(id);
        sessions.delete(id);
      },
    });
    await live.ready;
    if (sessionId) transports.set(sessionId, live.transport);
    return live;
  }

  async function authenticateHeaders(headers: HeaderMap) {
    const selected = selectMcpCredential(headers);
    let auth: AuthenticationResult<string>;
    if (selected.kind === "absent") {
      auth = { kind: "absent" };
    } else if (selected.kind === "ambiguous") {
      auth = { kind: "rejected", error: selected.error };
    } else {
      auth = await options.authenticate(headers);
    }
    return mapTransportAuthentication(auth, { transport: "mcp" });
  }

  function adaptSdkBody(body: unknown): unknown {
    if (!body || typeof body !== "object") return body;
    const rpc = body as {
      result?: {
        isError?: boolean;
        structuredContent?: Record<string, unknown>;
        content?: Array<Record<string, unknown>>;
        tools?: Array<Record<string, unknown>>;
      };
    };
    if (Array.isArray(rpc.result?.tools)) {
      for (const listed of rpc.result.tools) {
        const meta = listed._meta as { risk?: string } | undefined;
        const annotations = {
          ...((listed.annotations as Record<string, unknown> | undefined) ??
            {}),
        };
        if (meta?.risk) annotations.risk = meta.risk;
        listed.annotations = annotations;
      }
    }
    const structured = rpc.result?.structuredContent;
    if (structured && Array.isArray(rpc.result?.content)) {
      const hasJson = rpc.result.content.some((item) => item.type === "json");
      if (!hasJson) {
        rpc.result.content = [
          { type: "json", json: structured },
          ...rpc.result.content,
        ];
      }
    }
    return body;
  }

  function mapSdkResult(
    rpcId: unknown,
    cors: Record<string, string>,
    sdk: { status: number; headers: Record<string, string>; body: unknown },
  ) {
    const body = adaptSdkBody(sdk.body) as {
      result?: {
        isError?: boolean;
        structuredContent?: {
          code?: unknown;
          message?: unknown;
          details?: Record<string, string | number | boolean | null>;
        };
      };
    };
    const code = body?.result?.isError
      ? body.result.structuredContent?.code
      : undefined;
    if (isPlatformErrorCode(code)) {
      const mapped = jsonRpcError(
        rpcId,
        createPlatformError(code, {
          safeDetails: body.result?.structuredContent?.details,
        }),
      );
      return {
        ...mapped,
        headers: { ...cors, ...sdk.headers, ...mapped.headers },
      };
    }
    return {
      status: sdk.status,
      headers: { ...cors, ...sdk.headers },
      body: sdk.body,
    };
  }

  async function handle(request: {
    method: string;
    headers: HeaderMap;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<{
    status: number;
    headers: Record<string, string>;
    body: unknown;
  }> {
    const headers = patchMcpAccept(request.headers);
    const cors = mcpCorsHeaders(headers);
    const method = request.method.toUpperCase();
    if (method === "OPTIONS") {
      return { status: 204, headers: cors, body: null };
    }
    if (sessions.closed) {
      return {
        status: 503,
        headers: cors,
        body: toPublicHttpError(createPlatformError("internal_error")).body,
      };
    }

    const sessionId = headerString(headers, "mcp-session-id");
    const payload =
      request.body && typeof request.body === "object"
        ? (request.body as {
            jsonrpc?: string;
            id?: unknown;
            method?: string;
            params?: Record<string, unknown>;
          })
        : {};
    const rpcId = payload.id ?? null;

    // Every MCP operation is protected.  In particular, do not allow an
    // unauthenticated initialize to allocate a session (or an unauthenticated
    // GET/DELETE to operate on a session id).  Besides violating the auth
    // contract, doing so makes the in-memory session map an easy DoS target.
    const auth = await authenticateHeaders(headers);
    if (auth.kind !== "authenticated") {
      const error =
        auth.kind === "rejected"
          ? auth.error
          : createPlatformError("unauthenticated");
      const mapped = jsonRpcError(rpcId, error);
      return { ...mapped, headers: { ...cors, ...mapped.headers } };
    }

    if (method === "GET" || method === "DELETE") {
      const session = sessions.get(sessionId);
      if (
        !session ||
        (session.ownerId && session.ownerId !== auth.principalId)
      ) {
        return {
          status: 404,
          headers: cors,
          body: {
            jsonrpc: "2.0",
            error: { code: -32001, message: "Session not found" },
            id: null,
          },
        };
      }
      const transport = transports.get(session.id);
      if (!transport) {
        return {
          status: 404,
          headers: cors,
          body: {
            jsonrpc: "2.0",
            error: { code: -32001, message: "Session not found" },
            id: null,
          },
        };
      }
      const result = await dispatchWebStandard(transport, {
        method,
        headers,
        body: request.body,
        signal: request.signal,
      });
      if (method === "DELETE") {
        transports.delete(session.id);
        sessions.delete(session.id);
        await transport.close();
      }
      return {
        status: result.status || (method === "DELETE" ? 204 : result.status),
        headers: {
          ...cors,
          ...result.headers,
          ...(method === "GET" ? { "Mcp-Session-Id": session.id } : {}),
        },
        body: result.body,
      };
    }

    if (method !== "POST") {
      return {
        status: 405,
        headers: cors,
        body: toPublicHttpError(createPlatformError("validation_failed")).body,
      };
    }

    if (payload.method === "initialize") {
      const resolved = await options.resolveContext({
        principalId: auth.principalId,
        credential: auth,
        headers,
      });
      if (!resolved.ok) {
        const mapped = jsonRpcError(rpcId, resolved.error);
        return { ...mapped, headers: { ...cors, ...mapped.headers } };
      }
      const session = sessions.create(auth.principalId);
      const live = await attachSession(session.id);
      const result = await requestScope.run(
        {
          context: resolved.context,
          signal: request.signal ?? new AbortController().signal,
        },
        () =>
          dispatchWebStandard(live.transport, {
            method: "POST",
            headers,
            body: request.body,
            signal: request.signal,
            authInfo: {
              token: "kit",
              clientId: auth.principalId,
              scopes: [],
              extra: { context: resolved.context },
            },
          }),
      );
      return {
        status: result.status || 200,
        headers: {
          ...cors,
          ...result.headers,
          "Mcp-Session-Id": session.id,
        },
        body: result.body,
      };
    }

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (
        !session ||
        (session.ownerId && session.ownerId !== auth.principalId)
      ) {
        return {
          status: 404,
          headers: cors,
          body: {
            jsonrpc: "2.0",
            error: { code: -32001, message: "Session not found" },
            id: null,
          },
        };
      }
    }

    const resolved = await options.resolveContext({
      principalId: auth.principalId,
      credential: auth,
      headers,
    });
    if (!resolved.ok) {
      const mapped = jsonRpcError(rpcId, resolved.error);
      return { ...mapped, headers: { ...cors, ...mapped.headers } };
    }

    const live = sessionId
      ? {
          transport: transports.get(sessions.get(sessionId)?.id ?? "") ?? null,
          close: async () => undefined,
        }
      : await attachSession();
    const transport = live.transport;
    if (!transport) {
      return {
        status: 404,
        headers: cors,
        body: {
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        },
      };
    }

    const sdk = await requestScope.run(
      {
        context: resolved.context,
        signal: request.signal ?? new AbortController().signal,
      },
      () =>
        dispatchWebStandard(transport, {
          method: "POST",
          headers,
          body: request.body,
          signal: request.signal,
          authInfo: {
            token: "kit",
            clientId: auth.principalId,
            scopes: [],
            extra: { context: resolved.context },
          },
        }),
    );
    if (!sessionId) await transport.close();
    return mapSdkResult(rpcId, cors, sdk);
  }

  return {
    handle,
    listTools: () => [...options.tools],
    sessions,
    shutdown: async () => {
      for (const transport of transports.values()) {
        await transport.close();
      }
      transports.clear();
      sessions.shutdown();
    },
  };
}

export type McpServerKit<Context> = ReturnType<
  typeof createMcpServerKit<Context>
>;
