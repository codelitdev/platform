import {
  captureAndMapException,
  createPlatformError,
  createPublicId,
  healthReport,
  type PlatformRequestContext,
  readinessReport,
  readOrCreateRequestId,
  toPublicHttpError,
  uuidv7,
} from "@codelitdev/platform";
import {
  createNoteBodySchema,
  updateNoteBodySchema,
} from "@reference-product/api-contract";
import { eq } from "drizzle-orm";
import {
  createApiKeyRecord,
  listApiKeyRecords,
  revokeApiKey,
} from "./auth/api-keys.js";
import { authenticateHttpRequest } from "./auth/authenticate.js";
import * as schema from "./db/schema/index.js";
import type { DispatchDeps } from "./deps.js";
import { acceptInvitation, createInvitation, revokeInvitation } from "./invitations.js";
import { createReferenceMcp } from "./mcp.js";
import { createNote, deleteNote, listNotes, updateNote } from "./notes.js";
import { createOpenApiDocument } from "./openapi.js";
import { REFERENCE_PERMISSIONS, type ReferencePermission } from "./permissions.js";
import { headerTenantId, resolveTenantContext } from "./tenancy.js";
import type { DispatchResponse, IncomingRequest } from "./types.js";

export type { DispatchDeps };

const mcpKits = new WeakMap<DispatchDeps, ReturnType<typeof createReferenceMcp>>();

export function mcpFor(deps: DispatchDeps) {
  const existing = mcpKits.get(deps);
  if (existing) return existing;
  const created = createReferenceMcp(deps);
  mcpKits.set(deps, created);
  return created;
}

function requestHeaders(request: IncomingRequest) {
  return request.headers;
}

function errorResponse(
  error: ReturnType<typeof createPlatformError>,
): DispatchResponse {
  const mapped = toPublicHttpError(error);
  return { status: mapped.status, body: mapped.body };
}

export async function dispatch(
  deps: DispatchDeps,
  request: IncomingRequest,
): Promise<DispatchResponse> {
  try {
    const path = request.path.split("?")[0] ?? request.path;
    if (request.method === "GET" && path === "/health") {
      return {
        status: 200,
        body: healthReport(deps.serviceName, deps.clock),
      };
    }
    if (request.method === "GET" && path === "/ready") {
      const report = readinessReport([{ name: "database", ready: deps.databaseReady }]);
      return {
        status: report.status === "ready" ? 200 : 503,
        body: report,
      };
    }
    if (request.method === "GET" && path === "/openapi.json") {
      return {
        status: 200,
        body: createOpenApiDocument(deps.auth.publicApiUrl),
      };
    }

    if (path === "/mcp") {
      const mcp = mcpFor(deps);
      const result = await mcp.handle({
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
      return {
        status: result.status,
        body: result.body,
        headers: {
          ...result.headers,
          ...(result.status === 401
            ? {
                "WWW-Authenticate": `Bearer resource_metadata="${deps.auth.publicApiUrl}/.well-known/oauth-protected-resource/mcp"`,
              }
            : {}),
        },
      };
    }

    const auth = await authenticateHttpRequest(requestHeaders(request), deps);
    if (auth.kind !== "authenticated") {
      const error =
        auth.kind === "rejected" ? auth.error : createPlatformError("unauthenticated");
      return errorResponse(error);
    }

    // Account-scoped tenant management is intentionally handled before a
    // tenant context is required.
    if (request.method === "POST" && path === "/api/tenant/select") {
      if (auth.credential.kind === "api_key") {
        return errorResponse(createPlatformError("forbidden"));
      }
      const tenantId =
        request.body &&
        typeof request.body === "object" &&
        typeof (request.body as { tenantId?: unknown }).tenantId === "string"
          ? (request.body as { tenantId: string }).tenantId
          : "";
      if (!tenantId) return errorResponse(createPlatformError("validation_failed"));
      const resolved = await resolveTenantContext({
        db: deps.db,
        principalId: auth.principalId,
        credential: auth.credential,
        requestedPublicTenantId: tenantId,
      });
      if (!resolved.ok) return errorResponse(resolved.error);
      const requestId = readOrCreateRequestId(
        typeof request.headers["x-request-id"] === "string"
          ? request.headers["x-request-id"]
          : undefined,
        deps.clock,
      );
      await deps.db.transaction(async (tx) => {
        await tx
          .delete(schema.selectedTenants)
          .where(eq(schema.selectedTenants.userId, auth.principalId));
        await tx.insert(schema.selectedTenants).values({
          userId: auth.principalId,
          tenantId: resolved.value.tenantId,
        });
        await tx.insert(schema.auditEvents).values({
          id: uuidv7(deps.clock),
          tenantId: resolved.value.tenantId,
          actorId: auth.principalId,
          action: "tenant.selected",
          resourceType: "tenant",
          resourceId: resolved.value.publicId,
          requestId,
          createdAt: deps.clock.now(),
        });
      });
      return { status: 204, body: undefined };
    }
    if (request.method === "GET" && path === "/v1/tenants") {
      if (auth.credential.kind === "api_key") {
        return errorResponse(createPlatformError("forbidden"));
      }
      const selectedRows = await deps.db
        .select({ publicId: schema.tenants.publicId })
        .from(schema.selectedTenants)
        .innerJoin(
          schema.tenants,
          eq(schema.tenants.id, schema.selectedTenants.tenantId),
        )
        .where(eq(schema.selectedTenants.userId, auth.principalId))
        .limit(1);
      const selectedTenantPublicId = selectedRows[0]?.publicId;
      const rows = await deps.db
        .select({
          publicId: schema.tenants.publicId,
          name: schema.tenants.name,
        })
        .from(schema.memberships)
        .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
        .where(eq(schema.memberships.userId, auth.principalId));
      return {
        status: 200,
        body: {
          items: rows.map((row) => ({
            id: row.publicId,
            name: row.name,
            selected: row.publicId === selectedTenantPublicId,
          })),
        },
      };
    }
    if (request.method === "POST" && path === "/v1/tenants") {
      if (auth.credential.kind === "api_key") {
        return errorResponse(createPlatformError("forbidden"));
      }
      const name =
        request.body &&
        typeof request.body === "object" &&
        typeof (request.body as { name?: unknown }).name === "string"
          ? (request.body as { name: string }).name.trim()
          : "";
      if (!name || name.length > 200) {
        return errorResponse(createPlatformError("validation_failed"));
      }
      const now = deps.clock.now();
      const tenantId = uuidv7(deps.clock);
      const publicId = createPublicId("tnt", deps.clock);
      const requestId = readOrCreateRequestId(
        typeof request.headers["x-request-id"] === "string"
          ? request.headers["x-request-id"]
          : undefined,
        deps.clock,
      );
      await deps.db.transaction(async (tx) => {
        await tx.insert(schema.tenants).values({
          id: tenantId,
          publicId,
          name,
          createdAt: now,
        });
        await tx.insert(schema.memberships).values({
          id: uuidv7(deps.clock),
          tenantId,
          userId: auth.principalId,
          role: "owner",
          isOwner: true,
          permissions: "notes:read,notes:write,notes:delete,tenant:admin,billing:read",
          createdAt: now,
        });
        await tx.insert(schema.auditEvents).values({
          id: uuidv7(deps.clock),
          tenantId,
          actorId: auth.principalId,
          action: "tenant.created",
          resourceType: "tenant",
          resourceId: publicId,
          requestId,
          createdAt: now,
        });
        await tx
          .delete(schema.selectedTenants)
          .where(eq(schema.selectedTenants.userId, auth.principalId));
        await tx.insert(schema.selectedTenants).values({
          userId: auth.principalId,
          tenantId,
        });
      });
      return { status: 201, body: { id: publicId, name, selected: true } };
    }
    if (request.method === "POST" && path === "/v1/invitations/accept") {
      if (auth.credential.kind === "api_key") {
        return errorResponse(createPlatformError("forbidden"));
      }
      const input = request.body as { token?: unknown; email?: unknown } | undefined;
      if (typeof input?.token !== "string" || typeof input.email !== "string") {
        return errorResponse(createPlatformError("validation_failed"));
      }
      const result = await acceptInvitation(
        deps.db,
        {
          requestId: readOrCreateRequestId(
            typeof request.headers["x-request-id"] === "string"
              ? request.headers["x-request-id"]
              : undefined,
            deps.clock,
          ),
          principalId: auth.principalId,
          tenantId: null,
          credential: auth.credential,
          permissions: new Set(),
        },
        input.token,
        input.email,
        deps.clock,
      );
      return result.ok ? { status: 200, body: result } : errorResponse(result.error);
    }

    const tenant = await resolveTenantContext({
      db: deps.db,
      principalId: auth.principalId,
      credential: auth.credential,
      requestedPublicTenantId: headerTenantId(request.headers),
    });
    if (!tenant.ok) return errorResponse(tenant.error);

    const context: PlatformRequestContext<string, string, ReferencePermission> = {
      requestId: readOrCreateRequestId(
        typeof request.headers["x-request-id"] === "string"
          ? request.headers["x-request-id"]
          : undefined,
        deps.clock,
      ),
      principalId: auth.principalId,
      tenantId: tenant.value.tenantId,
      credential: auth.credential,
      permissions: tenant.value.permissions,
    };

    if (request.method === "POST" && path === "/v1/api-keys") {
      if (!context.permissions.has("tenant:admin")) {
        return errorResponse(createPlatformError("forbidden"));
      }
      const input = request.body as
        | {
            permissions?: unknown;
            expiresAt?: unknown;
          }
        | undefined;
      const permissions = Array.isArray(input?.permissions) ? input.permissions : [];
      const expiresAt =
        typeof input?.expiresAt === "string" ? new Date(input.expiresAt) : undefined;
      if (
        expiresAt &&
        (Number.isNaN(expiresAt.getTime()) || expiresAt <= deps.clock.now())
      ) {
        return errorResponse(createPlatformError("validation_failed"));
      }
      if (
        !permissions.every(
          (value): value is string =>
            typeof value === "string" &&
            (REFERENCE_PERMISSIONS as readonly string[]).includes(value),
        )
      ) {
        return errorResponse(createPlatformError("validation_failed"));
      }
      const key = await createApiKeyRecord({
        db: deps.db,
        tenantId: context.tenantId!,
        userId: context.principalId,
        permissions,
        pepper: deps.apiKeyPepper,
        clock: deps.clock,
        expiresAt,
        audit: { requestId: context.requestId },
      });
      return { status: 201, body: key };
    }
    if (request.method === "GET" && path === "/v1/api-keys") {
      if (!context.permissions.has("tenant:admin")) {
        return errorResponse(createPlatformError("forbidden"));
      }
      const keys = await listApiKeyRecords(deps.db, context.tenantId!);
      return {
        status: 200,
        body: {
          items: keys.map((key) => ({
            id: key.id,
            publicId: key.publicId,
            expiresAt: key.expiresAt?.toISOString() ?? null,
            revokedAt: key.revokedAt?.toISOString() ?? null,
            lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
            createdAt: key.createdAt.toISOString(),
          })),
        },
      };
    }
    const revokeMatch = /^\/v1\/api-keys\/([^/]+)$/.exec(path);
    if (request.method === "DELETE" && revokeMatch) {
      if (!context.permissions.has("tenant:admin")) {
        return errorResponse(createPlatformError("forbidden"));
      }
      const revoked = await revokeApiKey(
        deps.db,
        decodeURIComponent(revokeMatch[1]!),
        context.tenantId!,
        deps.clock,
        { actorId: context.principalId, requestId: context.requestId },
      );
      return revoked
        ? { status: 204, body: null }
        : errorResponse(createPlatformError("not_found"));
    }
    if (request.method === "POST" && path === "/v1/invitations") {
      const input = request.body as
        | {
            email?: unknown;
            role?: unknown;
            permissions?: unknown;
          }
        | undefined;
      const permissions = Array.isArray(input?.permissions) ? input.permissions : [];
      if (
        typeof input?.email !== "string" ||
        typeof input.role !== "string" ||
        !permissions.every(
          (value): value is ReferencePermission =>
            typeof value === "string" &&
            (REFERENCE_PERMISSIONS as readonly string[]).includes(value),
        )
      ) {
        return errorResponse(createPlatformError("validation_failed"));
      }
      const result = await createInvitation(
        deps.db,
        context,
        { email: input.email, role: input.role, permissions },
        deps.clock,
      );
      return result.ok ? { status: 201, body: result } : errorResponse(result.error);
    }
    const invitationMatch = /^\/v1\/invitations\/([^/]+)$/.exec(path);
    if (request.method === "DELETE" && invitationMatch) {
      const result = await revokeInvitation(
        deps.db,
        context,
        decodeURIComponent(invitationMatch[1]!),
        deps.clock,
      );
      return result.ok ? { status: 204, body: null } : errorResponse(result.error);
    }

    if (request.method === "GET" && path === "/v1/notes") {
      const result = await listNotes(deps.db, context, tenant.value.publicId);
      if (!result.ok) return errorResponse(result.error);
      return { status: 200, body: { items: result.value } };
    }

    if (request.method === "POST" && path === "/v1/notes") {
      const parsed = createNoteBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return errorResponse(createPlatformError("validation_failed"));
      }
      const result = await createNote(
        deps.db,
        context,
        tenant.value.publicId,
        parsed.data,
        deps.clock,
      );
      if (!result.ok) return errorResponse(result.error);
      return { status: 201, body: result.value };
    }

    const noteMatch = /^\/v1\/notes\/([^/]+)$/.exec(path);
    if (request.method === "PATCH" && noteMatch) {
      const parsed = updateNoteBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return errorResponse(createPlatformError("validation_failed"));
      }
      const result = await updateNote(
        deps.db,
        context,
        tenant.value.publicId,
        decodeURIComponent(noteMatch[1]!),
        parsed.data,
        deps.clock,
      );
      if (!result.ok) return errorResponse(result.error);
      return { status: 200, body: result.value };
    }
    if (request.method === "DELETE" && noteMatch) {
      const result = await deleteNote(
        deps.db,
        context,
        decodeURIComponent(noteMatch[1]!),
        deps.clock,
      );
      if (!result.ok) return errorResponse(result.error);
      return { status: 200, body: result.value };
    }

    if (request.method === "GET" && path === "/v1/billing/entitlement") {
      if (!context.permissions.has("billing:read")) {
        return errorResponse(createPlatformError("forbidden"));
      }
      const state = await deps.billing.billing.commercialState(context.tenantId!);
      return {
        status: 200,
        body: {
          tenantId: tenant.value.publicId,
          activePaidPlan: state.activePaidPlan,
          entitled: state.activePaidPlan !== null,
          subscriptionStatus: state.subscriptionStatus,
        },
      };
    }

    return errorResponse(createPlatformError("not_found"));
  } catch (thrown) {
    return errorResponse(
      captureAndMapException(thrown, (error) =>
        deps.observability?.captureException({
          error,
          source: "http.dispatch",
          context: { method: request.method, path: request.path },
        }),
      ),
    );
  }
}
