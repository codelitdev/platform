import type { HeaderMap } from "@codelitdev/platform";

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
  const rest = Object.fromEntries(
    Object.entries(headers).filter(([key]) => key.toLowerCase() !== "accept"),
  );
  return { ...rest, accept: next };
}

// The body is re-serialized from its parsed form, so the original framing
// headers no longer describe it.
const DROPPED_REQUEST_HEADERS = new Set(["content-length", "transfer-encoding"]);

export function toWebRequest(input: {
  headers: HeaderMap;
  body?: unknown;
  signal?: AbortSignal;
}): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(input.headers)) {
    if (DROPPED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    const single = Array.isArray(value) ? value[0] : value;
    if (typeof single === "string") headers.set(key, single);
  }
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(input.body ?? null),
    signal: input.signal,
  });
}

/** JSON-RPC messages carried by a complete `text/event-stream` body. */
function sseMessages(text: string): unknown[] {
  const messages: unknown[] = [];
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // Not a JSON-RPC frame; ignore it like a client would.
    }
  }
  return messages;
}

function isResponseMessage(message: unknown): boolean {
  return Boolean(
    message &&
      typeof message === "object" &&
      "id" in message &&
      ("result" in message || "error" in message),
  );
}

/**
 * Settle an SDK response into a JSON record. The stateless 2025 leg answers a
 * POST over a short SSE stream that closes after its one response; Streamable
 * HTTP lets the same response go back as `application/json`, which is what the
 * kit's record-based `handle()` returns.
 */
export async function readMcpResponse(response: Response): Promise<{
  status: number;
  headers: Record<string, string>;
  body: unknown;
}> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key !== "content-length") headers[key] = value;
  });
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    const messages = sseMessages(text);
    const body = messages.find(isResponseMessage) ?? messages.at(-1) ?? null;
    headers["content-type"] = "application/json";
    for (const streamOnly of ["connection", "x-accel-buffering"])
      delete headers[streamOnly];
    return { status: response.status, headers, body };
  }
  if (!text) return { status: response.status, headers, body: null };
  if (contentType.includes("application/json")) {
    return { status: response.status, headers, body: JSON.parse(text) };
  }
  return { status: response.status, headers, body: text };
}
