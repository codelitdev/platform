import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createPlatformError,
  type AuthenticationResult,
} from "@codelitdev/platform";
import { createMcpServerKit } from "./create.js";

type Ctx = { principalId: string; tenantId: string };

function kit(
  authenticate: (
    headers: Record<string, string | string[] | undefined>,
  ) => Promise<AuthenticationResult<string>>,
) {
  return createMcpServerKit<Ctx>({
    name: "reference",
    version: "0.0.0",
    authenticate,
    async resolveContext({ principalId }) {
      return {
        ok: true,
        context: { principalId, tenantId: "tnt_a" },
      };
    },
    tools: [
      {
        name: "notes.list",
        description: "List notes",
        risk: "read",
        inputSchema: z.object({}),
        async handler({ context }) {
          return { tenantId: context.tenantId, items: [] };
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
        async handler() {
          return { deleted: true };
        },
      },
    ],
  });
}

describe("createMcpServerKit", () => {
  it("rejects a browser session cookie and does not authenticate", async () => {
    const server = kit(async () => {
      throw new Error("authenticate should not run for cookie-only MCP");
    });
    const response = await server.handle({
      method: "POST",
      headers: {
        cookie: "better-auth.session_token=sess",
      },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(response.status).toBe(401);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
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
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe("internal_error");
  });

  it("accepts OAuth bearer and lists tools with risk metadata", async () => {
    const server = kit(async () => ({
      kind: "authenticated",
      principalId: "user_1",
      credential: { kind: "oauth", credentialId: "client" },
    }));
    const response = await server.handle({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(response.status).toBe(200);
    const body = response.body as {
      result: { tools: Array<{ name: string; annotations: { risk: string } }> };
    };
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "notes.list",
      "notes.delete",
    ]);
    expect(body.result.tools[1]?.annotations.risk).toBe("destructive");
  });

  it("denies destructive tools without confirmation", async () => {
    const server = kit(async () => ({
      kind: "authenticated",
      principalId: "user_1",
      credential: { kind: "api_key", credentialId: "key" },
    }));
    const denied = await server.handle({
      method: "POST",
      headers: { "x-api-key": "key.secret" },
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "notes.delete", arguments: { noteId: "note_1" } },
      },
    });
    expect(denied.status).toBe(403);
    const deniedBody = denied.body as {
      error: { code: string; data?: { confirmation?: string } };
    };
    expect(deniedBody.error.code).toBe("forbidden");
    expect(deniedBody.error.data?.confirmation).toBe("required");
    const allowed = await server.handle({
      method: "POST",
      headers: { "x-api-key": "key.secret" },
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "notes.delete",
          arguments: { noteId: "note_1", confirm: true },
        },
      },
    });
    expect(allowed.status).toBe(200);
  });

  it("maps thrown exceptions without leaking cause and honors abort", async () => {
    const captured: string[] = [];
    const server = createMcpServerKit<Ctx>({
      name: "reference",
      version: "0.0.0",
      async authenticate() {
        return {
          kind: "authenticated",
          principalId: "user_1",
          credential: { kind: "oauth" },
        };
      },
      async resolveContext({ principalId }) {
        return {
          ok: true,
          context: { principalId, tenantId: "tnt_a" },
        };
      },
      onError: ({ source }) => captured.push(source),
      tools: [
        {
          name: "boom",
          description: "throws",
          risk: "read",
          inputSchema: z.object({}),
          async handler() {
            throw new Error("secret=leak");
          },
        },
      ],
    });
    const thrown = await server.handle({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "boom", arguments: {} },
      },
    });
    const body = JSON.stringify(thrown.body);
    expect(thrown.status).toBe(500);
    expect(body).not.toContain("secret=leak");
    expect(body).toContain("internal_error");
    expect(captured).toEqual(["mcp.tool"]);

    const aborted = new AbortController();
    aborted.abort();
    const cancelled = await server.handle({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "boom", arguments: {} },
      },
      signal: aborted.signal,
    });
    expect(cancelled.status).toBe(500);
    await server.shutdown();
    const after = await server.handle({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: { jsonrpc: "2.0", id: 6, method: "tools/list" },
    });
    expect(after.status).toBe(503);
  });

  it("mints a streamable HTTP session and uses sessions.get for GET/POST/DELETE", async () => {
    const server = kit(async () => ({
      kind: "authenticated",
      principalId: "user_1",
      credential: { kind: "oauth", credentialId: "client" },
    }));
    const initialized = await server.handle({
      method: "POST",
      headers: { authorization: "Bearer tok", accept: "application/json" },
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      },
    });
    expect(initialized.status).toBe(200);
    expect(initialized.headers["Access-Control-Expose-Headers"]).toBe(
      "Mcp-Session-Id",
    );
    const sessionId = initialized.headers["Mcp-Session-Id"];
    expect(sessionId).toEqual(expect.any(String));
    expect(server.sessions.get(sessionId)?.id).toBe(sessionId);

    const missing = await server.handle({
      method: "GET",
      headers: {
        authorization: "Bearer tok",
        "mcp-session-id": "not-a-session",
      },
    });
    expect(missing.status).toBe(404);

    const streamed = await server.handle({
      method: "GET",
      headers: {
        authorization: "Bearer tok",
        "mcp-session-id": sessionId!,
        accept: "text/event-stream, application/json",
      },
    });
    expect(streamed.status).toBeGreaterThanOrEqual(200);
    expect(streamed.status).toBeLessThan(500);
    expect(server.sessions.get(sessionId)?.id).toBe(sessionId);

    const listed = await server.handle({
      method: "POST",
      headers: {
        authorization: "Bearer tok",
        "mcp-session-id": sessionId!,
        accept: "application/json",
      },
      body: { jsonrpc: "2.0", id: 11, method: "tools/list" },
    });
    expect(listed.status).toBe(200);
    const listedBody = listed.body as {
      result: { tools: Array<{ name: string; annotations: { risk: string } }> };
    };
    expect(listedBody.result.tools.map((tool) => tool.name)).toContain(
      "notes.list",
    );

    const stalePost = await server.handle({
      method: "POST",
      headers: {
        authorization: "Bearer tok",
        "mcp-session-id": "missing",
      },
      body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    });
    expect(stalePost.status).toBe(404);

    const deleted = await server.handle({
      method: "DELETE",
      headers: {
        authorization: "Bearer tok",
        "mcp-session-id": sessionId!,
      },
    });
    expect(deleted.status).toBeGreaterThanOrEqual(200);
    expect(deleted.status).toBeLessThan(500);
    expect(server.sessions.get(sessionId)).toBeUndefined();
  });

  it("does not allocate or expose sessions before authentication", async () => {
    let authenticateCalls = 0;
    const server = kit(async () => {
      authenticateCalls += 1;
      return { kind: "absent" };
    });
    const initialize = await server.handle({
      method: "POST",
      headers: {},
      body: { jsonrpc: "2.0", id: 1, method: "initialize" },
    });
    expect(initialize.status).toBe(401);
    expect(server.sessions.size()).toBe(0);
    expect(authenticateCalls).toBe(0);

    const get = await server.handle({
      method: "GET",
      headers: { "mcp-session-id": "unknown" },
    });
    const del = await server.handle({
      method: "DELETE",
      headers: { "mcp-session-id": "unknown" },
    });
    expect(get.status).toBe(401);
    expect(del.status).toBe(401);
    expect(server.sessions.size()).toBe(0);
  });

  it("binds a session to the principal that initialized it", async () => {
    let principal = "owner";
    const server = kit(async () => ({
      kind: "authenticated" as const,
      principalId: principal,
      credential: { kind: "oauth" as const },
    }));
    const initialized = await server.handle({
      method: "POST",
      headers: { authorization: "Bearer tok" },
      body: { jsonrpc: "2.0", id: 1, method: "initialize" },
    });
    const sessionId = initialized.headers["Mcp-Session-Id"]!;
    principal = "other";
    const response = await server.handle({
      method: "DELETE",
      headers: {
        authorization: "Bearer tok",
        "mcp-session-id": sessionId,
      },
    });
    expect(response.status).toBe(404);
    expect(server.sessions.get(sessionId)).toBeDefined();
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
    expect((response.body as { error: { code: string } }).error.code).toBe(
      "unauthenticated",
    );
  });
});
