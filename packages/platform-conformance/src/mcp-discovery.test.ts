import { afterEach, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type McpDiscoveryAdapter,
  mcpResourceMetadataChallenge,
  runMcpDiscoveryConformance,
} from "./mcp-discovery.js";

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
    challenge?: boolean;
    resource?: string;
    authorizationServers?: unknown;
  } = {},
): Promise<{ origin: string; adapter: McpDiscoveryAdapter }> {
  let origin = "";
  const server = createServer((request, response) => {
    if (request.url === "/tools/mcp" && request.method === "POST") {
      response.statusCode = 401;
      if (options.challenge !== false) {
        response.setHeader(
          "WWW-Authenticate",
          `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/tools/mcp"`,
        );
      }
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (
      request.url === "/.well-known/oauth-protected-resource/tools/mcp" &&
      request.method === "GET"
    ) {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          resource: options.resource ?? `${origin}/tools/mcp`,
          authorization_servers: options.authorizationServers ?? [`${origin}/api/auth`],
        }),
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
          ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
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

describe("runMcpDiscoveryConformance", () => {
  it("finds a Bearer metadata parameter among other challenges and parameters", () => {
    expect(
      mcpResourceMetadataChallenge({
        "WWW-Authenticate":
          'Basic realm="admin", Bearer realm="mcp", resource_metadata="https://api.example/mcp-meta"',
      }),
    ).toBe("https://api.example/mcp-meta");
  });

  it("passes a real HTTP MCP challenge and protected-resource metadata on a product-defined path", async () => {
    const { origin, adapter } = await serve();
    expect(
      await runMcpDiscoveryConformance(adapter, {
        resourceUrl: `${origin}/tools/mcp`,
      }),
    ).toEqual({ failures: [] });
  });

  it("reports a missing challenge without depending on product tools or credentials", async () => {
    const { origin, adapter } = await serve({ challenge: false });
    const result = await runMcpDiscoveryConformance(adapter, {
      resourceUrl: `${origin}/tools/mcp`,
    });
    expect(result.failures).toContainEqual({
      suite: "mcp-discovery",
      message:
        "WWW-Authenticate must advertise the MCP protected-resource metadata URL",
    });
  });

  it("reports metadata that describes a different resource or omits the authorization server", async () => {
    const { origin, adapter } = await serve({
      resource: "https://other.example/mcp",
      authorizationServers: [],
    });
    const result = await runMcpDiscoveryConformance(adapter, {
      resourceUrl: `${origin}/tools/mcp`,
    });
    expect(result.failures.map((failure) => failure.message)).toEqual([
      "protected-resource metadata does not identify the MCP resource URL",
      "protected-resource metadata must list absolute HTTP(S) authorization server URLs",
    ]);
  });
});
