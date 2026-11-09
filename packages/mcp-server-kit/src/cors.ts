import type { HeaderMap } from "@codelitdev/platform";

export const MCP_ALLOWED_HEADERS = [
  "Content-Type",
  "Accept",
  "Authorization",
  "X-API-Key",
  "X-Tenant-ID",
  "MCP-Protocol-Version",
  "Mcp-Method",
  "Mcp-Name",
].join(", ");

export function mcpCorsHeaders(requestHeaders: HeaderMap): Record<string, string> {
  const originHeader = requestHeaders.origin ?? requestHeaders.Origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  return {
    "Access-Control-Allow-Origin": origin && origin.length > 0 ? origin : "*",
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": MCP_ALLOWED_HEADERS,
  };
}
