import { platformErrors } from "@codelitdev/platform/rest";
import { oc } from "@orpc/contract";
import { z } from "zod";

export const platformErrorSchema = z.object({
  code: z.enum([
    "unauthenticated",
    "credential_ambiguous",
    "tenant_required",
    "tenant_forbidden",
    "forbidden",
    "not_found",
    "conflict",
    "validation_failed",
    "rate_limited",
    "internal_error",
  ]),
  message: z.string(),
  details: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
});

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  time: z.string(),
});

export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.record(z.boolean()),
});

export const noteSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createNoteBodySchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(8000).default(""),
});

export const updateNoteBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(8000).optional(),
});

export const entitlementSchema = z.object({
  tenantId: z.string(),
  activePaidPlan: z.string().nullable(),
  entitled: z.boolean(),
  subscriptionStatus: z.string().nullable(),
});

export const tenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  selected: z.boolean().optional(),
});
export const apiKeySchema = z.object({
  id: z.string(),
  publicId: z.string(),
  raw: z.string().optional(),
  expiresAt: z.string().nullable().optional(),
  revokedAt: z.string().nullable().optional(),
  lastUsedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});
export const invitationSchema = z.object({
  ok: z.literal(true),
  id: z.string(),
  token: z.string().optional(),
});

// Errors every authenticated route can return. Platform error codes keep the
// public `{ code, message, details? }` body; see @codelitdev/platform/rest.
const authenticated = platformErrors(
  "unauthenticated",
  "credential_ambiguous",
  "forbidden",
  "rate_limited",
);
const tenantScoped = {
  ...authenticated,
  ...platformErrors("tenant_required", "tenant_forbidden"),
};

export const contract = {
  health: oc
    .route({ method: "GET", path: "/health", summary: "Liveness" })
    .output(healthResponseSchema),
  ready: oc
    .route({ method: "GET", path: "/ready", summary: "Readiness" })
    // Readiness reports keep their own body on 503 instead of a platform error.
    .errors({ not_ready: { status: 503, data: readinessResponseSchema } })
    .output(readinessResponseSchema),
  listNotes: oc
    .route({ method: "GET", path: "/v1/notes", summary: "List notes" })
    .errors(tenantScoped)
    .output(z.object({ items: z.array(noteSchema) })),
  createNote: oc
    .route({
      method: "POST",
      path: "/v1/notes",
      successStatus: 201,
      summary: "Create a note",
    })
    .errors({ ...tenantScoped, ...platformErrors("validation_failed") })
    .input(createNoteBodySchema)
    .output(noteSchema),
  updateNote: oc
    .route({ method: "PATCH", path: "/v1/notes/{noteId}", summary: "Update a note" })
    .errors({ ...tenantScoped, ...platformErrors("validation_failed", "not_found") })
    .input(updateNoteBodySchema.extend({ noteId: z.string() }))
    .output(noteSchema),
  deleteNote: oc
    .route({ method: "DELETE", path: "/v1/notes/{noteId}", summary: "Delete a note" })
    .errors({ ...tenantScoped, ...platformErrors("not_found") })
    .input(z.object({ noteId: z.string() }))
    .output(z.object({ id: z.string() })),
  getEntitlement: oc
    .route({
      method: "GET",
      path: "/v1/billing/entitlement",
      summary: "Billing entitlement",
    })
    .errors(tenantScoped)
    .output(entitlementSchema),
  listTenants: oc
    .route({ method: "GET", path: "/v1/tenants", summary: "List tenants" })
    .errors(authenticated)
    .output(z.object({ items: z.array(tenantSchema) })),
  createTenant: oc
    .route({
      method: "POST",
      path: "/v1/tenants",
      successStatus: 201,
      summary: "Create a tenant",
    })
    .errors({ ...authenticated, ...platformErrors("validation_failed") })
    .input(z.object({ name: z.string().min(1).max(200) }))
    .output(tenantSchema),
  selectTenant: oc
    .route({
      method: "POST",
      path: "/api/tenant/select",
      successStatus: 204,
      summary: "Select the session tenant",
    })
    .errors({ ...tenantScoped, ...platformErrors("validation_failed") })
    .input(z.object({ tenantId: z.string().min(1) }))
    .output(z.void()),
  listApiKeys: oc
    .route({ method: "GET", path: "/v1/api-keys", summary: "List API keys" })
    .errors(tenantScoped)
    .output(z.object({ items: z.array(apiKeySchema.omit({ raw: true })) })),
  createApiKey: oc
    .route({
      method: "POST",
      path: "/v1/api-keys",
      successStatus: 201,
      summary: "Create an API key",
    })
    .errors({ ...tenantScoped, ...platformErrors("validation_failed") })
    .input(
      z.object({
        permissions: z.array(z.string()).default([]),
        expiresAt: z.string().datetime().optional(),
      }),
    )
    .output(apiKeySchema.required({ raw: true })),
  revokeApiKey: oc
    .route({
      method: "DELETE",
      path: "/v1/api-keys/{publicId}",
      successStatus: 204,
      summary: "Revoke an API key",
    })
    .errors({ ...tenantScoped, ...platformErrors("not_found") })
    .input(z.object({ publicId: z.string() }))
    .output(z.void()),
  createInvitation: oc
    .route({
      method: "POST",
      path: "/v1/invitations",
      successStatus: 201,
      summary: "Invite a member",
    })
    .errors({ ...tenantScoped, ...platformErrors("validation_failed") })
    .input(
      z.object({
        email: z.string().email(),
        role: z.string().min(1),
        permissions: z.array(z.string()).default([]),
      }),
    )
    .output(invitationSchema),
  acceptInvitation: oc
    .route({
      method: "POST",
      path: "/v1/invitations/accept",
      summary: "Accept an invitation",
    })
    .errors({ ...authenticated, ...platformErrors("validation_failed", "not_found") })
    .input(z.object({ token: z.string().min(1), email: z.string().email() }))
    .output(z.object({ ok: z.literal(true), tenantId: z.string() })),
  revokeInvitation: oc
    .route({
      method: "DELETE",
      path: "/v1/invitations/{invitationId}",
      successStatus: 204,
      summary: "Revoke an invitation",
    })
    .errors({ ...tenantScoped, ...platformErrors("not_found") })
    .input(z.object({ invitationId: z.string() }))
    .output(z.void()),
};

export type Contract = typeof contract;
export { mcpParityManifest } from "./mcp-parity.js";
