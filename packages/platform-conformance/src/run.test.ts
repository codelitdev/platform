import { describe, expect, it } from "bun:test";
import type { PlatformConformanceAdapter } from "./adapter.js";
import { type ReferenceHttpInput, runPlatformConformance } from "./run.js";

type Principal = { id: string; sessionCookie: string; oauthToken: string };
type Tenant = { id: string; publicId: string };

function memoryAdapter(options: {
  mcp?: boolean;
  challenge?: string | null;
}): PlatformConformanceAdapter<
  Principal,
  Tenant,
  { cookie: string },
  { authorization: string },
  { apiKey: string },
  ReferenceHttpInput,
  { headers: Record<string, string | undefined>; tool: string; args?: unknown },
  { status: number; body: unknown },
  { action: string; resourceId: string; actorId: string }
> {
  const owner = {
    id: "owner",
    sessionCookie: "better-auth.session_token=s",
    oauthToken: "tok",
  };
  const member = {
    ...owner,
    id: "member",
    sessionCookie: "better-auth.session_token=m",
  };
  const tenantA = { id: "a", publicId: "tnt_a" };
  const tenantB = { id: "b", publicId: "tnt_b" };
  const auditEvents: { action: string; resourceId: string; actorId: string }[] = [];
  return {
    async reset() {},
    fixtures: {
      owner,
      member,
      outsider: {
        ...owner,
        id: "out",
        sessionCookie: "better-auth.session_token=o",
      },
      tenantA,
      tenantB,
    },
    credentials: {
      async session(principal) {
        return { cookie: principal.sessionCookie };
      },
      async oauth(principal) {
        return { authorization: `Bearer ${principal.oauthToken}` };
      },
      async apiKey() {
        return { apiKey: "key.secret" };
      },
      async system() {
        return { kind: "system" };
      },
    },
    async http(input) {
      if (input.path === "/health") {
        return { status: 200, body: { status: "ok" } };
      }
      if (input.path === "/ready") {
        return {
          status: 200,
          body: { status: "ready", checks: { database: true } },
        };
      }
      if (input.headers.cookie && input.headers.authorization) {
        return {
          status: 400,
          body: { code: "credential_ambiguous" },
        };
      }
      if (input.headers.authorization === "Bearer totally-invalid") {
        return { status: 401, body: { code: "unauthenticated" } };
      }
      if (input.headers["x-api-key"]) {
        return {
          status: 200,
          body: { items: [{ tenantId: "tnt_a" }] },
        };
      }
      if (input.headers["x-tenant-id"] === "tnt_b") {
        return { status: 403, body: { code: "tenant_forbidden" } };
      }
      if (input.headers.cookie?.includes("session_token=o")) {
        return { status: 403, body: { code: "tenant_forbidden" } };
      }
      if (input.path === "/v1/billing/entitlement") {
        return { status: 200, body: { entitled: true } };
      }
      if (input.method === "POST" && input.path === "/v1/notes") {
        if (
          input.body &&
          typeof input.body === "object" &&
          (input.body as { title?: unknown }).title === "conformance note"
        ) {
          auditEvents.push({
            action: "note.created",
            resourceId: "note",
            actorId: "owner",
          });
          return { status: 201, body: { id: "note" } };
        }
        return { status: 400, body: { code: "validation_failed" } };
      }
      return { status: 200, body: { items: [] } };
    },
    mcp: options.mcp
      ? async (input) => {
          if (!input.headers.authorization) {
            return {
              status: 401,
              body: { error: { code: "unauthenticated" } },
              headers:
                options.challenge === null
                  ? {}
                  : {
                      "www-authenticate":
                        options.challenge ??
                        'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp"',
                    },
            };
          }
          if (
            input.tool === "notes.delete" &&
            input.args &&
            typeof input.args === "object"
          ) {
            if ((input.args as { confirm?: unknown }).confirm !== true) {
              return { status: 403, body: { error: { code: "forbidden" } } };
            }
            return { status: 404, body: { error: { code: "not_found" } } };
          }
          return {
            status: 200,
            body: { result: { content: [{ json: { items: [] } }] } },
          };
        }
      : undefined,
    async readAuditEvents() {
      return auditEvents;
    },
    async openapiDocument() {
      return {
        paths: { "/v1/notes": { get: { operationId: "listNotes" } } },
        contractOperationIds: ["listNotes", "createNote", "updateNote", "deleteNote"],
      };
    },
    observability: {
      async redact() {
        return "[redacted-token]";
      },
      async disabledDoesNotThrow() {
        return { threw: false };
      },
      async failingSinkDoesNotFailRequest() {
        return { requestStatus: 200 };
      },
    },
    billingComposition: {
      async generatedSchemaCurrent() {
        return true;
      },
      async actionGrantRejected() {
        return true;
      },
      async fakeProviderWorks() {
        return true;
      },
      async maintenanceInvoked() {
        return true;
      },
      async auditRecorded() {
        return true;
      },
    },
    async shutdown() {
      return { mcpStatus: 503 };
    },
  };
}

describe("runPlatformConformance", () => {
  it("fails when mcp is declared without a fixture", async () => {
    const result = await runPlatformConformance(memoryAdapter({ mcp: false }), {
      mcp: true,
    });
    expect(result.failures.some((f) => f.suite === "capabilities")).toBe(true);
  });

  it("fails when observability is declared without a fixture", async () => {
    const adapter = memoryAdapter({ mcp: true });
    delete (adapter as { observability?: unknown }).observability;
    const result = await runPlatformConformance(adapter, {
      observability: true,
    });
    expect(result.failures.some((f) => f.suite === "capabilities")).toBe(true);
  });

  it("passes isolation, auth, billing, mcp, observability, and shutdown suites when fixtures exist", async () => {
    const result = await runPlatformConformance(memoryAdapter({ mcp: true }), {
      mcp: true,
      billing: true,
      observability: true,
      openapi: true,
      shutdown: true,
    });
    expect(result.failures).toEqual([]);
  });

  it("fails MCP conformance when the unauthenticated response omits the bearer challenge", async () => {
    const result = await runPlatformConformance(
      memoryAdapter({ mcp: true, challenge: null }),
      { mcp: true },
    );
    expect(result.failures).toContainEqual({
      suite: "mcp",
      message:
        "unauthenticated MCP did not return a protected-resource bearer challenge",
    });
  });

  it.each([
    "Bearer",
    'Bearer resource_metadata="/relative/metadata"',
    'Bearer resource_metadata="https://api.example.com/wrong-path"',
  ])("fails MCP conformance for an invalid bearer challenge: %s", async (challenge) => {
    const result = await runPlatformConformance(
      memoryAdapter({ mcp: true, challenge }),
      { mcp: true },
    );
    expect(result.failures).toContainEqual({
      suite: "mcp",
      message:
        "unauthenticated MCP did not return a protected-resource bearer challenge",
    });
  });
});
