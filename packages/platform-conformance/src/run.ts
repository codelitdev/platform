import type {
  ConformanceCapabilities,
  ConformanceFailure,
  PlatformConformanceAdapter,
} from "./adapter.js";

export type ReferenceHttpInput = {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
};

export type ReferenceMcpInput = {
  headers: Record<string, string | undefined>;
  tool: string;
  args?: unknown;
};

type HttpAdapter = PlatformConformanceAdapter<
  { id: string; sessionCookie?: string; oauthToken?: string },
  { id: string; publicId: string },
  { cookie: string },
  { authorization: string },
  { apiKey: string },
  ReferenceHttpInput,
  ReferenceMcpInput,
  { status: number; body: unknown },
  { action: string; resourceId: string; actorId: string }
>;

function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  if ("code" in body && typeof body.code === "string") return body.code;
  if (
    "error" in body &&
    body.error &&
    typeof body.error === "object" &&
    "code" in body.error &&
    typeof body.error.code === "string"
  ) {
    return body.error.code;
  }
  return undefined;
}

export async function runPlatformConformance(
  adapter: HttpAdapter,
  capabilities: ConformanceCapabilities = {},
): Promise<{ failures: ConformanceFailure[] }> {
  const failures: ConformanceFailure[] = [];
  const fail = (suite: string, message: string) => {
    failures.push({ suite, message });
  };

  if (capabilities.mcp && typeof adapter.mcp !== "function") {
    fail("capabilities", "declared mcp capability has no mcp fixture");
    return { failures };
  }
  if (capabilities.observability && !adapter.observability) {
    fail(
      "capabilities",
      "declared observability capability has no observability fixture",
    );
    return { failures };
  }
  if (capabilities.billing && !adapter.billingComposition) {
    fail(
      "capabilities",
      "declared billing capability has no billingComposition fixture",
    );
    return { failures };
  }
  if (capabilities.openapi && typeof adapter.openapiDocument !== "function") {
    fail("capabilities", "declared openapi capability has no openapi fixture");
    return { failures };
  }
  if (capabilities.shutdown && typeof adapter.shutdown !== "function") {
    fail("capabilities", "declared shutdown capability has no shutdown fixture");
    return { failures };
  }

  await adapter.reset();
  const { owner, member, tenantA, tenantB } = adapter.fixtures;
  const session = await adapter.credentials.session(owner);
  const oauth = await adapter.credentials.oauth(owner);
  const apiKey = await adapter.credentials.apiKey(tenantA, [
    "notes:read",
    "notes:write",
    "notes:delete",
    "billing:read",
  ]);

  const health = await adapter.http({
    method: "GET",
    path: "/health",
    headers: {},
  });
  if (health.status !== 200 || (health.body as { status?: string }).status !== "ok") {
    fail("lifecycle", "health body is not ok");
  }
  const ready = await adapter.http({
    method: "GET",
    path: "/ready",
    headers: {},
  });
  if ((ready.body as { status?: string }).status !== "ready") {
    fail("lifecycle", "readiness body is not ready");
  }

  const ambiguous = await adapter.http({
    method: "GET",
    path: "/v1/notes",
    headers: {
      cookie: session.cookie,
      authorization: oauth.authorization,
    },
  });
  if (errorCode(ambiguous.body) !== "credential_ambiguous") {
    fail("auth", "multiple credentials did not return credential_ambiguous");
  }

  const invalid = await adapter.http({
    method: "GET",
    path: "/v1/notes",
    headers: { authorization: "Bearer totally-invalid" },
  });
  if (errorCode(invalid.body) !== "unauthenticated") {
    fail("auth", "invalid bearer did not return unauthenticated");
  }

  const keyCross = await adapter.http({
    method: "GET",
    path: "/v1/notes",
    headers: {
      "x-api-key": apiKey.apiKey,
      "x-tenant-id": tenantB.publicId,
    },
  });
  const keyBody = keyCross.body as { items?: Array<{ tenantId: string }> };
  if (
    keyCross.status !== 200 ||
    !keyBody.items?.every((item) => item.tenantId === tenantA.publicId)
  ) {
    fail("tenancy", "API key selected another tenant");
  }

  const memberSession = await adapter.credentials.session(member);
  const cross = await adapter.http({
    method: "PATCH",
    path: "/v1/notes/missing-from-b",
    headers: {
      cookie: memberSession.cookie,
      "x-tenant-id": tenantB.publicId,
    },
    body: { title: "x" },
  });
  if (errorCode(cross.body) !== "tenant_forbidden") {
    fail("tenancy", "member of A was not denied tenant B");
  }
  const outsider = await adapter.credentials.session(adapter.fixtures.outsider);
  const outsiderResponse = await adapter.http({
    method: "GET",
    path: "/v1/notes",
    headers: {
      cookie: outsider.cookie,
      "x-tenant-id": tenantA.publicId,
    },
  });
  if (errorCode(outsiderResponse.body) !== "tenant_forbidden") {
    fail("tenancy", "outsider was allowed to read a tenant");
  }

  const created = await adapter.http({
    method: "POST",
    path: "/v1/notes",
    headers: { cookie: session.cookie, "x-tenant-id": tenantA.publicId },
    body: { title: "conformance note", body: "created by the suite" },
  });
  if (created.status !== 201) {
    fail("rest", "authorized mutation did not succeed");
  } else if (adapter.readAuditEvents) {
    const events = await adapter.readAuditEvents();
    if (!events.some((event) => event.action === "note.created")) {
      fail("rest", "authorized mutation did not emit an audit event");
    }
  }

  if (capabilities.mcp) {
    const mcpList = await adapter.mcp!({
      headers: {
        authorization: oauth.authorization,
        "x-tenant-id": tenantA.publicId,
      },
      tool: "notes.list",
      args: {},
    });
    const mcpBody = mcpList.body as {
      result?: { content?: Array<{ json?: { items?: unknown[] } }> };
      error?: { code?: string };
    };
    if (mcpList.status !== 200 || !mcpBody.result) {
      fail("mcp", "notes.list MCP call failed");
    }
    const cookieMcp = await adapter.mcp!({
      headers: { cookie: session.cookie },
      tool: "notes.list",
      args: {},
    });
    if (errorCode(cookieMcp.body) !== "unauthenticated") {
      fail("mcp", "browser session was accepted on MCP");
    }
    const unconfirmed = await adapter.mcp!({
      headers: {
        authorization: oauth.authorization,
        "x-tenant-id": tenantA.publicId,
      },
      tool: "notes.delete",
      args: { noteId: "conformance-missing" },
    });
    if (errorCode(unconfirmed.body) !== "forbidden") {
      fail("mcp", "destructive MCP call did not require confirmation");
    }
    const confirmed = await adapter.mcp!({
      headers: {
        authorization: oauth.authorization,
        "x-tenant-id": tenantA.publicId,
      },
      tool: "notes.delete",
      args: { noteId: "conformance-missing", confirm: true },
    });
    if (errorCode(confirmed.body) !== "not_found") {
      fail("mcp", "confirmed destructive MCP call did not map not_found");
    }
  }

  const invalidRest = await adapter.http({
    method: "POST",
    path: "/v1/notes",
    headers: {
      cookie: session.cookie,
      "x-tenant-id": tenantA.publicId,
    },
    body: { title: "" },
  });
  if (errorCode(invalidRest.body) !== "validation_failed") {
    fail("rest", "invalid create body did not return validation_failed");
  }

  if (capabilities.openapi) {
    const document = await adapter.openapiDocument!();
    if (!document.paths["/v1/notes"]) {
      fail("openapi", "ts-rest contract is missing /v1/notes");
    }
    if (!document.contractOperationIds.includes("listNotes")) {
      fail("openapi", "ts-rest contract is missing listNotes");
    }
    for (const operationId of ["createNote", "updateNote", "deleteNote"]) {
      if (!document.contractOperationIds.includes(operationId)) {
        fail("openapi", `ts-rest contract is missing ${operationId}`);
      }
    }
  }

  if (capabilities.observability) {
    const obs = adapter.observability!;
    const redacted = await obs.redact("secret-token-abcdefghijklmnopqrstuvwxyz");
    if (redacted.includes("secret-token-abcdefghijklmnopqrstuvwxyz")) {
      fail("observability", "secret was not redacted");
    }
    const disabled = await obs.disabledDoesNotThrow();
    if (disabled.threw) {
      fail("observability", "disabled observability threw");
    }
    const isolated = await obs.failingSinkDoesNotFailRequest();
    if (isolated.requestStatus >= 500) {
      fail("observability", "failing sink failed the request");
    }
  }

  if (capabilities.billing) {
    const entitlement = await adapter.http({
      method: "GET",
      path: "/v1/billing/entitlement",
      headers: {
        cookie: session.cookie,
        "x-tenant-id": tenantA.publicId,
      },
    });
    const body = entitlement.body as { entitled?: boolean };
    if (entitlement.status !== 200 || typeof body.entitled !== "boolean") {
      fail("billing", "entitlement was not returned");
    }
    const composition = adapter.billingComposition!;
    if (!(await composition.generatedSchemaCurrent())) {
      fail("billing", "generated billing schema drifted");
    }
    if (!(await composition.actionGrantRejected())) {
      fail("billing", "action grant did not reject an invalid grant");
    }
    if (!(await composition.fakeProviderWorks())) {
      fail("billing", "fake provider did not serve catalog/checkout");
    }
    if (!(await composition.maintenanceInvoked())) {
      fail("billing", "maintenance invocation failed");
    }
    if (!(await composition.auditRecorded())) {
      fail("billing", "billing audit hook did not record");
    }
  }

  if (capabilities.shutdown) {
    const after = await adapter.shutdown!();
    if (after.mcpStatus !== 503) {
      fail("lifecycle", "shutdown did not reject MCP with 503");
    }
  }

  if (adapter.credentials.system) {
    const system = await adapter.credentials.system(owner);
    if (system.kind !== "system") {
      fail("auth", "system credential helper did not return system");
    }
  }

  return { failures };
}
