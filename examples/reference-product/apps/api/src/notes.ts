import { and, eq, sql } from "drizzle-orm";
import {
  createPlatformError,
  createPublicId,
  serializeDate,
  uuidv7,
  type Clock,
  type PlatformError,
  type PlatformRequestContext,
} from "@codelitdev/platform";
import * as schema from "./db/schema/index.js";
import type { ReferencePermission } from "./permissions.js";
import type { AppDb } from "./types.js";

export type NoteDto = {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

type Ctx = PlatformRequestContext<string, string, ReferencePermission>;

function toDto(
  row: typeof schema.notes.$inferSelect,
  publicTenantId: string,
): NoteDto {
  return {
    id: row.publicId,
    tenantId: publicTenantId,
    title: row.title,
    body: row.body,
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt),
  };
}

export async function listNotes(
  db: AppDb,
  ctx: Ctx,
  publicTenantId: string,
): Promise<
  { ok: true; value: NoteDto[] } | { ok: false; error: PlatformError }
> {
  if (!ctx.permissions.has("notes:read")) {
    return { ok: false, error: createPlatformError("forbidden") };
  }
  const rows = await db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.tenantId, ctx.tenantId!));
  return { ok: true, value: rows.map((row) => toDto(row, publicTenantId)) };
}

export async function createNote(
  db: AppDb,
  ctx: Ctx,
  publicTenantId: string,
  input: { title: string; body: string },
  clock: Clock,
): Promise<{ ok: true; value: NoteDto } | { ok: false; error: PlatformError }> {
  if (!ctx.permissions.has("notes:write")) {
    return { ok: false, error: createPlatformError("forbidden") };
  }
  const now = clock.now();
  const row = {
    id: uuidv7(clock),
    publicId: createPublicId("note", clock),
    tenantId: ctx.tenantId!,
    title: input.title,
    body: input.body,
    createdBy: ctx.principalId,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction(async (tx) => {
    await tx.insert(schema.notes).values(row);
    await tx.insert(schema.auditEvents).values({
      id: uuidv7(clock),
      tenantId: ctx.tenantId,
      actorId: ctx.principalId,
      action: "note.created",
      resourceType: "note",
      resourceId: row.publicId,
      requestId: ctx.requestId,
      createdAt: now,
    });
  });
  return { ok: true, value: toDto(row, publicTenantId) };
}

export async function updateNote(
  db: AppDb,
  ctx: Ctx,
  publicTenantId: string,
  notePublicId: string,
  input: { title?: string; body?: string },
  clock: Clock,
): Promise<{ ok: true; value: NoteDto } | { ok: false; error: PlatformError }> {
  if (!ctx.permissions.has("notes:write")) {
    return { ok: false, error: createPlatformError("forbidden") };
  }
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.notes)
      .where(
        and(
          eq(schema.notes.publicId, notePublicId),
          eq(schema.notes.tenantId, ctx.tenantId!),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) {
      return { ok: false as const, error: createPlatformError("not_found") };
    }
    const now = clock.now();
    const next = {
      title: input.title ?? row.title,
      body: input.body ?? row.body,
      updatedAt: now,
    };
    await tx.update(schema.notes).set(next).where(eq(schema.notes.id, row.id));
    await tx.insert(schema.auditEvents).values({
      id: uuidv7(clock),
      tenantId: ctx.tenantId,
      actorId: ctx.principalId,
      action: "note.updated",
      resourceType: "note",
      resourceId: row.publicId,
      requestId: ctx.requestId,
      createdAt: now,
    });
    return {
      ok: true as const,
      value: toDto({ ...row, ...next }, publicTenantId),
    };
  });
}

export async function deleteNote(
  db: AppDb,
  ctx: Ctx,
  notePublicId: string,
  clock: Clock,
): Promise<
  { ok: true; value: { id: string } } | { ok: false; error: PlatformError }
> {
  if (!ctx.permissions.has("notes:delete")) {
    return { ok: false, error: createPlatformError("forbidden") };
  }
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.notes)
      .where(
        and(
          eq(schema.notes.publicId, notePublicId),
          eq(schema.notes.tenantId, ctx.tenantId!),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) {
      return { ok: false as const, error: createPlatformError("not_found") };
    }
    await tx.delete(schema.notes).where(eq(schema.notes.id, row.id));
    await tx.insert(schema.auditEvents).values({
      id: uuidv7(clock),
      tenantId: ctx.tenantId,
      actorId: ctx.principalId,
      action: "note.deleted",
      resourceType: "note",
      resourceId: row.publicId,
      requestId: ctx.requestId,
      createdAt: clock.now(),
    });
    return { ok: true as const, value: { id: row.publicId } };
  });
}

export async function countOwners(
  db: AppDb,
  tenantId: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.tenantId, tenantId),
        eq(schema.memberships.isOwner, true),
      ),
    );
  return rows.length;
}

export async function removeMember(
  db: AppDb,
  ctx: Ctx,
  memberUserId: string,
  clock: Clock,
): Promise<{ ok: true } | { ok: false; error: PlatformError }> {
  if (!ctx.permissions.has("tenant:admin") || !ctx.tenantId) {
    return { ok: false, error: createPlatformError("forbidden") };
  }
  return db.transaction(async (tx) => {
    // Every membership removal for a tenant locks the tenant row first.
    // PostgreSQL serializes these transactions, so two concurrent owner
    // removals cannot both observe two owners and delete the last pair.
    await tx.execute(
      sql`SELECT id FROM tenants WHERE id = ${ctx.tenantId} FOR UPDATE`,
    );
    const rows = await tx
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.tenantId, ctx.tenantId!),
          eq(schema.memberships.userId, memberUserId),
        ),
      )
      .limit(1);
    const member = rows[0];
    if (!member) {
      return { ok: false as const, error: createPlatformError("not_found") };
    }
    if (member.isOwner) {
      const owners = await tx
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.tenantId, ctx.tenantId!),
            eq(schema.memberships.isOwner, true),
          ),
        );
      if (owners.length <= 1) {
        return {
          ok: false as const,
          error: createPlatformError("conflict", {
            safeDetails: { reason: "last_owner" },
          }),
        };
      }
    }
    await tx
      .delete(schema.memberships)
      .where(eq(schema.memberships.id, member.id));
    await tx.insert(schema.auditEvents).values({
      id: uuidv7(clock),
      tenantId: ctx.tenantId,
      actorId: ctx.principalId,
      action: "membership.removed",
      resourceType: "membership",
      resourceId: memberUserId,
      requestId: ctx.requestId,
      createdAt: clock.now(),
    });
    return { ok: true as const };
  });
}
