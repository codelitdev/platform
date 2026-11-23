import { createHash } from "node:crypto";
import type { HeaderMap } from "@codelitdev/platform";
import type { McpKitResponse } from "./create.js";
import { headerString } from "./streamable-http.js";

/** MCP Server Card schema (SEP-2127), version 1. */
export const MCP_SERVER_CARD_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";
export const MCP_SERVER_CARD_MEDIA_TYPE = "application/mcp-server-card+json";
export const AI_CATALOG_MEDIA_TYPE = "application/ai-catalog+json";
export const AI_CATALOG_PATH = "/.well-known/ai-catalog.json";
/** The `_meta` key under which the kit states who operates the server. */
export const CODELIT_PROVIDER_META_KEY = "dev.codelit/provider";

const CODELIT_PROVIDER = { name: "CodeLit", url: "https://codelit.dev" } as const;
const SERVER_CARD_NAME = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;
const VERSION_RANGE = /^[\^~<>=]|(^|\.)[x*](\.|$)/i;

export type McpServerCardIcon = {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: "light" | "dark";
};

export type McpServerCardRemote = {
  type: "streamable-http";
  url: string;
};

export type McpServerCard = {
  $schema: typeof MCP_SERVER_CARD_SCHEMA;
  name: string;
  version: string;
  description: string;
  title?: string;
  websiteUrl?: string;
  repository?: { source: string; url: string; subfolder?: string };
  icons?: McpServerCardIcon[];
  remotes: McpServerCardRemote[];
  _meta: Record<string, unknown>;
};

export type McpServerCardOptions = {
  /**
   * Reverse-DNS namespace and server name, for example `dev.codelit/medialit`.
   * This is the card's identity; it is not the `server/discover` name.
   */
  name: string;
  /** The public, absolute MCP endpoint URL (the OAuth resource URL). */
  endpoint: string;
  /** Human-readable name, at most 100 characters. */
  title?: string;
  /** At most 100 characters. Defaults to the kit `description`. */
  description?: string;
  /** Defaults to the kit `version`. */
  version?: string;
  /** Product documentation for the MCP server. */
  websiteUrl?: string;
  icons?: McpServerCardIcon[];
  repository?: McpServerCard["repository"];
  /**
   * The OAuth protected-resource metadata URL the 401 challenge advertises.
   * The card schema has no auth member, so it is listed under the provider
   * `_meta` entry as a hint; clients still discover auth from the challenge.
   */
  protectedResourceMetadataUrl?: string;
  /** Who operates the server. Defaults to CodeLit. */
  provider?: { name: string; url: string };
};

export type McpDiscoveryDocumentRequest = {
  method: string;
  headers: HeaderMap;
};

function httpUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${field} must use http or https`);
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`${field} must not include credentials or a fragment`);
  }
  return value;
}

function boundedText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.length < 1 || value.length > 100) {
    throw new Error(`${field} must be 1 to 100 characters`);
  }
  return value;
}

/**
 * Build a Server Card. Throws at startup on a value that would make the card
 * invalid, so a product cannot deploy a card clients reject.
 */
export function buildMcpServerCard(
  options: McpServerCardOptions & { version: string; description: string },
): McpServerCard {
  if (
    options.name.length < 3 ||
    options.name.length > 200 ||
    !SERVER_CARD_NAME.test(options.name)
  ) {
    throw new Error("serverCard.name must look like `dev.codelit/product`");
  }
  if (!options.version || options.version.length > 255) {
    throw new Error("serverCard.version must be 1 to 255 characters");
  }
  if (VERSION_RANGE.test(options.version)) {
    throw new Error("serverCard.version must be an exact version, not a range");
  }
  const endpoint = httpUrl(options.endpoint, "serverCard.endpoint");
  if (process.env.NODE_ENV === "production" && !endpoint.startsWith("https:")) {
    throw new Error("serverCard.endpoint must use https in production");
  }
  if (new URL(endpoint).search) {
    throw new Error("serverCard.endpoint must not include a query");
  }
  if (!options.description) {
    throw new Error("serverCard.description (or the kit description) is required");
  }
  const description = options.description;
  boundedText(description, "serverCard.description");
  const title = boundedText(options.title, "serverCard.title");
  const provider = options.provider ?? CODELIT_PROVIDER;
  return {
    $schema: MCP_SERVER_CARD_SCHEMA,
    name: options.name,
    version: options.version,
    description,
    ...(title ? { title } : {}),
    ...(options.websiteUrl
      ? { websiteUrl: httpUrl(options.websiteUrl, "serverCard.websiteUrl") }
      : {}),
    ...(options.repository ? { repository: options.repository } : {}),
    ...(options.icons?.length ? { icons: options.icons } : {}),
    // Protocol versions are negotiated live through `server/discover`.
    remotes: [{ type: "streamable-http", url: endpoint }],
    _meta: {
      [CODELIT_PROVIDER_META_KEY]: {
        name: provider.name,
        url: httpUrl(provider.url, "serverCard.provider.url"),
        ...(options.protectedResourceMetadataUrl
          ? {
              protectedResourceMetadata: httpUrl(
                options.protectedResourceMetadataUrl,
                "serverCard.protectedResourceMetadataUrl",
              ),
            }
          : {}),
      },
    },
  };
}

/** `<endpoint>/server-card`, the location the discovery doc reserves. */
export function mcpServerCardUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/server-card`;
}

function reverseDomain(namespace: string): string {
  return namespace.split(".").reverse().join(".");
}

export type AiCatalogEntry = {
  identifier: string;
  type: typeof MCP_SERVER_CARD_MEDIA_TYPE;
  url: string;
};

export type AiCatalog = {
  specVersion: "1.0";
  entries: AiCatalogEntry[];
};

/**
 * Build `/.well-known/ai-catalog.json` from the cards a domain serves. Each
 * entry links to the card at `<endpoint>/server-card` and gets the identifier
 * `urn:air:<publisher>:mcp:<name>`, where `dev.codelit/medialit` becomes
 * `urn:air:codelit.dev:mcp:medialit`.
 */
export function buildAiCatalog(
  servers: readonly (
    | McpServerCard
    | { card: McpServerCard; url?: string; identifier?: string }
  )[],
): AiCatalog {
  const entries = servers.map((server) => {
    const { card, url, identifier } =
      "card" in server
        ? server
        : { card: server, url: undefined, identifier: undefined };
    const [namespace = "", name = ""] = card.name.split("/");
    const remote = card.remotes[0];
    if (!url && !remote) {
      throw new Error(`server card ${card.name} has no remote to link from`);
    }
    return {
      identifier: identifier ?? `urn:air:${reverseDomain(namespace)}:mcp:${name}`,
      type: MCP_SERVER_CARD_MEDIA_TYPE,
      url: url ?? mcpServerCardUrl(remote?.url ?? ""),
    } satisfies AiCatalogEntry;
  });
  return { specVersion: "1.0", entries };
}

/**
 * Serve a static, public discovery document (a Server Card or AI Catalog)
 * with the CORS, caching and conditional-request headers the discovery doc
 * asks for. Never authenticated: the document carries no secrets.
 */
export function createDiscoveryDocumentHandler(document: unknown, mediaType: string) {
  const body = JSON.stringify(document);
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, If-None-Match, Accept",
    "Access-Control-Expose-Headers": "ETag",
  };
  const cached = {
    ...cors,
    "Cache-Control": "public, max-age=3600",
    ETag: etag,
  };
  return function handle(request: McpDiscoveryDocumentRequest): McpKitResponse {
    const method = request.method.toUpperCase();
    if (method === "OPTIONS") return { status: 204, headers: cors, body: null };
    if (method !== "GET" && method !== "HEAD") {
      return {
        status: 405,
        headers: { ...cors, Allow: "GET, HEAD, OPTIONS" },
        body: null,
      };
    }
    const ifNoneMatch = headerString(request.headers, "if-none-match");
    if (
      ifNoneMatch
        ?.split(",")
        .map((tag) => tag.trim().replace(/^W\//, ""))
        .some((tag) => tag === etag || tag === "*")
    ) {
      return { status: 304, headers: cached, body: null };
    }
    return {
      status: 200,
      headers: { ...cached, "Content-Type": mediaType },
      body: method === "HEAD" ? null : JSON.parse(body),
    };
  };
}

/** Serve `/.well-known/ai-catalog.json` for the cards a domain hosts. */
export function createAiCatalogHandler(
  servers: Parameters<typeof buildAiCatalog>[0],
): (request: McpDiscoveryDocumentRequest) => McpKitResponse {
  return createDiscoveryDocumentHandler(buildAiCatalog(servers), AI_CATALOG_MEDIA_TYPE);
}
