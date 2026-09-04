import type { HeaderMap } from "@codelitdev/platform";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export { StreamableHTTPServerTransport, WebStandardStreamableHTTPServerTransport };

export function headerString(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

/** MediaLit: clients often omit the dual Accept tokens Streamable HTTP requires. */
export function patchMcpAccept(headers: HeaderMap): HeaderMap {
  const accept = headerString(headers, "accept") ?? "";
  const needsJson = !accept.includes("application/json");
  const needsSse = !accept.includes("text/event-stream");
  if (!needsJson && !needsSse) return headers;
  const additions = [
    ...(needsJson ? ["application/json"] : []),
    ...(needsSse ? ["text/event-stream"] : []),
  ];
  const next = accept ? `${accept}, ${additions.join(", ")}` : additions.join(", ");
  return { ...headers, accept: next, Accept: next };
}

export function headersToRecord(headers: HeaderMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value) && value[0]) out[key] = value[0];
  }
  return out;
}

export async function dispatchWebStandard(
  transport: WebStandardStreamableHTTPServerTransport,
  request: {
    method: string;
    headers: HeaderMap;
    body?: unknown;
    signal?: AbortSignal;
    authInfo?: {
      token: string;
      clientId: string;
      scopes: string[];
      extra?: Record<string, unknown>;
    };
  },
): Promise<{
  status: number;
  headers: Record<string, string>;
  body: unknown;
}> {
  const patched = patchMcpAccept(request.headers);
  const webHeaders = new Headers();
  for (const [key, value] of Object.entries(headersToRecord(patched))) {
    webHeaders.set(key, value);
  }
  const method = request.method.toUpperCase();
  if (
    method !== "GET" &&
    method !== "HEAD" &&
    method !== "DELETE" &&
    !webHeaders.has("content-type")
  ) {
    webHeaders.set("content-type", "application/json");
  }
  const init: RequestInit = {
    method,
    headers: webHeaders,
    signal: request.signal,
  };
  if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
    init.body = JSON.stringify(request.body ?? {});
  }
  const webRequest = new Request("http://127.0.0.1/mcp", init);
  const response = await transport.handleRequest(webRequest, {
    parsedBody: request.body,
    authInfo: request.authInfo,
  });
  const outHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    outHeaders[key] = value;
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    await response.body?.cancel();
    return { status: response.status, headers: outHeaders, body: null };
  }
  if (contentType.includes("application/json")) {
    return {
      status: response.status,
      headers: outHeaders,
      body: await response.json(),
    };
  }
  const text = await response.text();
  return {
    status: response.status,
    headers: outHeaders,
    body: text.length > 0 ? text : null,
  };
}

export function createStreamableSession(input: {
  name: string;
  version: string;
  sessionId?: string;
  registerTools: (server: McpServer) => void;
  onclosed?: (sessionId: string) => void;
}): {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  ready: Promise<void>;
} {
  // MediaLit mounts StreamableHTTPServerTransport (Node wrapper around this
  // Web Standard transport). The kit handle() API is request/response records,
  // so the Web Standard transport is the protocol implementation.
  void StreamableHTTPServerTransport;
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: input.sessionId ? () => input.sessionId as string : undefined,
    enableJsonResponse: true,
    onsessioninitialized: () => undefined,
    onsessionclosed: (id) => input.onclosed?.(id),
  });
  const server = new McpServer({
    name: input.name,
    version: input.version,
  });
  input.registerTools(server);
  return { server, transport, ready: server.connect(transport) };
}
