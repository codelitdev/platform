import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createMcpServerKit } from "./create.js";
import {
  buildAiCatalog,
  buildMcpServerCard,
  createAiCatalogHandler,
  MCP_SERVER_CARD_SCHEMA,
  mcpServerCardUrl,
} from "./server-card.js";

function kit(serverCard?: Parameters<typeof createMcpServerKit>[0]["serverCard"]) {
  let authenticated = 0;
  const created = createMcpServerKit<{ id: string }>({
    name: "medialit",
    version: "1.4.0",
    description: "Upload, transform and serve media files.",
    authenticate: async () => {
      authenticated += 1;
      return { kind: "absent" };
    },
    resolveContext: async () => ({ ok: true, context: { id: "x" } }),
    tools: [
      {
        name: "media.list",
        description: "List media",
        risk: "read",
        inputSchema: z.object({}),
        handler: async () => ({ items: [] }),
      },
    ],
    serverCard,
  });
  return { created, authenticated: () => authenticated };
}

const cardOptions = {
  name: "dev.codelit/medialit",
  title: "MediaLit",
  endpoint: "https://api.medialit.cloud/mcp",
  websiteUrl: "https://docs.medialit.cloud/mcp",
  protectedResourceMetadataUrl:
    "https://api.medialit.cloud/.well-known/oauth-protected-resource/mcp",
};

describe("server card", () => {
  it("builds a SEP-2127 card from the kit identity without exposing tools", () => {
    const { created } = kit(cardOptions);
    expect(created.serverCard).toEqual({
      $schema: MCP_SERVER_CARD_SCHEMA,
      name: "dev.codelit/medialit",
      version: "1.4.0",
      description: "Upload, transform and serve media files.",
      title: "MediaLit",
      websiteUrl: "https://docs.medialit.cloud/mcp",
      remotes: [{ type: "streamable-http", url: "https://api.medialit.cloud/mcp" }],
      _meta: {
        "dev.codelit/provider": {
          name: "CodeLit",
          url: "https://codelit.dev",
          protectedResourceMetadata:
            "https://api.medialit.cloud/.well-known/oauth-protected-resource/mcp",
        },
      },
    });
  });

  it("serves the card publicly with discovery CORS, caching and ETag", () => {
    const { created, authenticated } = kit(cardOptions);
    const response = created.handleServerCard({ method: "GET", headers: {} });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(created.serverCard);
    expect(response.headers).toMatchObject({
      "Content-Type": "application/mcp-server-card+json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "ETag",
      "Cache-Control": "public, max-age=3600",
    });
    expect(authenticated()).toBe(0);

    const etag = response.headers.ETag ?? "";
    expect(etag).toMatch(/^".+"$/);
    const revalidated = created.handleServerCard({
      method: "GET",
      headers: { "if-none-match": `W/${etag}` },
    });
    expect(revalidated).toMatchObject({ status: 304, body: null });

    expect(created.handleServerCard({ method: "OPTIONS", headers: {} }).status).toBe(
      204,
    );
    expect(created.handleServerCard({ method: "POST", headers: {} }).status).toBe(405);
    expect(created.handleServerCard({ method: "HEAD", headers: {} })).toMatchObject({
      status: 200,
      body: null,
    });
  });

  it("answers 404 when the kit has no card", () => {
    const { created } = kit();
    expect(created.serverCard).toBeUndefined();
    expect(created.handleServerCard({ method: "GET", headers: {} }).status).toBe(404);
  });

  it("rejects values that would produce an invalid card at startup", () => {
    const base = { ...cardOptions, version: "1.0.0", description: "Media" };
    expect(() => buildMcpServerCard({ ...base, name: "medialit" })).toThrow(
      "serverCard.name",
    );
    expect(() => buildMcpServerCard({ ...base, version: "^1.0.0" })).toThrow("range");
    expect(() => buildMcpServerCard({ ...base, description: "x".repeat(101) })).toThrow(
      "1 to 100",
    );
    expect(() => buildMcpServerCard({ ...base, description: "" })).toThrow("required");
    expect(() => buildMcpServerCard({ ...base, endpoint: "/mcp" })).toThrow(
      "absolute URL",
    );
    expect(() =>
      buildMcpServerCard({ ...base, endpoint: "https://x.test/mcp?tenant=a" }),
    ).toThrow("query");
  });
});

describe("AI catalog", () => {
  const card = buildMcpServerCard({
    ...cardOptions,
    version: "1.4.0",
    description: "Media",
  });

  it("links each card at <endpoint>/server-card with a urn:air identifier", () => {
    expect(mcpServerCardUrl("https://api.medialit.cloud/mcp/")).toBe(
      "https://api.medialit.cloud/mcp/server-card",
    );
    expect(buildAiCatalog([card])).toEqual({
      specVersion: "1.0",
      entries: [
        {
          identifier: "urn:air:codelit.dev:mcp:medialit",
          type: "application/mcp-server-card+json",
          url: "https://api.medialit.cloud/mcp/server-card",
        },
      ],
    });
    expect(
      buildAiCatalog([
        { card, url: "https://cards.test/m.json", identifier: "urn:air:x:mcp:m" },
      ]).entries[0],
    ).toMatchObject({
      identifier: "urn:air:x:mcp:m",
      url: "https://cards.test/m.json",
    });
  });

  it("serves the catalog with its media type", () => {
    const response = createAiCatalogHandler([card])({ method: "GET", headers: {} });
    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/ai-catalog+json");
    expect(response.headers["Access-Control-Allow-Origin"]).toBe("*");
  });
});
