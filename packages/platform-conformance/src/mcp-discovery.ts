import type { ConformanceFailure } from "./adapter.js";

export type McpDiscoveryRequest = {
  method: "GET" | "POST";
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type McpDiscoveryResponse = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};

/** Send requests through the product's real HTTP stack, including its auth middleware. */
export type McpDiscoveryAdapter = {
  request(input: McpDiscoveryRequest): Promise<McpDiscoveryResponse>;
};

export type McpDiscoveryOptions = {
  /** The public OAuth resource identifier advertised by this MCP server. */
  resourceUrl: string;
};

function absoluteHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

export function mcpResourceMetadataChallenge(
  headers?: Record<string, string>,
): string | undefined {
  const challenge = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === "www-authenticate",
  )?.[1];
  if (!challenge) return undefined;
  const parts = challenge.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  let bearer = false;
  for (const part of parts) {
    const trimmed = part.trim();
    const scheme = /^([A-Za-z][A-Za-z0-9_-]*)\s+(?=[A-Za-z])/.exec(trimmed);
    if (scheme) bearer = scheme[1]?.toLowerCase() === "bearer";
    if (!bearer) continue;
    const metadataUrl = /(?:^|\s)resource_metadata\s*=\s*"([^"]+)"/i.exec(
      scheme ? trimmed.slice(scheme[0].length) : trimmed,
    )?.[1];
    if (metadataUrl) return metadataUrl;
  }
  return undefined;
}

/**
 * Check OAuth discovery at the HTTP boundary without assuming product routes,
 * tool names, credentials, tenants, or billing behavior.
 */
export async function runMcpDiscoveryConformance(
  adapter: McpDiscoveryAdapter,
  options: McpDiscoveryOptions,
): Promise<{ failures: ConformanceFailure[] }> {
  const resourceUrl = absoluteHttpUrl(options.resourceUrl);
  if (!resourceUrl) {
    throw new Error(
      "resourceUrl must be an absolute HTTP(S) URL without credentials, query, or fragment",
    );
  }

  const resourcePath = resourceUrl.pathname.replace(/\/$/, "") || "/";
  const metadataPath = `/.well-known/oauth-protected-resource${resourcePath === "/" ? "" : resourcePath}`;
  const expectedMetadataUrl = `${resourceUrl.origin}${metadataPath}`;
  const failures: ConformanceFailure[] = [];
  const fail = (message: string) => failures.push({ suite: "mcp-discovery", message });

  const unauthorized = await adapter.request({
    method: "POST",
    path: resourceUrl.pathname,
    headers: { "content-type": "application/json" },
    body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  if (unauthorized.status !== 401) {
    fail(`anonymous MCP request returned ${unauthorized.status} instead of 401`);
  }
  const challengeUrl = mcpResourceMetadataChallenge(unauthorized.headers);
  if (challengeUrl !== expectedMetadataUrl) {
    fail("WWW-Authenticate must advertise the MCP protected-resource metadata URL");
  }

  const metadata = await adapter.request({ method: "GET", path: metadataPath });
  if (metadata.status !== 200) {
    fail(`protected-resource metadata returned ${metadata.status} instead of 200`);
    return { failures };
  }
  if (
    !metadata.body ||
    typeof metadata.body !== "object" ||
    Array.isArray(metadata.body)
  ) {
    fail("protected-resource metadata is not a JSON object");
    return { failures };
  }
  const document = metadata.body as Record<string, unknown>;
  if (document.resource !== options.resourceUrl) {
    fail("protected-resource metadata does not identify the MCP resource URL");
  }
  if (
    !Array.isArray(document.authorization_servers) ||
    document.authorization_servers.length === 0 ||
    !document.authorization_servers.every(
      (issuer) => typeof issuer === "string" && Boolean(absoluteHttpUrl(issuer)),
    )
  ) {
    fail(
      "protected-resource metadata must list absolute HTTP(S) authorization server URLs",
    );
  }
  return { failures };
}
