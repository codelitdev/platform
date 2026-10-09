import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { CheckoutAttempt } from "../../core/checkout-attempt.js";
import type { Clock } from "../../core/clock.js";
import type { ProviderCustomer } from "../../core/customer.js";
import { BillingCompositionError } from "../../core/errors.js";
import type { PlanChangeAttempt } from "../../core/plan-change-attempt.js";
import type { ReconciliationJob } from "../../core/reconciliation-job.js";
import type { CanonicalSubscription } from "../../core/subscription.js";
import type { WebhookInboxRecord } from "../../core/webhook-inbox.js";
import type {
  BillingStore,
  BillingStoreHealth,
  CatalogRevisionItemRow,
  CatalogRevisionRow,
  MemoryCatalog,
  PlanStateRow,
  PriceEntryRow,
  ReconciliationSubject,
} from "../../persistence/store.js";
export type GeneratedBillingSchema = {
  billingPriceEntries: unknown;
  billingCatalogRevisions: unknown;
  billingCatalogRevisionItems: unknown;
  billingProviderCustomers: unknown;
  billingCheckoutAttempts: unknown;
  billingPlanChangeAttempts: unknown;
  billingSubscriptions: unknown;
  billingPlanStates: unknown;
  billingWebhookEvents: unknown;
  billingReconciliationJobs: unknown;
};

export type DrizzleDb = {
  select: (...args: never[]) => unknown;
  insert: (...args: never[]) => unknown;
  update: (...args: never[]) => unknown;
  transaction: <T>(fn: (tx: DrizzleDb) => Promise<T>) => Promise<T>;
};

type AnyRow = Record<string, unknown>;

type DrizzleQuery = PromiseLike<unknown[]> & {
  from(table: AnyRow): DrizzleQuery;
  where(condition: unknown): DrizzleQuery;
  for(strength: "update"): DrizzleQuery;
  limit(count: number): DrizzleQuery;
  values(values: AnyRow): DrizzleQuery;
  set(values: AnyRow): DrizzleQuery;
  returning(): Promise<unknown[]>;
};

type QueryDb = {
  select(): DrizzleQuery;
  insert(table: AnyRow): DrizzleQuery;
  update(table: AnyRow): DrizzleQuery;
};

export type DrizzleBillingStoreOptions = {
  schema: GeneratedBillingSchema;
  clock: Clock;
  planStateDefaults?: Record<string, unknown>;
  checkoutApplicationFields?: CheckoutApplicationFieldsCodec;
};

export type CheckoutApplicationFieldsCodec = {
  toColumns(fields: Record<string, unknown>): Record<string, unknown>;
  fromRow(row: Readonly<Record<string, unknown>>): Record<string, unknown>;
};

export type DrizzleBillingStore = BillingStore & {
  withTransaction<T>(
    fn: (() => Promise<T>) | ((tx: DrizzleDb) => Promise<T>),
  ): Promise<T>;
  /** Open Drizzle transaction when called inside `withTransaction`. */
  getTransaction(): DrizzleDb | undefined;
};

export function createDrizzleBillingStore(
  db: DrizzleDb,
  options: DrizzleBillingStoreOptions,
): DrizzleBillingStore {
  const schema = options.schema as Record<string, AnyRow>;
  const transactionContext = new AsyncLocalStorage<DrizzleDb>();

  function activeDb(): QueryDb {
    return (transactionContext.getStore() ?? db) as unknown as QueryDb;
  }

  function t<K extends string>(key: K) {
    return schema[key] as AnyRow;
  }

  async function one(table: AnyRow, where: unknown): Promise<AnyRow | undefined> {
    let query = activeDb().select().from(table).where(where);
    if (transactionContext.getStore()) query = query.for("update");
    const rows = (await query.limit(1)) as AnyRow[];
    return rows[0];
  }

  async function many(
    table: AnyRow,
    where?: unknown,
    limit?: number,
  ): Promise<AnyRow[]> {
    let q = activeDb().select().from(table);
    if (transactionContext.getStore()) q = q.for("update");
    if (where) q = q.where(where);
    if (limit !== undefined) q = q.limit(limit);
    return (await q) as AnyRow[];
  }

  function mapPrice(row: AnyRow): PriceEntryRow {
    return {
      id: String(row.id),
      offerKey: String(row.offerKey),
      plan: String(row.plan),
      interval: row.billingInterval as "month" | "year",
      currency: String(row.currency),
      amountMinor: Number(row.amountMinor),
      providerTrialDays: Number(row.providerTrialDays ?? 0),
      provider: String(row.provider),
      providerProductId: String(row.providerProductId),
      verifiedAt: (row.verifiedAt as Date | null) ?? null,
    };
  }

  function mapRevision(row: AnyRow): CatalogRevisionRow {
    return {
      id: String(row.id),
      revision: Number(row.revision),
      checkoutProvider: String(row.checkoutProvider),
      status: row.status as CatalogRevisionRow["status"],
      verifiedAt: (row.verifiedAt as Date | null) ?? null,
      activatedAt: (row.activatedAt as Date | null) ?? null,
      retiredAt: (row.retiredAt as Date | null) ?? null,
    };
  }

  function mapCustomer(row: AnyRow): ProviderCustomer {
    return {
      id: String(row.id),
      provider: String(row.provider),
      payerId: String(row.payerId),
      payerEmail: String(row.payerEmail ?? ""),
      providerCustomerId: (row.providerCustomerId as string | null) ?? null,
      idempotencyKey: String(row.idempotencyKey),
      status: row.status as ProviderCustomer["status"],
      lastError: (row.lastError as string | null) ?? null,
    };
  }

  function mapCheckout(row: AnyRow): CheckoutAttempt {
    return {
      id: String(row.id),
      attemptId: String(row.attemptId),
      billableEntityId: String(row.billableEntityId),
      payerId: String(row.payerId),
      payerEmail: String(row.payerEmail ?? ""),
      returnUrl: String(row.returnUrl ?? ""),
      provider: String(row.provider),
      catalogRevision: Number(row.catalogRevision),
      offerKey: String(row.offerKey),
      plan: String(row.requestedPlan ?? row.plan),
      interval: (row.requestedInterval ?? row.interval) as "month" | "year",
      priceEntryId: String(row.billingPriceEntryId ?? row.priceEntryId),
      quotedAmountMinor: Number(row.quotedAmountMinor),
      quotedCurrency: String(row.quotedCurrency),
      providerCustomerRowId: (row.billingCustomerId as string | null) ?? null,
      providerCheckoutSessionId:
        (row.providerCheckoutSessionId as string | null) ?? null,
      checkoutUrlEncrypted: (row.checkoutUrlEncrypted as string | null) ?? null,
      idempotencyKey: String(row.idempotencyKey),
      status: row.status as CheckoutAttempt["status"],
      expiresAt: row.expiresAt as Date,
      lastError: (row.lastError as string | null) ?? null,
      completedAt: (row.completedAt as Date | null) ?? null,
      applicationFields: options.checkoutApplicationFields?.fromRow(row) ?? undefined,
    };
  }

  function checkoutApplicationColumns(
    fields: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (!fields || Object.keys(fields).length === 0) return {};
    if (!options.checkoutApplicationFields) {
      throw new BillingCompositionError("checkout_application_fields_codec_required");
    }
    const encoded = options.checkoutApplicationFields.toColumns(fields);
    if (!encoded || typeof encoded !== "object" || Array.isArray(encoded)) {
      throw new BillingCompositionError("checkout_application_fields_codec_invalid");
    }
    return encoded;
  }

  function mapSubscription(row: AnyRow): CanonicalSubscription {
    return {
      id: String(row.id),
      billableEntityId: String(row.billableEntityId),
      payerId: String(row.payerId),
      provider: String(row.provider),
      providerCustomerId: String(row.billingCustomerId),
      providerSubscriptionId: String(row.providerSubscriptionId),
      providerProductId: String(row.providerProductId),
      catalogRevision: Number(row.catalogRevision),
      offerKey: String(row.offerKey),
      plan: String(row.plan),
      interval: row.billingInterval as "month" | "year",
      priceEntryId: String(row.billingPriceEntryId),
      status: row.status as CanonicalSubscription["status"],
      currentPeriodStartsAt: (row.currentPeriodStartsAt as Date | null) ?? null,
      currentPeriodEndsAt: (row.currentPeriodEndsAt as Date | null) ?? null,
      paidThroughAt: (row.paidThroughAt as Date | null) ?? null,
      trialEndsAt: (row.trialEndsAt as Date | null) ?? null,
      cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
      isEntitlementSource: Boolean(row.isEntitlementSource),
      originCheckoutAttemptId: (row.originCheckoutAttemptId as string | null) ?? null,
      providerOccurredAt: (row.providerOccurredAt as Date | null) ?? null,
      providerVersion: (row.providerVersion as string | null) ?? null,
      lastObservedAt: (row.lastObservedAt as Date | null) ?? null,
      lastReconciledAt: (row.lastReconciledAt as Date | null) ?? null,
    };
  }

  function mapPlanChange(row: AnyRow): PlanChangeAttempt {
    return {
      id: String(row.id),
      changeId: String(row.changeId),
      billableEntityId: String(row.billableEntityId),
      subscriptionId: String(row.subscriptionId),
      actorId: String(row.actorId),
      payerId: String(row.payerId),
      provider: String(row.provider),
      idempotencyKey: String(row.idempotencyKey),
      currentCatalogRevision: Number(row.currentCatalogRevision),
      currentPriceEntryId: String(row.currentBillingPriceEntryId),
      currentPlan: String(row.currentPlan),
      currentInterval: row.currentInterval as "month" | "year",
      targetCatalogRevision: Number(row.targetCatalogRevision),
      targetPriceEntryId: String(row.targetBillingPriceEntryId),
      targetPlan: String(row.targetPlan),
      targetInterval: row.targetInterval as "month" | "year",
      targetOfferKey: String(row.targetOfferKey),
      effectiveAt: row.effectiveAt as PlanChangeAttempt["effectiveAt"],
      prorationMode: row.prorationMode as PlanChangeAttempt["prorationMode"],
      status: row.status as PlanChangeAttempt["status"],
      lastError: (row.lastError as string | null) ?? null,
      providerPaymentId: (row.providerPaymentId as string | null) ?? null,
      paymentUrlEncrypted: (row.paymentUrlEncrypted as string | null) ?? null,
      completedAt: (row.completedAt as Date | null) ?? null,
    };
  }

  function mapWebhook(row: AnyRow): WebhookInboxRecord {
    const subscriptionId = (row.subscriptionId as string | null) ?? null;
    const checkoutAttemptId = (row.checkoutAttemptId as string | null) ?? null;
    return {
      id: String(row.id),
      provider: String(row.provider),
      providerEventId: String(row.providerEventId),
      eventType: String(row.eventType),
      occurredAt: row.occurredAt as Date,
      subscriptionId,
      checkoutAttemptId,
      payloadEncrypted: (row.payloadEncrypted as string | null) ?? null,
      payloadKeyVersion: (row.payloadKeyVersion as string | null) ?? null,
      verifiedKeyVersion: (row.verifiedKeyVersion as string | null) ?? null,
      status: row.status as WebhookInboxRecord["status"],
      processingAttempts: Number(row.processingAttempts ?? 0),
      lastError: (row.lastError as string | null) ?? null,
      availableAt: row.availableAt as Date,
      lockedAt: (row.lockedAt as Date | null) ?? null,
      leaseExpiresAt: (row.leaseExpiresAt as Date | null) ?? null,
      workerId: (row.workerId as string | null) ?? null,
      processedAt: (row.processedAt as Date | null) ?? null,
    };
  }

  function mapJob(row: AnyRow): ReconciliationJob {
    return {
      id: String(row.id),
      provider: String(row.provider),
      checkoutAttemptId: (row.checkoutAttemptId as string | null) ?? null,
      planChangeAttemptId: (row.planChangeAttemptId as string | null) ?? null,
      subscriptionId: (row.subscriptionId as string | null) ?? null,
      providerCustomerId: (row.providerCustomerId as string | null) ?? null,
      operation: row.operation as ReconciliationJob["operation"],
      status: row.status as ReconciliationJob["status"],
      attemptCount: Number(row.attemptCount ?? 0),
      availableAt: row.availableAt as Date,
      lockedAt: (row.lockedAt as Date | null) ?? null,
      leaseExpiresAt: (row.leaseExpiresAt as Date | null) ?? null,
      workerId: (row.workerId as string | null) ?? null,
      lastError: (row.lastError as string | null) ?? null,
    };
  }

  const store: DrizzleBillingStore = {
    transactionDepth: 0,
    isInTransaction() {
      return transactionContext.getStore() !== undefined;
    },
    getTransaction() {
      return transactionContext.getStore();
    },
    async withTransaction<T>(
      fn: (() => Promise<T>) | ((tx: DrizzleDb) => Promise<T>),
    ): Promise<T> {
      store.transactionDepth += 1;
      try {
        return await db.transaction((tx) =>
          transactionContext.run(tx, () =>
            fn.length > 0
              ? (fn as (tx: DrizzleDb) => Promise<T>)(tx)
              : (fn as () => Promise<T>)(),
          ),
        );
      } finally {
        store.transactionDepth -= 1;
      }
    },
    noteProviderCall() {
      if (transactionContext.getStore()) {
        throw new Error("transaction_open_across_provider_call");
      }
    },
    async getActiveCatalog(providerName): Promise<MemoryCatalog | null> {
      const revision = await one(
        t("billingCatalogRevisions"),
        and(
          eq(t("billingCatalogRevisions").checkoutProvider as never, providerName),
          eq(t("billingCatalogRevisions").status as never, "active"),
        ),
      );
      if (!revision) return null;
      const items = await many(
        t("billingCatalogRevisionItems"),
        eq(
          t("billingCatalogRevisionItems").catalogRevisionId as never,
          revision.id as never,
        ),
      );
      const prices = await many(t("billingPriceEntries"));
      return {
        revision: mapRevision(revision),
        items: items.map((item) => ({
          offerKey: String(item.offerKey),
          price: mapPrice(
            prices.find((price) => price.id === item.billingPriceEntryId)!,
          ),
        })),
      };
    },
    async getCatalogRevision(
      providerName,
      revisionNumber,
    ): Promise<MemoryCatalog | null> {
      const revision = await one(
        t("billingCatalogRevisions"),
        and(
          eq(t("billingCatalogRevisions").checkoutProvider as never, providerName),
          eq(t("billingCatalogRevisions").revision as never, revisionNumber),
        ),
      );
      if (!revision) return null;
      const items = await many(
        t("billingCatalogRevisionItems"),
        eq(
          t("billingCatalogRevisionItems").catalogRevisionId as never,
          revision.id as never,
        ),
      );
      const prices = await many(t("billingPriceEntries"));
      return {
        revision: mapRevision(revision),
        items: items.map((item) => {
          const price = prices.find(
            (candidate) => candidate.id === item.billingPriceEntryId,
          );
          if (!price) throw new Error("catalog_price_missing");
          return {
            offerKey: String(item.offerKey),
            price: mapPrice(price),
          };
        }),
      };
    },
    async insertCatalogRevision(revision) {
      await activeDb().insert(t("billingCatalogRevisions")).values({
        id: revision.id,
        revision: revision.revision,
        checkoutProvider: revision.checkoutProvider,
        status: revision.status,
        verifiedAt: revision.verifiedAt,
        activatedAt: revision.activatedAt,
        retiredAt: revision.retiredAt,
      });
    },
    async saveCatalogRevision(revision) {
      await activeDb()
        .update(t("billingCatalogRevisions"))
        .set({
          status: revision.status,
          verifiedAt: revision.verifiedAt,
          activatedAt: revision.activatedAt,
          retiredAt: revision.retiredAt,
          updatedAt: options.clock.now(),
        })
        .where(eq(t("billingCatalogRevisions").id as never, revision.id));
    },
    async insertPriceEntry(price) {
      await activeDb().insert(t("billingPriceEntries")).values({
        id: price.id,
        offerKey: price.offerKey,
        plan: price.plan,
        billingInterval: price.interval,
        currency: price.currency,
        amountMinor: price.amountMinor,
        providerTrialDays: price.providerTrialDays,
        provider: price.provider,
        providerProductId: price.providerProductId,
        verifiedAt: price.verifiedAt,
      });
    },
    async insertCatalogRevisionItem(item: CatalogRevisionItemRow) {
      await activeDb().insert(t("billingCatalogRevisionItems")).values({
        id: item.id,
        catalogRevisionId: item.revisionId,
        offerKey: item.offerKey,
        billingPriceEntryId: item.priceEntryId,
      });
    },
    async findPriceById(id) {
      const row = await one(
        t("billingPriceEntries"),
        eq(t("billingPriceEntries").id as never, id),
      );
      return row ? mapPrice(row) : undefined;
    },
    async findPriceByProviderProduct(providerName, productId) {
      const row = await one(
        t("billingPriceEntries"),
        and(
          eq(t("billingPriceEntries").provider as never, providerName),
          eq(t("billingPriceEntries").providerProductId as never, productId),
        ),
      );
      return row ? mapPrice(row) : undefined;
    },
    async listRevisions() {
      const rows = await many(t("billingCatalogRevisions"));
      return rows.map(mapRevision);
    },
    newAttemptId() {
      return `bca_${nanoid(12)}`;
    },
    newChangeId() {
      return `bpc_${nanoid(12)}`;
    },
    async ensurePlanState(billableEntityId) {
      const existing = await one(
        t("billingPlanStates"),
        eq(t("billingPlanStates").billableEntityId as never, billableEntityId),
      );
      if (existing) {
        return {
          billableEntityId,
          activeSubscriptionId:
            (existing.activeSubscriptionId as string | null) ?? null,
          projectionVersion: Number(existing.projectionVersion ?? 0),
        };
      }
      await activeDb()
        .insert(t("billingPlanStates"))
        .values({
          billableEntityId,
          activeSubscriptionId: null,
          projectionVersion: 0,
          ...(options.planStateDefaults ?? {}),
        });
      return {
        billableEntityId,
        activeSubscriptionId: null,
        projectionVersion: 0,
      };
    },
    async findPlanState(billableEntityId) {
      const existing = await one(
        t("billingPlanStates"),
        eq(t("billingPlanStates").billableEntityId as never, billableEntityId),
      );
      return existing
        ? {
            billableEntityId,
            activeSubscriptionId:
              (existing.activeSubscriptionId as string | null) ?? null,
            projectionVersion: Number(existing.projectionVersion ?? 0),
          }
        : undefined;
    },
    async savePlanState(state: PlanStateRow) {
      await activeDb()
        .update(t("billingPlanStates"))
        .set({
          activeSubscriptionId: state.activeSubscriptionId,
          projectionVersion: state.projectionVersion,
          updatedAt: options.clock.now(),
        })
        .where(
          eq(t("billingPlanStates").billableEntityId as never, state.billableEntityId),
        );
    },
    async findCustomerByPayer(providerName, payerId) {
      const row = await one(
        t("billingProviderCustomers"),
        and(
          eq(t("billingProviderCustomers").provider as never, providerName),
          eq(t("billingProviderCustomers").payerId as never, payerId),
        ),
      );
      return row ? mapCustomer(row) : undefined;
    },
    async findCustomerById(id) {
      const row = await one(
        t("billingProviderCustomers"),
        eq(t("billingProviderCustomers").id as never, id),
      );
      return row ? mapCustomer(row) : undefined;
    },
    async findCustomerByProviderCustomerId(providerName, providerCustomerId) {
      const row = await one(
        t("billingProviderCustomers"),
        and(
          eq(t("billingProviderCustomers").provider as never, providerName),
          eq(
            t("billingProviderCustomers").providerCustomerId as never,
            providerCustomerId,
          ),
        ),
      );
      return row ? mapCustomer(row) : undefined;
    },
    async listCustomersByPayer(payerId) {
      const rows = await many(
        t("billingProviderCustomers"),
        eq(t("billingProviderCustomers").payerId as never, payerId),
      );
      return rows.map(mapCustomer);
    },
    async insertCustomer(customer) {
      await activeDb().insert(t("billingProviderCustomers")).values({
        id: customer.id,
        provider: customer.provider,
        payerId: customer.payerId,
        payerEmail: customer.payerEmail,
        providerCustomerId: customer.providerCustomerId,
        idempotencyKey: customer.idempotencyKey,
        status: customer.status,
        lastError: customer.lastError,
      });
    },
    async saveCustomer(customer) {
      await activeDb()
        .update(t("billingProviderCustomers"))
        .set({
          providerCustomerId: customer.providerCustomerId,
          payerEmail: customer.payerEmail,
          status: customer.status,
          lastError: customer.lastError,
          updatedAt: options.clock.now(),
        })
        .where(eq(t("billingProviderCustomers").id as never, customer.id));
    },
    async findLiveCheckout(billableEntityId) {
      const row = await one(
        t("billingCheckoutAttempts"),
        and(
          eq(t("billingCheckoutAttempts").billableEntityId as never, billableEntityId),
          inArray(t("billingCheckoutAttempts").status as never, ["creating", "open"]),
        ),
      );
      return row ? mapCheckout(row) : undefined;
    },
    async findResumableCheckout(billableEntityId) {
      const rows = await many(
        t("billingCheckoutAttempts"),
        and(
          eq(t("billingCheckoutAttempts").billableEntityId as never, billableEntityId),
          inArray(t("billingCheckoutAttempts").status as never, [
            "creating",
            "open",
            "expired",
            "completed",
          ]),
        ),
      );
      const mapped = rows.map(mapCheckout);
      const rank = (status: string) =>
        status === "open" || status === "creating" ? 1 : 0;
      return mapped.sort((left, right) => rank(right.status) - rank(left.status))[0];
    },
    async findCheckoutById(id) {
      const row = await one(
        t("billingCheckoutAttempts"),
        eq(t("billingCheckoutAttempts").id as never, id),
      );
      return row ? mapCheckout(row) : undefined;
    },
    async findCheckoutByAttemptId(attemptId) {
      const row = await one(
        t("billingCheckoutAttempts"),
        eq(t("billingCheckoutAttempts").attemptId as never, attemptId),
      );
      return row ? mapCheckout(row) : undefined;
    },
    async findCheckoutByIdempotencyKey(idempotencyKey) {
      const row = await one(
        t("billingCheckoutAttempts"),
        eq(t("billingCheckoutAttempts").idempotencyKey as never, idempotencyKey),
      );
      return row ? mapCheckout(row) : undefined;
    },
    async insertCheckout(attempt) {
      await activeDb()
        .insert(t("billingCheckoutAttempts"))
        .values({
          ...checkoutApplicationColumns(attempt.applicationFields),
          id: attempt.id,
          attemptId: attempt.attemptId,
          billableEntityId: attempt.billableEntityId,
          payerId: attempt.payerId,
          payerEmail: attempt.payerEmail,
          returnUrl: attempt.returnUrl,
          provider: attempt.provider,
          catalogRevision: attempt.catalogRevision,
          offerKey: attempt.offerKey,
          requestedPlan: attempt.plan,
          requestedInterval: attempt.interval,
          billingPriceEntryId: attempt.priceEntryId,
          quotedAmountMinor: attempt.quotedAmountMinor,
          quotedCurrency: attempt.quotedCurrency,
          billingCustomerId: attempt.providerCustomerRowId,
          providerCheckoutSessionId: attempt.providerCheckoutSessionId,
          checkoutUrlEncrypted: attempt.checkoutUrlEncrypted,
          idempotencyKey: attempt.idempotencyKey,
          status: attempt.status,
          expiresAt: attempt.expiresAt,
          lastError: attempt.lastError,
          completedAt: attempt.completedAt,
        });
    },
    async saveCheckout(attempt) {
      await activeDb()
        .update(t("billingCheckoutAttempts"))
        .set({
          ...checkoutApplicationColumns(attempt.applicationFields),
          billingCustomerId: attempt.providerCustomerRowId,
          payerEmail: attempt.payerEmail,
          returnUrl: attempt.returnUrl,
          providerCheckoutSessionId: attempt.providerCheckoutSessionId,
          checkoutUrlEncrypted: attempt.checkoutUrlEncrypted,
          status: attempt.status,
          lastError: attempt.lastError,
          expiresAt: attempt.expiresAt,
          completedAt: attempt.completedAt,
          updatedAt: options.clock.now(),
        })
        .where(eq(t("billingCheckoutAttempts").id as never, attempt.id));
    },
    async countCreatingCheckouts() {
      const rows = await many(
        t("billingCheckoutAttempts"),
        eq(t("billingCheckoutAttempts").status as never, "creating"),
      );
      return rows.length;
    },
    async listExpiredCheckouts(now, limit) {
      const rows = await many(
        t("billingCheckoutAttempts"),
        and(
          inArray(t("billingCheckoutAttempts").status as never, ["creating", "open"]),
          lte(t("billingCheckoutAttempts").expiresAt as never, now),
        ),
        limit,
      );
      return rows.map(mapCheckout);
    },
    async listPurgeableCheckouts(before, limit) {
      const rows = await many(
        t("billingCheckoutAttempts"),
        and(
          inArray(t("billingCheckoutAttempts").status as never, [
            "completed",
            "expired",
            "abandoned",
            "conflicted",
          ]),
          isNotNull(t("billingCheckoutAttempts").checkoutUrlEncrypted as never),
          lte(t("billingCheckoutAttempts").completedAt as never, before),
        ),
        limit,
      );
      return rows.map(mapCheckout);
    },
    async findEntitlementSubscription(billableEntityId) {
      const row = await one(
        t("billingSubscriptions"),
        and(
          eq(t("billingSubscriptions").billableEntityId as never, billableEntityId),
          eq(t("billingSubscriptions").isEntitlementSource as never, true),
        ),
      );
      return row ? mapSubscription(row) : undefined;
    },
    async listSubscriptionsByEntity(billableEntityId) {
      const rows = await many(
        t("billingSubscriptions"),
        eq(t("billingSubscriptions").billableEntityId as never, billableEntityId),
      );
      return rows.map(mapSubscription);
    },
    async findSubscriptionById(id) {
      const row = await one(
        t("billingSubscriptions"),
        eq(t("billingSubscriptions").id as never, id),
      );
      return row ? mapSubscription(row) : undefined;
    },
    async findSubscriptionByProviderIds(providerName, providerSubscriptionId) {
      const row = await one(
        t("billingSubscriptions"),
        and(
          eq(t("billingSubscriptions").provider as never, providerName),
          eq(
            t("billingSubscriptions").providerSubscriptionId as never,
            providerSubscriptionId,
          ),
        ),
      );
      return row ? mapSubscription(row) : undefined;
    },
    async listSubscriptionsByPayer(payerId) {
      const rows = await many(
        t("billingSubscriptions"),
        eq(t("billingSubscriptions").payerId as never, payerId),
      );
      return rows.map(mapSubscription);
    },
    async upsertSubscription(subscription) {
      const existing = await store.findSubscriptionById(subscription.id);
      const values = {
        id: subscription.id,
        billableEntityId: subscription.billableEntityId,
        billingCustomerId: subscription.providerCustomerId,
        payerId: subscription.payerId,
        originCheckoutAttemptId: subscription.originCheckoutAttemptId,
        provider: subscription.provider,
        providerSubscriptionId: subscription.providerSubscriptionId,
        providerProductId: subscription.providerProductId,
        billingPriceEntryId: subscription.priceEntryId,
        catalogRevision: subscription.catalogRevision,
        offerKey: subscription.offerKey,
        plan: subscription.plan,
        billingInterval: subscription.interval,
        status: subscription.status,
        currentPeriodStartsAt: subscription.currentPeriodStartsAt,
        currentPeriodEndsAt: subscription.currentPeriodEndsAt,
        paidThroughAt: subscription.paidThroughAt,
        trialEndsAt: subscription.trialEndsAt,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        isEntitlementSource: subscription.isEntitlementSource,
        providerOccurredAt: subscription.providerOccurredAt,
        providerVersion: subscription.providerVersion,
        lastObservedAt: subscription.lastObservedAt,
        lastReconciledAt: subscription.lastReconciledAt,
        updatedAt: options.clock.now(),
      };
      if (existing) {
        await activeDb()
          .update(t("billingSubscriptions"))
          .set(values)
          .where(eq(t("billingSubscriptions").id as never, subscription.id));
      } else {
        await activeDb().insert(t("billingSubscriptions")).values(values);
      }
    },
    async listDueSubscriptionDeadlines(now, limit) {
      const rows = await many(
        t("billingSubscriptions"),
        and(
          eq(t("billingSubscriptions").isEntitlementSource as never, true),
          eq(t("billingSubscriptions").cancelAtPeriodEnd as never, true),
          lte(t("billingSubscriptions").paidThroughAt as never, now),
        ),
        limit,
      );
      return rows.map(mapSubscription);
    },
    async listUnreconciledSubscriptions(reconciledBefore, limit) {
      const subscriptions = t("billingSubscriptions");
      const rows = await many(
        subscriptions,
        and(
          or(
            inArray(subscriptions.status as never, [
              "pending",
              "trialing",
              "active",
              "past_due",
            ]),
            and(
              eq(subscriptions.status as never, "cancelled"),
              eq(subscriptions.isEntitlementSource as never, true),
            ),
          ),
          or(
            isNull(subscriptions.lastReconciledAt as never),
            lt(subscriptions.lastReconciledAt as never, reconciledBefore),
          ),
        ),
        limit,
      );
      return rows.map(mapSubscription);
    },
    async listStuckCreatingCheckouts(updatedBefore, now, limit) {
      const checkouts = t("billingCheckoutAttempts");
      const rows = await many(
        checkouts,
        and(
          eq(checkouts.status as never, "creating"),
          lte(checkouts.updatedAt as never, updatedBefore),
          gt(checkouts.expiresAt as never, now),
        ),
        limit,
      );
      return rows.map(mapCheckout);
    },
    async listStuckPlanChanges(updatedBefore, limit) {
      const changes = t("billingPlanChangeAttempts");
      const rows = await many(
        changes,
        and(
          or(
            eq(changes.status as never, "creating"),
            and(
              eq(changes.status as never, "pending"),
              isNotNull(changes.lastError as never),
            ),
          ),
          lte(changes.updatedAt as never, updatedBefore),
        ),
        limit,
      );
      return rows.map(mapPlanChange);
    },
    async runInTransaction<T>(transaction: unknown, fn: () => Promise<T>): Promise<T> {
      return transactionContext.run(transaction as DrizzleDb, fn);
    },
    async findLivePlanChange(billableEntityId) {
      const row = await one(
        t("billingPlanChangeAttempts"),
        and(
          eq(
            t("billingPlanChangeAttempts").billableEntityId as never,
            billableEntityId,
          ),
          inArray(t("billingPlanChangeAttempts").status as never, [
            "creating",
            "pending",
          ]),
        ),
      );
      return row ? mapPlanChange(row) : undefined;
    },
    async findPlanChangeBySubscriptionOffer(subscriptionId, offerKey) {
      const row = await one(
        t("billingPlanChangeAttempts"),
        and(
          eq(t("billingPlanChangeAttempts").subscriptionId as never, subscriptionId),
          eq(t("billingPlanChangeAttempts").targetOfferKey as never, offerKey),
          inArray(t("billingPlanChangeAttempts").status as never, [
            "creating",
            "pending",
          ]),
        ),
      );
      return row ? mapPlanChange(row) : undefined;
    },
    async findPlanChangeById(id) {
      const row = await one(
        t("billingPlanChangeAttempts"),
        eq(t("billingPlanChangeAttempts").id as never, id),
      );
      return row ? mapPlanChange(row) : undefined;
    },
    async insertPlanChange(attempt) {
      await activeDb()
        .insert(t("billingPlanChangeAttempts"))
        .values({
          id: attempt.id,
          changeId: attempt.changeId,
          billableEntityId: attempt.billableEntityId,
          subscriptionId: attempt.subscriptionId,
          actorId: attempt.actorId,
          payerId: attempt.payerId,
          provider: attempt.provider,
          idempotencyKey: attempt.idempotencyKey,
          currentCatalogRevision: attempt.currentCatalogRevision,
          currentBillingPriceEntryId: attempt.currentPriceEntryId,
          currentPlan: attempt.currentPlan,
          currentInterval: attempt.currentInterval,
          targetCatalogRevision: attempt.targetCatalogRevision,
          targetBillingPriceEntryId: attempt.targetPriceEntryId,
          targetPlan: attempt.targetPlan,
          targetInterval: attempt.targetInterval,
          targetOfferKey: attempt.targetOfferKey,
          effectiveAt: attempt.effectiveAt,
          prorationMode: attempt.prorationMode,
          providerPaymentId: attempt.providerPaymentId ?? null,
          paymentUrlEncrypted: attempt.paymentUrlEncrypted ?? null,
          status: attempt.status,
          lastError: attempt.lastError,
          completedAt: attempt.completedAt ?? null,
        });
    },
    async savePlanChange(attempt) {
      await activeDb()
        .update(t("billingPlanChangeAttempts"))
        .set({
          status: attempt.status,
          lastError: attempt.lastError,
          providerPaymentId: attempt.providerPaymentId ?? null,
          paymentUrlEncrypted: attempt.paymentUrlEncrypted ?? null,
          completedAt: attempt.completedAt ?? null,
          updatedAt: options.clock.now(),
        })
        .where(eq(t("billingPlanChangeAttempts").id as never, attempt.id));
    },
    async listPurgeablePlanChanges(before, limit) {
      const rows = await many(
        t("billingPlanChangeAttempts"),
        and(
          inArray(t("billingPlanChangeAttempts").status as never, [
            "succeeded",
            "failed",
            "conflicted",
          ]),
          isNotNull(t("billingPlanChangeAttempts").paymentUrlEncrypted as never),
          lte(t("billingPlanChangeAttempts").completedAt as never, before),
        ),
        limit,
      );
      return rows.map(mapPlanChange);
    },
    async findWebhook(providerName, providerEventId) {
      const row = await one(
        t("billingWebhookEvents"),
        and(
          eq(t("billingWebhookEvents").provider as never, providerName),
          eq(t("billingWebhookEvents").providerEventId as never, providerEventId),
        ),
      );
      return row ? mapWebhook(row) : undefined;
    },
    async findWebhookByEventId(providerEventId) {
      const row = await one(
        t("billingWebhookEvents"),
        eq(t("billingWebhookEvents").providerEventId as never, providerEventId),
      );
      return row ? mapWebhook(row) : undefined;
    },
    async insertWebhook(record) {
      await activeDb()
        .insert(t("billingWebhookEvents"))
        .values({
          id: record.id,
          provider: record.provider,
          providerEventId: record.providerEventId,
          eventType: record.eventType,
          occurredAt: record.occurredAt,
          subscriptionId: record.subscriptionId,
          checkoutAttemptId: record.checkoutAttemptId,
          payloadEncrypted: record.payloadEncrypted ?? null,
          payloadKeyVersion: record.payloadKeyVersion ?? null,
          verifiedKeyVersion: record.verifiedKeyVersion,
          status: record.status,
          processingAttempts: record.processingAttempts,
          lastError: record.lastError,
          availableAt: record.availableAt,
          lockedAt: record.lockedAt,
          leaseExpiresAt: record.leaseExpiresAt,
          workerId: record.workerId,
          processedAt: record.processedAt ?? null,
        });
    },
    async saveWebhook(record) {
      await activeDb()
        .update(t("billingWebhookEvents"))
        .set({
          status: record.status,
          processingAttempts: record.processingAttempts,
          lastError: record.lastError,
          availableAt: record.availableAt,
          lockedAt: record.lockedAt,
          leaseExpiresAt: record.leaseExpiresAt,
          workerId: record.workerId,
          processedAt: record.processedAt ?? null,
          subscriptionId: record.subscriptionId,
          checkoutAttemptId: record.checkoutAttemptId,
          payloadEncrypted: record.payloadEncrypted ?? null,
          payloadKeyVersion: record.payloadKeyVersion ?? null,
        })
        .where(eq(t("billingWebhookEvents").id as never, record.id));
    },
    async saveWebhookIfOwned(record, workerId) {
      const rows = (await activeDb()
        .update(t("billingWebhookEvents"))
        .set({
          status: record.status,
          processingAttempts: record.processingAttempts,
          lastError: record.lastError,
          availableAt: record.availableAt,
          lockedAt: record.lockedAt,
          leaseExpiresAt: record.leaseExpiresAt,
          workerId: record.workerId,
          processedAt: record.processedAt ?? null,
          subscriptionId: record.subscriptionId,
          checkoutAttemptId: record.checkoutAttemptId,
          payloadEncrypted: record.payloadEncrypted ?? null,
          payloadKeyVersion: record.payloadKeyVersion ?? null,
        })
        .where(
          and(
            eq(t("billingWebhookEvents").id as never, record.id),
            eq(t("billingWebhookEvents").workerId as never, workerId),
            eq(t("billingWebhookEvents").status as never, "processing"),
            eq(t("billingWebhookEvents").lockedAt as never, record.lockedAt),
          ),
        )
        .returning()) as AnyRow[];
      return rows.length > 0;
    },
    async listPurgeableWebhooks(before, limit) {
      const rows = await many(
        t("billingWebhookEvents"),
        and(
          inArray(t("billingWebhookEvents").status as never, ["processed", "ignored"]),
          isNotNull(t("billingWebhookEvents").payloadEncrypted as never),
          lte(t("billingWebhookEvents").processedAt as never, before),
        ),
        limit,
      );
      return rows.map(mapWebhook);
    },
    async listDueWebhooks(now, limit) {
      const rows = await many(t("billingWebhookEvents"));
      return rows
        .map(mapWebhook)
        .filter((row) => {
          if (
            row.status === "processed" ||
            row.status === "ignored" ||
            row.status === "quarantined"
          ) {
            return false;
          }
          if (
            row.status === "processing" &&
            row.leaseExpiresAt &&
            row.leaseExpiresAt > now
          ) {
            return false;
          }
          return row.availableAt <= now;
        })
        .slice(0, limit);
    },
    async claimDueWebhooks(now, limit, workerId) {
      const candidates = await store.listDueWebhooks(now, limit);
      if (candidates.length === 0) return [];
      return db.transaction(async (tx) => {
        const claimed: WebhookInboxRecord[] = [];
        const table = t("billingWebhookEvents");
        for (const candidate of candidates) {
          const rows = (await (tx as unknown as QueryDb)
            .update(table)
            .set({
              status: "processing",
              workerId,
              lockedAt: now,
              leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
              processingAttempts: candidate.processingAttempts + 1,
            })
            .where(
              and(
                eq(table.id as never, candidate.id),
                lte(table.availableAt as never, now),
                or(
                  inArray(table.status as never, ["pending", "failed"]),
                  and(
                    eq(table.status as never, "processing"),
                    or(
                      isNull(table.leaseExpiresAt as never),
                      lte(table.leaseExpiresAt as never, now),
                    ),
                  ),
                ),
              ),
            )
            .returning()) as AnyRow[];
          if (rows[0]) claimed.push(mapWebhook(rows[0]));
        }
        return claimed;
      });
    },
    async findLiveJob(subject: ReconciliationSubject) {
      if (
        !subject.checkoutAttemptId &&
        !subject.planChangeAttemptId &&
        !subject.subscriptionId &&
        !subject.providerCustomerId
      ) {
        return undefined;
      }
      const rows = await many(t("billingReconciliationJobs"));
      return rows.map(mapJob).find((job) => {
        if (job.status === "completed" || job.status === "quarantined") return false;
        if (job.provider !== subject.provider) return false;
        if (subject.checkoutAttemptId)
          return job.checkoutAttemptId === subject.checkoutAttemptId;
        if (subject.planChangeAttemptId)
          return job.planChangeAttemptId === subject.planChangeAttemptId;
        if (subject.subscriptionId)
          return job.subscriptionId === subject.subscriptionId;
        return job.providerCustomerId === subject.providerCustomerId;
      });
    },
    async insertJob(job) {
      await activeDb().insert(t("billingReconciliationJobs")).values(job);
    },
    async saveJob(job) {
      await activeDb()
        .update(t("billingReconciliationJobs"))
        .set({
          status: job.status,
          attemptCount: job.attemptCount,
          availableAt: job.availableAt,
          lockedAt: job.lockedAt,
          leaseExpiresAt: job.leaseExpiresAt,
          workerId: job.workerId,
          lastError: job.lastError,
          operation: job.operation ?? "reconcile",
          updatedAt: options.clock.now(),
        })
        .where(eq(t("billingReconciliationJobs").id as never, job.id));
    },
    async saveJobIfOwned(job, workerId) {
      const rows = (await activeDb()
        .update(t("billingReconciliationJobs"))
        .set({
          status: job.status,
          attemptCount: job.attemptCount,
          availableAt: job.availableAt,
          lockedAt: job.lockedAt,
          leaseExpiresAt: job.leaseExpiresAt,
          workerId: job.workerId,
          lastError: job.lastError,
          operation: job.operation ?? "reconcile",
          updatedAt: options.clock.now(),
        })
        .where(
          and(
            eq(t("billingReconciliationJobs").id as never, job.id),
            eq(t("billingReconciliationJobs").workerId as never, workerId),
            eq(t("billingReconciliationJobs").status as never, "processing"),
            eq(t("billingReconciliationJobs").lockedAt as never, job.lockedAt),
          ),
        )
        .returning()) as AnyRow[];
      return rows.length > 0;
    },
    async listClaimableJobs(now, limit) {
      const rows = await many(t("billingReconciliationJobs"));
      const claimed: ReconciliationJob[] = [];
      for (const job of rows.map(mapJob)) {
        if (claimed.length >= limit) break;
        const leaseExpired =
          job.status === "processing" &&
          (!job.leaseExpiresAt || job.leaseExpiresAt.getTime() <= now.getTime());
        const claimable =
          (job.status === "pending" || job.status === "failed" || leaseExpired) &&
          job.availableAt.getTime() <= now.getTime();
        if (claimable) claimed.push(job);
      }
      return claimed;
    },
    async claimClaimableJobs(now, limit, workerId) {
      const candidates = await store.listClaimableJobs(now, limit);
      if (candidates.length === 0) return [];
      return db.transaction(async (tx) => {
        const claimed: ReconciliationJob[] = [];
        const table = t("billingReconciliationJobs");
        for (const candidate of candidates) {
          const rows = (await (tx as unknown as QueryDb)
            .update(table)
            .set({
              status: "processing",
              workerId,
              lockedAt: now,
              leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
              attemptCount: candidate.attemptCount + 1,
            })
            .where(
              and(
                eq(table.id as never, candidate.id),
                lte(table.availableAt as never, now),
                or(
                  inArray(table.status as never, ["pending", "failed"]),
                  and(
                    eq(table.status as never, "processing"),
                    or(
                      isNull(table.leaseExpiresAt as never),
                      lte(table.leaseExpiresAt as never, now),
                    ),
                  ),
                ),
              ),
            )
            .returning()) as AnyRow[];
          if (rows[0]) claimed.push(mapJob(rows[0]));
        }
        return claimed;
      });
    },
    async health(_now, providerName?): Promise<BillingStoreHealth> {
      const webhooks = (await many(t("billingWebhookEvents"))).map(mapWebhook);
      const jobs = (await many(t("billingReconciliationJobs"))).map(mapJob);
      const checkouts = await many(t("billingCheckoutAttempts"));
      const customers = await many(t("billingProviderCustomers"));
      const subscriptions = (await many(t("billingSubscriptions"))).map(
        mapSubscription,
      );
      const pendingInbox = webhooks.filter(
        (row) => row.status === "pending" || row.status === "failed",
      );
      const oldest = pendingInbox
        .map((row) => row.occurredAt)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      const revisions = await store.listRevisions();
      const activeRevision = revisions.find(
        (row) =>
          row.status === "active" &&
          (providerName === undefined || row.checkoutProvider === providerName),
      );
      return {
        oldestPendingInboxOccurredAt: oldest ?? null,
        quarantinedWebhooks: webhooks.filter((row) => row.status === "quarantined")
          .length,
        quarantinedJobs: jobs.filter((row) => row.status === "quarantined").length,
        stuckCreatingCheckouts: checkouts.filter((row) => row.status === "creating")
          .length,
        stuckCreatingCustomers: customers.filter((row) => row.status === "creating")
          .length,
        unreconciledSubscriptions: subscriptions.filter((row) => !row.lastReconciledAt)
          .length,
        activeRevision: activeRevision?.revision ?? null,
      };
    },
  };
  return store;
}
