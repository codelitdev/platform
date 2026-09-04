import {
  createPlatformError,
  type PlatformCredential,
  type PlatformError,
} from "@codelitdev/platform";
import { and, eq } from "drizzle-orm";
import * as schema from "./db/schema/index.js";
import { parsePermissions, type ReferencePermission } from "./permissions.js";
import type { AppDb } from "./types.js";

export type ResolvedTenant = {
  tenantId: string;
  publicId: string;
  permissions: ReadonlySet<ReferencePermission>;
};

export async function resolveTenantContext(input: {
  db: AppDb;
  principalId: string;
  credential: PlatformCredential;
  requestedPublicTenantId: string | null;
}): Promise<{ ok: true; value: ResolvedTenant } | { ok: false; error: PlatformError }> {
  if (input.credential.kind === "api_key") {
    if (!input.credential.credentialId) {
      return { ok: false, error: createPlatformError("unauthenticated") };
    }
    const keys = await input.db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, input.credential.credentialId))
      .limit(1);
    const key = keys[0];
    if (!key) {
      return { ok: false, error: createPlatformError("unauthenticated") };
    }
    const tenants = await input.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.id, key.tenantId))
      .limit(1);
    const tenant = tenants[0];
    if (!tenant) {
      return { ok: false, error: createPlatformError("tenant_forbidden") };
    }
    return {
      ok: true,
      value: {
        tenantId: tenant.id,
        publicId: tenant.publicId,
        permissions: parsePermissions(key.permissions),
      },
    };
  }
  if (!input.requestedPublicTenantId) {
    const selected = await input.db
      .select()
      .from(schema.selectedTenants)
      .where(eq(schema.selectedTenants.userId, input.principalId))
      .limit(1);
    if (!selected[0]) {
      return { ok: false, error: createPlatformError("tenant_required") };
    }
    return loadMembership(input.db, input.principalId, selected[0].tenantId);
  }
  const tenants = await input.db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.publicId, input.requestedPublicTenantId))
    .limit(1);
  const tenant = tenants[0];
  if (!tenant) {
    return { ok: false, error: createPlatformError("tenant_forbidden") };
  }
  return loadMembership(input.db, input.principalId, tenant.id);
}

async function loadMembership(
  db: AppDb,
  principalId: string,
  tenantId: string,
): Promise<{ ok: true; value: ResolvedTenant } | { ok: false; error: PlatformError }> {
  const rows = await db
    .select({
      membership: schema.memberships,
      tenant: schema.tenants,
    })
    .from(schema.memberships)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
    .where(
      and(
        eq(schema.memberships.tenantId, tenantId),
        eq(schema.memberships.userId, principalId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { ok: false, error: createPlatformError("tenant_forbidden") };
  }
  return {
    ok: true,
    value: {
      tenantId: row.tenant.id,
      publicId: row.tenant.publicId,
      permissions: parsePermissions(row.membership.permissions),
    },
  };
}

export function headerTenantId(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const raw = headers["x-tenant-id"] ?? headers["X-Tenant-ID"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.trim().length > 0 ? value.trim() : null;
}
