import { describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { frozenClock } from "../clock.js";
import { drizzleVerificationGrantStore } from "./drizzle.js";
import { createBillingActionGrants } from "./grants.js";

const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

describe("drizzle verification grant store", () => {
  it("stores grants in the verification table and consumes them once", async () => {
    const client = new PGlite();
    await client.exec(`create table verification (
      id text primary key,
      identifier text not null,
      value text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )`);
    const db = drizzle(client);
    const now = new Date();
    const grants = createBillingActionGrants({
      store: drizzleVerificationGrantStore(db as never, verification),
      clock: frozenClock(now),
    });
    const target = { kind: "user", id: "user_1" };
    const issued = await grants.issue({
      actorId: "user_1",
      sessionId: "session_1",
      sessionCreatedAt: now,
      action: "portal",
      target,
    });
    if (!issued.ok) throw new Error("expected a token");
    const rows = await db.select().from(verification);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.identifier.startsWith("billing-action:")).toBe(true);
    expect(rows[0]?.value).not.toContain(issued.token);

    const grant = grants.grant({
      token: issued.token,
      actorId: "user_1",
      sessionId: "session_1",
      action: "portal",
      target,
    });
    await grants.authorization.consume(grant, "portal", target, now);
    expect(await db.select().from(verification)).toHaveLength(0);
    await expect(
      grants.authorization.consume(grant, "portal", target, now),
    ).rejects.toMatchObject({
      code: "grant_invalid",
    });
  });
});
