import { afterEach, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpDiscoveryAdapter } from "./mcp-discovery.js";
import { runMcpServerCardConformance } from "./mcp-server-card.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function serve(
  options: {
    card?: (origin: string) => unknown;
    catalog?: (origin: string) => unknown;
  } = {},
): Promise<{ origin: string; adapter: McpDiscoveryAdapter }> {
  let origin = "";
  const server = createServer((request, response) => {
    const send = (body: unknown) => {
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.end(JSON.stringify(body));
    };
    if (request.url === "/tools/mcp/server-card" && request.method === "GET") {
      send(
        options.card?.(origin) ?? {
          $schema:
            "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
          name: "dev.codelit/tools",
          version: "1.0.0",
          description: "Tools",
          remotes: [{ type: "streamable-http", url: `${origin}/tools/mcp` }],
        },
      );
      return;
    }
    if (request.url === "/.well-known/ai-catalog.json" && request.method === "GET") {
      send(
        options.catalog?.(origin) ?? {
          specVersion: "1.0",
          entries: [
            {
              identifier: "urn:air:codelit.dev:mcp:tools",
              type: "application/mcp-server-card+json",
              url: `${origin}/tools/mcp/server-card`,
            },
          ],
        },
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    adapter: {
      async request(input) {
        const response = await fetch(`${origin}${input.path}`, {
          method: input.method,
          headers: input.headers,
        });
        const text = await response.text();
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: text ? JSON.parse(text) : null,
        };
      },
    },
  };
}

describe("runMcpServerCardConformance", () => {
  it("passes a public card listed by the domain catalog", async () => {
    const { origin, adapter } = await serve();
    expect(
      await runMcpServerCardConformance(adapter, {
        resourceUrl: `${origin}/tools/mcp`,
      }),
    ).toEqual({ failures: [] });
  });

  it("reports an invalid card and a catalog that does not list it", async () => {
    const { origin, adapter } = await serve({
      card: () => ({
        $schema: "https://example.test/card.json",
        name: "tools",
        version: "1.0.0",
        description: "x".repeat(101),
        remotes: [{ type: "streamable-http", url: "https://other.test/mcp" }],
      }),
      catalog: () => ({ specVersion: "1.0", entries: [] }),
    });
    const result = await runMcpServerCardConformance(adapter, {
      resourceUrl: `${origin}/tools/mcp`,
    });
    expect(result.failures.map((failure) => failure.message)).toEqual([
      "server card $schema is not the v1 schema",
      "server card name must be a reverse-DNS namespace and name",
      "server card description must be 1 to 100 characters",
      "server card must list the MCP endpoint as a streamable-http remote",
      `AI catalog at ${origin} does not list the server card`,
    ]);
  });

  it("reports a missing card and skips the catalog when asked", async () => {
    const { origin, adapter } = await serve();
    const result = await runMcpServerCardConformance(adapter, {
      resourceUrl: `${origin}/other/mcp`,
      catalog: false,
    });
    expect(result.failures).toEqual([
      {
        suite: "mcp-server-card",
        message: "anonymous server card request returned 404 instead of 200",
      },
    ]);
  });
});
