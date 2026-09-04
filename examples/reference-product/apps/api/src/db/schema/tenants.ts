import {
    boolean,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.generated.js";

export const tenants = pgTable("tenants", {
    id: uuid("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const memberships = pgTable(
    "memberships",
    {
        id: uuid("id").primaryKey(),
        tenantId: uuid("tenant_id")
            .notNull()
            .references(() => tenants.id, { onDelete: "cascade" }),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        role: text("role").notNull(),
        isOwner: boolean("is_owner").notNull().default(false),
        permissions: text("permissions").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    },
    (table) => ({
        tenantUser: uniqueIndex("memberships_tenant_user_uidx").on(
            table.tenantId,
            table.userId,
        ),
    }),
);

export const selectedTenants = pgTable("selected_tenants", {
    userId: text("user_id")
        .primaryKey()
        .references(() => user.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
        .notNull()
        .references(() => tenants.id, { onDelete: "cascade" }),
});

export const invitations = pgTable("invitations", {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
        .notNull()
        .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    permissions: text("permissions").notNull(),
    tokenDigest: text("token_digest").notNull(),
    inviterId: text("inviter_id")
        .notNull()
        .references(() => user.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const apiKeys = pgTable("api_keys", {
    id: uuid("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    tenantId: uuid("tenant_id")
        .notNull()
        .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    digest: text("digest").notNull(),
    permissions: text("permissions").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
