import type { ConformanceFailure } from "./adapter.js";
import type { McpDiscoveryAdapter } from "./mcp-discovery.js";

export type McpServerCardOptions = {
  /** The public MCP endpoint URL, which the card's remote must name. */
  resourceUrl: string;
  /** Defaults to `<resourceUrl>/server-card`. */
  serverCardUrl?: string;
  /**
   * Check `/.well-known/ai-catalog.json` at the resource origin lists the
   * card. Defaults to true; pass false when the catalog lives on another host.
   */
  catalog?: boolean;
};

const CARD_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";
const CARD_MEDIA_TYPE = "application/mcp-server-card+json";
const CARD_NAME = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;

function header(headers: Record<string, string> | undefined, name: string) {
  return Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, max: number) {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
}

/**
 * Check the public MCP Server Card (SEP-2127) and the domain AI Catalog that
 * lists it, through the product's real HTTP stack and without credentials.
 */
export async function runMcpServerCardConformance(
  adapter: McpDiscoveryAdapter,
  options: McpServerCardOptions,
): Promise<{ failures: ConformanceFailure[] }> {
  const resourceUrl = new URL(options.resourceUrl);
  const cardUrl = new URL(
    options.serverCardUrl ?? `${options.resourceUrl.replace(/\/+$/, "")}/server-card`,
  );
  const failures: ConformanceFailure[] = [];
  const fail = (message: string) =>
    failures.push({ suite: "mcp-server-card", message });

  const response = await adapter.request({
    method: "GET",
    path: `${cardUrl.pathname}${cardUrl.search}`,
    headers: { accept: CARD_MEDIA_TYPE },
  });
  if (response.status !== 200) {
    fail(`anonymous server card request returned ${response.status} instead of 200`);
  } else if (!isObject(response.body)) {
    fail("server card is not a JSON object");
  } else {
    const card = response.body;
    if (card.$schema !== CARD_SCHEMA) fail("server card $schema is not the v1 schema");
    if (
      typeof card.name !== "string" ||
      card.name.length < 3 ||
      card.name.length > 200 ||
      !CARD_NAME.test(card.name)
    ) {
      fail("server card name must be a reverse-DNS namespace and name");
    }
    if (!boundedString(card.version, 255)) fail("server card version is missing");
    if (!boundedString(card.description, 100)) {
      fail("server card description must be 1 to 100 characters");
    }
    if (card.title !== undefined && !boundedString(card.title, 100)) {
      fail("server card title must be 1 to 100 characters");
    }
    const remotes = Array.isArray(card.remotes) ? card.remotes : [];
    if (
      !remotes.some(
        (remote) =>
          isObject(remote) &&
          remote.type === "streamable-http" &&
          remote.url === options.resourceUrl,
      )
    ) {
      fail("server card must list the MCP endpoint as a streamable-http remote");
    }
    if (header(response.headers, "access-control-allow-origin") !== "*") {
      fail("server card must allow any origin (Access-Control-Allow-Origin: *)");
    }
  }

  if (options.catalog === false) return { failures };
  const catalog = await adapter.request({
    method: "GET",
    path: "/.well-known/ai-catalog.json",
  });
  if (catalog.status !== 200) {
    fail(`AI catalog returned ${catalog.status} instead of 200`);
    return { failures };
  }
  if (!isObject(catalog.body) || !Array.isArray(catalog.body.entries)) {
    fail("AI catalog must be a JSON object with an entries array");
    return { failures };
  }
  if (typeof catalog.body.specVersion !== "string") {
    fail("AI catalog specVersion is missing");
  }
  const listed = catalog.body.entries.some(
    (entry) =>
      isObject(entry) &&
      entry.type === CARD_MEDIA_TYPE &&
      typeof entry.identifier === "string" &&
      entry.identifier.length > 0 &&
      entry.url === cardUrl.toString(),
  );
  if (!listed) {
    fail(`AI catalog at ${resourceUrl.origin} does not list the server card`);
  }
  return { failures };
}
