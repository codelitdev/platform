import { and, eq, gt, like, lte } from "drizzle-orm";
import type { ActionGrantStore } from "./grants.js";

type VerificationTable = {
  id: unknown;
  identifier: unknown;
  value: unknown;
  expiresAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

type TransactionalDb = {
  transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
  insert(table: any): any;
  delete(table: any): any;
};

/**
 * Stores billing action grants in Better Auth's `verification` table, which
 * every Better Auth product already has. Pass the product's Drizzle table.
 */
export function drizzleVerificationGrantStore(
  db: TransactionalDb,
  verification: VerificationTable,
): ActionGrantStore {
  const table = verification as any;
  return {
    async insert(record) {
      const now = new Date();
      await db.insert(table).values({
        id: crypto.randomUUID(),
        identifier: record.identifier,
        value: record.value,
        expiresAt: record.expiresAt,
        createdAt: now,
        updatedAt: now,
      });
    },
    async take(identifier, now) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(table)
          .where(and(eq(table.identifier, identifier), gt(table.expiresAt, now)))
          .limit(1)
          .for("update");
        if (!row) return null;
        await tx.delete(table).where(eq(table.id, row.id));
        return row.value as string;
      });
    },
    async purgeExpired(now) {
      await db
        .delete(table)
        .where(
          and(like(table.identifier, "billing-action:%"), lte(table.expiresAt, now)),
        );
    },
  };
}
