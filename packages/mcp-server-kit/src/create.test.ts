import { afterEach, describe, expect, it } from "bun:test";
import { type AuthenticationResult, createPlatformError } from "@codelitdev/platform";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { createMcpServerKit, type McpServerKit } from "./create.js";

type Ctx = { principalId: string; tenantId: string };

const oauth = async (): Promise<AuthenticationResult<string>> => ({
  kind: "authenticated",
  principalId: "user_1",
  credential: { kind: "oauth", credentialId: "client" },
});

function kit(
  authenticate: (
    headers: Record<string, string | string[] | undefined>,
  ) => Promise<AuthenticationResult<string>> = oauth,
  captured: string[] = [],
) {
  return createMcpServerKit<Ctx>({
    name: "reference",
    version: "0.0.0",
    authenticate,
    async resolveContext({ principalId, headers }) {
      if (headers["x-tenant-id"] === "tnt_forbidden") {
        return { ok: false, error: createPlatformError("tenant_forbidden") };
      }
      return { ok: true, context: { principalId, tenantId: "tnt_a" } };
    },
    onError: ({ source }) => captured.push(source),
    tools: [
      {
        name: "notes.list",
        description: "List notes",
        risk: "read",
        inputSchema: z.object({ limit: z.number().int().optional() }),
        async handler({ context }) {
          return { tenantId: context.tenantId, items: [] };
        },
      },
      {
        name: "notes.create",
        description: "Create a note",
        risk: "write",
        inputSchema: z.object({ title: z.string().min(1) }),
        async handler({ args }) {
          return { id: "note_1", title: (args as { title: string }).title };
        },
      },
      {
        name: "notes.delete",
        description: "Delete a note",
        risk: "destructive",
        inputSchema: z.object({
          noteId: z.string(),
          confirm: z.boolean().optional(),
        }),
        async handler({ args }) {
          return (args as { noteId: string }).noteId === "missing"
            ? { error: createPlatformError("not_found") }
            : { deleted: true };
        },
      },
      {
        name: "boom",
        description: "Throws",
        risk: "read",
        inputSchema: z.object({}),
        async handler() {
          throw new Error("secret=leak");
        },
      },
    ],
  });
}

/** A fetch that serves an SDK client from the kit's record-based handle(). */
function kitFetch(
  server: McpServerKit<Ctx>,
  extraHeaders: Record<string, string> = {},
) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const text = await request.text();
    const response = await server.handle({
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers),
        authorization: "Bearer tok",
        ...extraHeaders,
      },
      body: text ? JSON.parse(text) : undefined,
    });
    return new Response(response.body === null ? null : JSON.stringify(response.body), {
      status: response.status,
      headers: response.headers,
    });
  };
}

const closeables: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.allSettled(closeables.splice(0).map((item) => item.close()));
});

async function connect(server: McpServerKit<Ctx>, era: "modern" | "legacy") {
  const client = new Client(
    { name: "kit-test", version: "1.0.0" },
    {
      versionNegotiation: {
        mode: era === "modern" ? { pin: "2026-07-28" } : "legacy",
      },
    },
  );
  closeables.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://kit.test/mcp"), {
      fetch: kitFetch(server),
    }),
  );
  return client;
}

function rawCall(
  server: McpServerKit<Ctx>,
  name: string,
  args: Record<string, unknown>,
) {
  return server.handle({
    method: "POST",
    headers: { authorization: "Bearer tok" },
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
}

type ToolCallBody = {
  result: {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
    structuredContent: Record<string, unknown>;
  };
};

describe("createMcpServerKit", () => {
  it("serves MCP 2026-07-28 statelessly with a deterministic, cacheable catalog", async () => {
    const client = await connect(kit(), "modern");
    expect(client.getProtocolEra()).toBe("modern");

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "notes.list",
      "notes.create",
      "notes.delete",
      "boom",
    ]);
    expect(listed.ttlMs).toBe(300_000);
    expect(listed.cacheScope).toBe("private");
    const [list, create, remove] = listed.tools;
    expect(list?.annotations).toEqual({ readOnlyHint: true });
    expect(create?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(remove?.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
    expect(remove?._meta?.risk).toBe("destructive");
    expect(list?.inputSchema).toMatchObject({
      type: "object",
      properties: { limit: { type: "integer" } },
    });
    expect(list?.inputSchema).not.toHaveProperty("$schema");

    const called = await client.callTool({
      name: "notes.create",
      arguments: { title: "Hi" },
    });
    expect(called.isError).toBeFalsy();
    expect(called.structuredContent).toEqual({ id: "note_1", title: "Hi" });
    expect(called.content).toEqual([
      { type: "text", text: JSON.stringify({ id: "note_1", title: "Hi" }) },
    ]);
  });

  it("serves 2025-era Streamable HTTP clients without sessions", async () => {
    const server = kit();
    const client = await connect(server, "legacy");
    expect(client.getProtocolEra()).toBe("legacy");
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain("notes.list");
    const called = await client.callTool({ name: "notes.list", arguments: {} });
    expect(called.structuredContent).toEqual({ tenantId: "tnt_a", items: [] });

    const initialized = await server.handle({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "raw", version: "0" },
        },
      },
    });
    expect(initialized.status).toBe(200);
    expect(initialized.headers["content-type"]).toBe("application/json");
    expect(initialized.headers).not.toHaveProperty("connection");
    expect(
      Object.keys(initialized.headers).map((key) => key.toLowerCase()),
    ).not.toContain("mcp-session-id");
  });

  it("returns only spec content types alongside structured content", async () => {
    const response = await rawCall(kit(), "notes.list", {});
    expect(response.status).toBe(200);
    const { result } = response.body as ToolCallBody;
    expect(result.structuredContent).toEqual({ tenantId: "tnt_a", items: [] });
    expect(result.content.map((item) => item.type)).toEqual(["text"]);
    expect(JSON.parse(result.content[0]!.text!)).toEqual(result.structuredContent);
  });

  it("rejects modern requests whose headers disagree with the envelope", async () => {
    const server = kit();
    const response = await server.handle({
      method: "POST",
      headers: {
        authorization: "Bearer tok",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
      },
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
    });
    expect(response.status).toBe(400);
    expect((response.body as { error: { code: number } }).error.code).toEqual(
      expect.any(Number),
    );
  });

  it("reports tool failures as tool results with stable platform codes", async () => {
    const captured: string[] = [];
    const server = kit(oauth, captured);

    const unconfirmed = await rawCall(server, "notes.delete", { noteId: "n" });
    expect(unconfirmed.status).toBe(200);
    const denied = (unconfirmed.body as ToolCallBody).result;
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toEqual({
      code: "forbidden",
      message: expect.any(String),
      details: { confirmation: "required" },
    });

    const missing = await rawCall(server, "notes.delete", {
      noteId: "missing",
      confirm: true,
    });
    expect((missing.body as ToolCallBody).result.structuredContent.code).toBe(
      "not_found",
    );

    const confirmed = await rawCall(server, "notes.delete", {
      noteId: "n",
      confirm: true,
    });
    expect((confirmed.body as ToolCallBody).result.structuredContent).toEqual({
      deleted: true,
    });

    const thrown = await rawCall(server, "boom", {});
    expect(JSON.stringify(thrown.body)).not.toContain("secret=leak");
    expect((thrown.body as ToolCallBody).result.structuredContent.code).toBe(
      "internal_error",
    );
    expect(captured).toEqual(["mcp.tool"]);
  });

  it("rejects a browser session cookie and does not authenticate", async () => {
    const server = kit(async () => {
      throw new Error("authenticate should not run for cookie-only MCP");
    });
    const response = await server.handle({
      method: "POST",
      headers: { cookie: "better-auth.session_token=sess" },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(response.status).toBe(401);
    expect((response.body as { code: string }).code).toBe("unauthenticated");
  });

  it("rejects a malformed Authorization header without authenticating", async () => {
    const server = kit(async () => {
      throw new Error("authenticate should not run for a malformed header");
    });
    const response = await server.handle({
      method: "POST",
      headers: { authorization: "Basic dXNlcjpwYXNz", "x-api-key": "key_1" },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(response.status).toBe(401);
    expect((response.body as { code: string }).code).toBe("unauthenticated");
  });

  it("does not fall back when authenticate rejects", async () => {
    const server = kit(async () => ({
      kind: "rejected",
      error: createPlatformError("unauthenticated"),
    }));
    const response = await server.handle({
      method: "POST",
      headers: { authorization: "Bearer bad" },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(response.status).toBe(401);
    expect((response.body as { code: string }).code).toBe("unauthenticated");
  });

  it("never emits a system credential from MCP mapping", async () => {
    const server = kit(async () => ({
      kind: "authenticated",
      principalId: "user_1",
      credential: { kind: "system" },
    }));
    const response = await server.handle({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(response.status).toBe(500);
    expect((response.body as { code: string }).code).toBe("internal_error");
  });

  it("maps context resolution failures before dispatch", async () => {
    const response = await kit().handle({
      method: "POST",
      headers: { authorization: "Bearer tok", "x-tenant-id": "tnt_forbidden" },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe("tenant_forbidden");
  });

  it("serves POST only, with CORS for the modern protocol headers", async () => {
    const server = kit();
    for (const method of ["GET", "DELETE"]) {
      const response = await server.handle({
        method,
        headers: { authorization: "Bearer tok" },
      });
      expect(response.status).toBe(405);
      expect(response.headers.Allow).toBe("POST, OPTIONS");
    }
    const preflight = await server.handle({
      method: "OPTIONS",
      headers: { origin: "https://client.example" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers["Access-Control-Allow-Origin"]).toBe(
      "https://client.example",
    );
    expect(preflight.headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
    expect(preflight.headers["Access-Control-Allow-Headers"]).toContain("Mcp-Method");
    expect(preflight.headers["Access-Control-Allow-Headers"]).toContain("Mcp-Name");
    expect(preflight.headers["Access-Control-Allow-Headers"]).not.toContain(
      "Mcp-Session-Id",
    );
  });

  it("honors abort and rejects requests after shutdown", async () => {
    const server = kit();
    const aborted = new AbortController();
    aborted.abort();
    const cancelled = await server.handle({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      signal: aborted.signal,
    });
    expect(cancelled.status).toBe(500);

    await server.shutdown();
    const after = await server.handle({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    });
    expect(after.status).toBe(503);
  });
});
