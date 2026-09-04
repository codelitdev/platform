import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

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

export const contract = c.router({
  health: {
    method: "GET",
    path: "/health",
    responses: { 200: healthResponseSchema },
    summary: "Liveness",
  },
  ready: {
    method: "GET",
    path: "/ready",
    responses: { 200: readinessResponseSchema, 503: readinessResponseSchema },
    summary: "Readiness",
  },
  listNotes: {
    method: "GET",
    path: "/v1/notes",
    responses: {
      200: z.object({ items: z.array(noteSchema) }),
      400: platformErrorSchema,
      401: platformErrorSchema,
      403: platformErrorSchema,
    },
  },
  createNote: {
    method: "POST",
    path: "/v1/notes",
    body: createNoteBodySchema,
    responses: {
      201: noteSchema,
      400: platformErrorSchema,
      401: platformErrorSchema,
      403: platformErrorSchema,
    },
  },
  updateNote: {
    method: "PATCH",
    path: "/v1/notes/:noteId",
    pathParams: z.object({ noteId: z.string() }),
    body: updateNoteBodySchema,
    responses: {
      200: noteSchema,
      400: platformErrorSchema,
      401: platformErrorSchema,
      403: platformErrorSchema,
      404: platformErrorSchema,
    },
  },
  deleteNote: {
    method: "DELETE",
    path: "/v1/notes/:noteId",
    pathParams: z.object({ noteId: z.string() }),
    responses: {
      200: z.object({ id: z.string() }),
      400: platformErrorSchema,
      401: platformErrorSchema,
      403: platformErrorSchema,
      404: platformErrorSchema,
    },
  },
  getEntitlement: {
    method: "GET",
    path: "/v1/billing/entitlement",
    responses: {
      200: entitlementSchema,
      400: platformErrorSchema,
      401: platformErrorSchema,
      403: platformErrorSchema,
    },
  },
  listTenants: {
    method: "GET",
    path: "/v1/tenants",
    responses: {
      200: z.object({ items: z.array(tenantSchema) }),
      401: platformErrorSchema,
      403: platformErrorSchema,
    },
  },
  createTenant: {
    method: "POST",
    path: "/v1/tenants",
    body: z.object({ name: z.string().min(1).max(200) }),
    responses: {
      201: tenantSchema,
      400: platformErrorSchema,
      401: platformErrorSchema,
    },
  },
  selectTenant: {
    method: "POST",
    path: "/api/tenant/select",
    body: z.object({ tenantId: z.string().min(1) }),
    responses: {
      204: z.undefined(),
      400: platformErrorSchema,
      401: platformErrorSchema,
      403: platformErrorSchema,
    },
  },
  listApiKeys: {
    method: "GET",
    path: "/v1/api-keys",
    responses: {
      200: z.object({ items: z.array(apiKeySchema.omit({ raw: true })) }),
      401: platformErrorSchema,
      403: platformErrorSchema,
    },
  },
  createApiKey: {
    method: "POST",
    path: "/v1/api-keys",
    body: z.object({
      permissions: z.array(z.string()).default([]),
      expiresAt: z.string().datetime().optional(),
    }),
    responses: {
      201: apiKeySchema.required({ raw: true }),
      400: platformErrorSchema,
      401: platformErrorSchema,
      403: platformErrorSchema,
    },
  },
  revokeApiKey: {
    method: "DELETE",
    path: "/v1/api-keys/:publicId",
    pathParams: z.object({ publicId: z.string() }),
    responses: {
      204: z.undefined(),
      401: platformErrorSchema,
      403: platformErrorSchema,
      404: platformErrorSchema,
    },
  },
  createInvitation: {
    method: "POST",
    path: "/v1/invitations",
    body: z.object({
      email: z.string().email(),
      role: z.string().min(1),
      permissions: z.array(z.string()).default([]),
    }),
    responses: {
      201: invitationSchema,
      400: platformErrorSchema,
      401: platformErrorSchema,
      403: platformErrorSchema,
    },
  },
  acceptInvitation: {
    method: "POST",
    path: "/v1/invitations/accept",
    body: z.object({ token: z.string().min(1), email: z.string().email() }),
    responses: {
      200: z.object({ ok: z.literal(true), tenantId: z.string() }),
      400: platformErrorSchema,
      401: platformErrorSchema,
      403: platformErrorSchema,
      404: platformErrorSchema,
    },
  },
  revokeInvitation: {
    method: "DELETE",
    path: "/v1/invitations/:invitationId",
    pathParams: z.object({ invitationId: z.string() }),
    responses: {
      204: z.undefined(),
      401: platformErrorSchema,
      403: platformErrorSchema,
      404: platformErrorSchema,
    },
  },
});

export type Contract = typeof contract;
export { mcpParityManifest } from "./mcp-parity.js";
