import { contract } from "@__PRODUCT_SLUG__/api-contract";
import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createReferenceAuth } from "./auth/better-auth.js";
import { composeOAuthProviderOptions } from "./auth/oauth.js";
import * as schema from "./db/schema/index.js";
import { dispatch } from "./dispatch.js";
import { createExpressApp } from "./express-app.js";
import { createPgliteRuntime, freezeRuntimeClock } from "./runtime.js";
import { seedWorld } from "./seed.js";

describe.serial("reference API adapters", () => {
  it("does not run DDL when oauth-server-kit options and schema modules are imported", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const client = new PGlite();
    composeOAuthProviderOptions("http://127.0.0.1:4000");
    await import("./db/schema/index.js");
    await import("./db/schema/billing.generated.js");
    const tables = await client.query(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    expect(tables.rows).toEqual([]);
    const { drizzle } = await import("drizzle-orm/pglite");
    const db = drizzle(client);
    const auth = createReferenceAuth({
      db: db as never,
      publicApiUrl: "http://127.0.0.1:4000",
      secret: "test-secret-that-is-at-least-thirty-two-characters",
    });
    await auth.auth.$context.catch(() => undefined);
    const after = await client.query(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    expect(after.rows).toEqual([]);
    await client.close();
  });

  it("rejects multiple credential mechanisms as credential_ambiguous", async () => {
    const clock = freezeRuntimeClock(new Date("2026-03-01T00:00:00.000Z"));
    const runtime = await createPgliteRuntime({ clock });
    const world = await seedWorld(runtime, clock);
    const response = await dispatch(runtime, {
      method: "GET",
      path: "/v1/notes",
      headers: {
        cookie: world.owner.sessionCookie,
        authorization: `Bearer ${world.owner.oauthToken}`,
      },
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "credential_ambiguous" });
    await runtime.close();
  });

  it("returns unauthenticated for invalid API keys and bearer tokens with no fallback", async () => {
    const clock = freezeRuntimeClock(new Date("2026-03-01T00:00:00.000Z"));
    const runtime = await createPgliteRuntime({ clock });
    await seedWorld(runtime, clock);
    const invalidKey = await dispatch(runtime, {
      method: "GET",
      path: "/v1/notes",
      headers: { "x-api-key": "key_missing.not-a-secret" },
    });
    expect(invalidKey.status).toBe(401);
    expect(invalidKey.body).toMatchObject({ code: "unauthenticated" });
    const invalidBearer = await dispatch(runtime, {
      method: "GET",
      path: "/v1/notes",
      headers: { authorization: "Bearer totally-invalid" },
    });
    expect(invalidBearer.status).toBe(401);
    expect(invalidBearer.body).toMatchObject({ code: "unauthenticated" });
    const anonymous = await dispatch(runtime, {
      method: "GET",
      path: "/v1/notes",
      headers: {},
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ code: "unauthenticated" });
    await runtime.close();
  });

  it("binds an API key to its tenant and ignores X-Tenant-ID", async () => {
    const clock = freezeRuntimeClock(new Date("2026-03-01T00:00:00.000Z"));
    const runtime = await createPgliteRuntime({ clock });
    const world = await seedWorld(runtime, clock);
    const response = await dispatch(runtime, {
      method: "GET",
      path: "/v1/notes",
      headers: {
        "x-api-key": world.apiKeyA.raw,
        "x-tenant-id": world.tenantB.publicId,
      },
    });
    expect(response.status).toBe(200);
    const body = response.body as {
      items: Array<{ tenantId: string; id: string }>;
    };
    expect(body.items.every((item) => item.tenantId === world.tenantA.publicId)).toBe(
      true,
    );
    expect(body.items.some((item) => item.id === world.noteA.publicId)).toBe(true);
    await runtime.close();
  });

  it("supports one-time API-key creation, metadata listing, scoped revocation, and expiry", async () => {
    const clock = freezeRuntimeClock(new Date("2026-03-01T00:00:00.000Z"));
    const runtime = await createPgliteRuntime({ clock });
    const world = await seedWorld(runtime, clock);
    const created = await dispatch(runtime, {
      method: "POST",
      path: "/v1/api-keys",
      headers: {
        cookie: world.owner.sessionCookie,
        "x-tenant-id": world.tenantA.publicId,
      },
      body: {
        permissions: ["notes:read"],
        expiresAt: "2026-04-01T00:00:00.000Z",
      },
    });
    expect(created.status).toBe(201);
    const key = created.body as { publicId: string; raw: string };
    expect(key.raw).toContain(`${key.publicId}.`);
    const listed = await dispatch(runtime, {
      method: "GET",
      path: "/v1/api-keys",
      headers: {
        cookie: world.owner.sessionCookie,
        "x-tenant-id": world.tenantA.publicId,
      },
    });
    expect(JSON.stringify(listed.body)).not.toContain(key.raw);
    const wrongTenant = await dispatch(runtime, {
      method: "DELETE",
      path: `/v1/api-keys/${key.publicId}`,
      headers: {
        cookie: world.owner.sessionCookie,
        "x-tenant-id": world.tenantB.publicId,
      },
    });
    expect(wrongTenant.status).toBe(404);
    const revoked = await dispatch(runtime, {
      method: "DELETE",
      path: `/v1/api-keys/${key.publicId}`,
      headers: {
        cookie: world.owner.sessionCookie,
        "x-tenant-id": world.tenantA.publicId,
      },
    });
    expect(revoked.status).toBe(204);
    const unusable = await dispatch(runtime, {
      method: "GET",
      path: "/v1/notes",
      headers: { "x-api-key": key.raw },
    });
    expect(unusable.status).toBe(401);
    await runtime.close();
  });

  it("denies a tenant A member mutating tenant B's note", async () => {
    const clock = freezeRuntimeClock(new Date("2026-03-01T00:00:00.000Z"));
    const runtime = await createPgliteRuntime({ clock });
    const world = await seedWorld(runtime, clock);
    const response = await dispatch(runtime, {
      method: "PATCH",
      path: `/v1/notes/${world.noteA.publicId}`,
      headers: {
        cookie: world.member.sessionCookie,
        "x-tenant-id": world.tenantB.publicId,
      },
      body: { title: "hijack" },
    });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "tenant_forbidden" });
    const still = await runtime.db
      .select()
      .from(schema.notes)
      .where(eq(schema.notes.publicId, world.noteA.publicId));
    expect(still[0]?.title).toBe("Seed note");
    await runtime.close();
  });

  it("writes an application audit event for an authorized mutation", async () => {
    const clock = freezeRuntimeClock(new Date("2026-03-01T00:00:00.000Z"));
    const runtime = await createPgliteRuntime({ clock });
    const world = await seedWorld(runtime, clock);
    const response = await dispatch(runtime, {
      method: "PATCH",
      path: `/v1/notes/${world.noteA.publicId}`,
      headers: {
        cookie: world.owner.sessionCookie,
        "x-tenant-id": world.tenantA.publicId,
      },
      body: { title: "Updated note" },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: world.noteA.publicId,
      title: "Updated note",
    });
    const events = await runtime.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "note.updated"));
    expect(events).toHaveLength(1);
    expect(events[0]?.resourceId).toBe(world.noteA.publicId);
    expect(events[0]?.actorId).toBe(world.owner.id);
    await runtime.close();
  });

  it("returns a billing entitlement from the public billing composition", async () => {
    const clock = freezeRuntimeClock(new Date("2026-03-01T00:00:00.000Z"));
    const runtime = await createPgliteRuntime({ clock });
    const world = await seedWorld(runtime, clock);
    const response = await dispatch(runtime, {
      method: "GET",
      path: "/v1/billing/entitlement",
      headers: {
        cookie: world.owner.sessionCookie,
        "x-tenant-id": world.tenantA.publicId,
      },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      tenantId: world.tenantA.publicId,
      entitled: true,
      activePaidPlan: "pro",
    });
    const direct = await runtime.billing.billing.commercialState(world.tenantA.id);
    expect(direct.activePaidPlan).toBe(
      (response.body as { activePaidPlan: string }).activePaidPlan,
    );
    await runtime.close();
  });

  it("authenticates OAuth bearer tokens through oauth-server-kit", async () => {
    const clock = freezeRuntimeClock(new Date("2026-03-01T00:00:00.000Z"));
    const runtime = await createPgliteRuntime({ clock });
    const world = await seedWorld(runtime, clock);
    const response = await dispatch(runtime, {
      method: "GET",
      path: "/v1/notes",
      headers: {
        authorization: `Bearer ${world.owner.oauthToken}`,
        "x-tenant-id": world.tenantA.publicId,
      },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      items: [{ id: world.noteA.publicId }],
    });
    await runtime.close();
  });

  it("serves the same notes service over MCP with parity, isolation, and confirmation", async () => {
    const clock = freezeRuntimeClock(new Date("2026-03-01T00:00:00.000Z"));
    const runtime = await createPgliteRuntime({ clock });
    const world = await seedWorld(runtime, clock);
    const { validateParityManifest } = await import("@codelitdev/mcp-server-kit");
    const { mcpParityManifest } = await import("@__PRODUCT_SLUG__/api-contract");
    const { createReferenceMcp } = await import("./mcp.js");
    const mcp = createReferenceMcp(runtime);
    const issues = validateParityManifest([...mcpParityManifest], {
      restOperationIds: new Set(Object.keys(contract)),
      mcpToolNames: new Set(mcp.listTools().map((tool) => tool.name)),
      mcpToolRisks: new Map(
        mcp.listTools().map((tool) => [tool.name, tool.risk] as const),
      ),
      now: new Date("2026-09-02T00:00:00.000Z"),
    });
    expect(issues).toEqual([]);

    const restList = await dispatch(runtime, {
      method: "GET",
      path: "/v1/notes",
      headers: {
        authorization: `Bearer ${world.owner.oauthToken}`,
        "x-tenant-id": world.tenantA.publicId,
      },
    });
    const mcpList = await dispatch(runtime, {
      method: "POST",
      path: "/mcp",
      headers: {
        authorization: `Bearer ${world.owner.oauthToken}`,
        "x-tenant-id": world.tenantA.publicId,
      },
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "notes.list", arguments: {} },
      },
    });
    expect(restList.status).toBe(200);
    expect(mcpList.status).toBe(200);
    const restItems = (restList.body as { items: Array<{ id: string }> }).items;
    const mcpJson = (
      mcpList.body as {
        result: { content: Array<{ json: { items: Array<{ id: string }> } }> };
      }
    ).result.content[0]?.json;
    expect(mcpJson?.items.map((item) => item.id)).toEqual(
      restItems.map((item) => item.id),
    );

    const initialized = await dispatch(runtime, {
      method: "POST",
      path: "/mcp",
      headers: {
        authorization: `Bearer ${world.owner.oauthToken}`,
        "x-tenant-id": world.tenantA.publicId,
        accept: "application/json",
      },
      body: {
        jsonrpc: "2.0",
        id: 10,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "reference-test", version: "0" },
        },
      },
    });
    expect(initialized.headers?.["Mcp-Session-Id"]).toEqual(expect.any(String));
    expect(initialized.headers?.["Access-Control-Expose-Headers"]).toBe(
      "Mcp-Session-Id",
    );

    const cross = await dispatch(runtime, {
      method: "POST",
      path: "/mcp",
      headers: {
        authorization: `Bearer ${world.owner.oauthToken}`,
        "x-tenant-id": world.tenantB.publicId,
      },
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "notes.update",
          arguments: { noteId: world.noteA.publicId, title: "hijack" },
        },
      },
    });
    expect((cross.body as { error: { code: string } }).error.code).toBe("not_found");

    const denied = await dispatch(runtime, {
      method: "POST",
      path: "/mcp",
      headers: {
        authorization: `Bearer ${world.owner.oauthToken}`,
        "x-tenant-id": world.tenantA.publicId,
      },
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "notes.delete",
          arguments: { noteId: world.noteA.publicId },
        },
      },
    });
    expect((denied.body as { error: { code: string } }).error.code).toBe("forbidden");

    const deleted = await dispatch(runtime, {
      method: "POST",
      path: "/mcp",
      headers: {
        authorization: `Bearer ${world.owner.oauthToken}`,
        "x-tenant-id": world.tenantA.publicId,
      },
      body: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "notes.delete",
          arguments: { noteId: world.noteA.publicId, confirm: true },
        },
      },
    });
    expect(deleted.status).toBe(200);
    const events = await runtime.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "note.deleted"));
    expect(events).toHaveLength(1);
    expect(events[0]?.resourceId).toBe(world.noteA.publicId);
    await runtime.close();
  });

  it("protects the last owner from removal", async () => {
    const clock = freezeRuntimeClock(new Date("2026-03-01T00:00:00.000Z"));
    const runtime = await createPgliteRuntime({ clock });
    const world = await seedWorld(runtime, clock);
    const { removeMember } = await import("./notes.js");
    const result = await removeMember(
      runtime.db,
      {
        requestId: "req_last_owner",
        principalId: world.owner.id,
        tenantId: world.tenantA.id,
        credential: { kind: "session", credentialId: "sess_owner" },
        permissions: new Set(["tenant:admin"]),
      },
      world.owner.id,
      clock,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("conflict");
    expect(result.error.safeDetails).toEqual({ reason: "last_owner" });
    await runtime.close();
  });

  it("passes platform conformance suites against the real adapter", async () => {
    const clock = freezeRuntimeClock(new Date("2026-03-01T00:00:00.000Z"));
    const runtime = await createPgliteRuntime({ clock });
    const world = await seedWorld(runtime, clock);
    const { runReferenceConformance } = await import("./conformance-adapter.js");
    const result = await runReferenceConformance(runtime, world);
    expect(result.failures).toEqual([]);
    await runtime.close();
  });

  it("serves health and readiness bodies", async () => {
    const clock = freezeRuntimeClock(new Date("2026-03-01T00:00:00.000Z"));
    const runtime = await createPgliteRuntime({ clock });
    const health = await dispatch(runtime, {
      method: "GET",
      path: "/health",
      headers: {},
    });
    expect(health).toEqual({
      status: 200,
      body: {
        status: "ok",
        service: "__PRODUCT_SLUG__-api",
        time: "2026-03-01T00:00:00.000Z",
      },
    });
    const ready = await dispatch(runtime, {
      method: "GET",
      path: "/ready",
      headers: {},
    });
    expect(ready).toEqual({
      status: 200,
      body: { status: "ready", checks: { database: true } },
    });
    await runtime.close();
  });

  it("mounts the shared contract through the Express ts-rest adapter", async () => {
    const runtime = await createPgliteRuntime({
      clock: freezeRuntimeClock(new Date("2026-03-01T00:00:00.000Z")),
    });
    const app = createExpressApp(runtime);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("listen_failed");
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toEqual(expect.any(String));
    const openapi = await fetch(`http://127.0.0.1:${address.port}/openapi.json`);
    expect(openapi.status).toBe(200);
    expect((await openapi.json()).paths["/v1/notes"]).toBeDefined();
    const docs = await fetch(`http://127.0.0.1:${address.port}/docs`);
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toContain("text/html");
    expect(await docs.text()).toContain("Swagger UI");
    const docsInitializer = await fetch(
      `http://127.0.0.1:${address.port}/docs/swagger-ui-init.js`,
    );
    expect(docsInitializer.status).toBe(200);
    expect(await docsInitializer.text()).toContain('"/v1/notes"');
    const protectedResource = await fetch(
      `http://127.0.0.1:${address.port}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(protectedResource.status).toBe(200);
    expect(await protectedResource.json()).toMatchObject({
      resource: runtime.auth.mcpResource,
      authorization_servers: [runtime.auth.issuer],
    });
    const authorizationServer = await fetch(
      `http://127.0.0.1:${address.port}/.well-known/oauth-authorization-server`,
    );
    expect(authorizationServer.status).toBe(200);
    expect(await authorizationServer.json()).toMatchObject({
      registration_endpoint: `${runtime.auth.issuer}/oauth2/register`,
    });
    const dcr = await fetch(
      `http://127.0.0.1:${address.port}${runtime.auth.authBasePath}/oauth2/register`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "local MCP client",
          redirect_uris: ["http://127.0.0.1:33418"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          application_type: "native",
          scope: "openid profile email data:read",
        }),
      },
    );
    expect(dcr.status).toBe(201);
    expect(await dcr.json()).toMatchObject({
      token_endpoint_auth_method: "none",
    });
    const mcpUnauthorized = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: {} },
      }),
    });
    expect(mcpUnauthorized.status).toBe(401);
    expect(mcpUnauthorized.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${runtime.auth.publicApiUrl}/.well-known/oauth-protected-resource/mcp"`,
    );
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
  });
});
