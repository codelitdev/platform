import { and, eq, sql } from "drizzle-orm";
import type { Clock } from "../../core/clock.js";
import {
    createDrizzleBillingStore,
    type CheckoutApplicationFieldsCodec,
    type DrizzleBillingStore,
    type DrizzleBillingStoreOptions,
    type DrizzleDb,
    type GeneratedBillingSchema,
} from "./store.js";
import type { BillingStore } from "../../persistence/store.js";

export {
    createDrizzleBillingStore,
    type CheckoutApplicationFieldsCodec,
    type DrizzleBillingStore,
    type DrizzleBillingStoreOptions,
    type DrizzleDb,
    type GeneratedBillingSchema,
};

export type DrizzleLike = {
    insert: (...args: never[]) => unknown;
    select: (...args: never[]) => unknown;
    update: (...args: never[]) => unknown;
    transaction: <T>(fn: (tx: DrizzleLike) => Promise<T>) => Promise<T>;
    execute?: (query: unknown) => Promise<unknown>;
};

type Insertable = {
    insert: (t: never) => {
        values: (v: unknown) => { returning: () => Promise<unknown> };
    };
    select: () => {
        from: (t: unknown) => {
            where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> };
        };
    };
};

export type DrizzleBillingAdapter = BillingStore & {
    schema: GeneratedBillingSchema;
    db: DrizzleLike;
    clock: Clock;
    withTransaction<T>(
        fn: (() => Promise<T>) | ((tx: DrizzleLike) => Promise<T>),
    ): Promise<T>;
    insertCheckoutAttempt(values: Record<string, unknown>): Promise<unknown>;
    insertWebhookEvent(values: Record<string, unknown>): Promise<unknown>;
    insertProviderCustomer(values: Record<string, unknown>): Promise<unknown>;
    insertSubscriptionProjection(
        values: Record<string, unknown>,
    ): Promise<unknown>;
    getCheckoutAttemptById(id: string): Promise<unknown>;
    getWebhookEvent(
        provider: string,
        providerEventId: string,
    ): Promise<unknown>;
    getSubscriptionProjection(
        provider: string,
        providerSubscriptionId: string,
    ): Promise<unknown>;
};

export function drizzleBillingAdapter(
    db: DrizzleLike,
    options: DrizzleBillingStoreOptions,
): DrizzleBillingAdapter {
    const store = createDrizzleBillingStore(db as never as DrizzleDb, options);
    const adapter: DrizzleBillingAdapter = {
        ...store,
        schema: options.schema,
        db,
        clock: options.clock,
        get transactionDepth() {
            return store.transactionDepth;
        },
        async withTransaction<T>(
            fn: (() => Promise<T>) | ((tx: DrizzleLike) => Promise<T>),
        ): Promise<T> {
            return store.withTransaction(
                fn.length > 0
                    ? (tx: DrizzleDb) =>
                          (fn as (tx: DrizzleLike) => Promise<T>)(
                              tx as DrizzleLike,
                          )
                    : (fn as () => Promise<T>),
            );
        },
        async insertCheckoutAttempt(values) {
            return (db as Insertable)
                .insert(options.schema.billingCheckoutAttempts as never)
                .values(values)
                .returning();
        },
        async insertWebhookEvent(values) {
            return (db as Insertable)
                .insert(options.schema.billingWebhookEvents as never)
                .values(values)
                .returning();
        },
        async insertProviderCustomer(values) {
            return (db as Insertable)
                .insert(options.schema.billingProviderCustomers as never)
                .values(values)
                .returning();
        },
        async insertSubscriptionProjection(values) {
            return (db as Insertable)
                .insert(options.schema.billingSubscriptions as never)
                .values(values)
                .returning();
        },
        async getCheckoutAttemptById(id: string) {
            const table = options.schema.billingCheckoutAttempts as {
                id: unknown;
            };
            const rows = await (db as Insertable)
                .select()
                .from(table)
                .where(eq(table.id as never, id))
                .limit(1);
            return rows[0] ?? null;
        },
        async getWebhookEvent(providerName: string, providerEventId: string) {
            const table = options.schema.billingWebhookEvents as {
                provider: unknown;
                providerEventId: unknown;
            };
            const rows = await (db as Insertable)
                .select()
                .from(table)
                .where(
                    and(
                        eq(table.provider as never, providerName),
                        eq(table.providerEventId as never, providerEventId),
                    ),
                )
                .limit(1);
            return rows[0] ?? null;
        },
        async getSubscriptionProjection(providerName, providerSubscriptionId) {
            const table = options.schema.billingSubscriptions as {
                provider: unknown;
                providerSubscriptionId: unknown;
            };
            const rows = await (db as Insertable)
                .select()
                .from(table)
                .where(
                    and(
                        eq(table.provider as never, providerName),
                        eq(
                            table.providerSubscriptionId as never,
                            providerSubscriptionId,
                        ),
                    ),
                )
                .limit(1);
            return rows[0] ?? null;
        },
    };
    void sql;
    return adapter;
}

export { and, eq };
