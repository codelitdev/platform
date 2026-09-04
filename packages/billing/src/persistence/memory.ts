import { randomUUID } from "node:crypto";
import { nanoid } from "nanoid";
import type { BillingOffer } from "../catalog/types.js";
import type { CheckoutAttempt } from "../core/checkout-attempt.js";
import type { ProviderCustomer } from "../core/customer.js";
import type { CanonicalSubscriptionStatus } from "../core/ids.js";
import type { PlanChangeAttempt } from "../core/plan-change-attempt.js";
import type { ReconciliationJob } from "../core/reconciliation-job.js";
import type { CanonicalSubscription } from "../core/subscription.js";
import type { WebhookInboxRecord } from "../core/webhook-inbox.js";
import type {
  BillingStore,
  BillingStoreHealth,
  CatalogRevisionItemRow,
  CatalogRevisionRow,
  MemoryCatalog,
  PlanStateRow,
  PriceEntryRow,
  ReconciliationSubject,
} from "./store.js";

export type {
  CatalogRevisionRow,
  MemoryCatalog,
  PlanStateRow,
  PriceEntryRow,
} from "./store.js";

export class MemoryBillingStore implements BillingStore {
  transactionDepth = 0;
  isInTransaction(): boolean {
    return this.transactionDepth > 0;
  }
  providerCallsWhileOpen = 0;
  priceEntries: PriceEntryRow[] = [];
  revisions: CatalogRevisionRow[] = [];
  revisionItems: CatalogRevisionItemRow[] = [];
  customers: ProviderCustomer[] = [];
  checkouts: CheckoutAttempt[] = [];
  planChanges: PlanChangeAttempt[] = [];
  subscriptions: CanonicalSubscription[] = [];
  planStates = new Map<string, PlanStateRow>();
  webhooks: WebhookInboxRecord[] = [];
  jobs: ReconciliationJob[] = [];
  auditEffects: string[] = [];
  transactionCount = 0;
  failOnTransaction = 0;
  private transactionBackup: {
    priceEntries: PriceEntryRow[];
    revisions: CatalogRevisionRow[];
    revisionItems: MemoryBillingStore["revisionItems"];
    customers: ProviderCustomer[];
    checkouts: CheckoutAttempt[];
    planChanges: PlanChangeAttempt[];
    subscriptions: CanonicalSubscription[];
    planStates: Array<[string, PlanStateRow]>;
    webhooks: WebhookInboxRecord[];
    jobs: ReconciliationJob[];
  } | null = null;
  private transactionTail: Promise<void> = Promise.resolve();

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const outermost = this.transactionDepth === 0;
    if (outermost) {
      this.transactionBackup = structuredClone({
        priceEntries: this.priceEntries,
        revisions: this.revisions,
        revisionItems: this.revisionItems,
        customers: this.customers,
        checkouts: this.checkouts,
        planChanges: this.planChanges,
        subscriptions: this.subscriptions,
        planStates: [...this.planStates.entries()],
        webhooks: this.webhooks,
        jobs: this.jobs,
      });
    }
    this.transactionDepth += 1;
    this.transactionCount += 1;
    try {
      if (this.failOnTransaction === this.transactionCount) {
        throw new Error("local_finalize_failed");
      }
      return await fn();
    } catch (error) {
      if (outermost && this.transactionBackup) {
        this.priceEntries = this.transactionBackup.priceEntries;
        this.revisions = this.transactionBackup.revisions;
        this.revisionItems = this.transactionBackup.revisionItems;
        this.customers = this.transactionBackup.customers;
        this.checkouts = this.transactionBackup.checkouts;
        this.planChanges = this.transactionBackup.planChanges;
        this.subscriptions = this.transactionBackup.subscriptions;
        this.planStates = new Map(this.transactionBackup.planStates);
        this.webhooks = this.transactionBackup.webhooks;
        this.jobs = this.transactionBackup.jobs;
      }
      throw error;
    } finally {
      this.transactionDepth -= 1;
      if (outermost) this.transactionBackup = null;
      release();
    }
  }

  noteProviderCall(): void {
    if (this.transactionDepth > 0) this.providerCallsWhileOpen += 1;
  }

  ensurePlanState(billableEntityId: string): PlanStateRow {
    const existing = this.planStates.get(billableEntityId);
    if (existing) return existing;
    const created = {
      billableEntityId,
      activeSubscriptionId: null,
      projectionVersion: 0,
    };
    this.planStates.set(billableEntityId, created);
    return created;
  }

  findPlanState(billableEntityId: string): PlanStateRow | undefined {
    return this.planStates.get(billableEntityId);
  }

  seedCatalog(input: {
    revision: number;
    provider: string;
    offers: BillingOffer[];
    status?: CatalogRevisionRow["status"];
  }): MemoryCatalog {
    const revision: CatalogRevisionRow = {
      id: randomUUID(),
      revision: input.revision,
      checkoutProvider: input.provider,
      status: input.status ?? "active",
      verifiedAt: input.status === "pending_verification" ? null : new Date(0),
      activatedAt: (input.status ?? "active") === "active" ? new Date(0) : null,
      retiredAt: input.status === "retired" ? new Date(0) : null,
    };
    this.revisions.push(revision);
    const items = input.offers.map((offer) => {
      const price: PriceEntryRow = {
        id: randomUUID(),
        offerKey: offer.key,
        plan: offer.plan,
        interval: offer.interval,
        currency: offer.currency,
        amountMinor: offer.amountMinor,
        providerTrialDays: offer.providerTrialDays,
        provider: offer.provider,
        providerProductId: offer.providerProductId,
        verifiedAt: new Date(0),
      };
      this.priceEntries.push(price);
      this.revisionItems.push({
        id: randomUUID(),
        revisionId: revision.id,
        offerKey: offer.key,
        priceEntryId: price.id,
      });
      return { offerKey: offer.key, price };
    });
    return { revision, items };
  }

  getActiveCatalog(provider: string): MemoryCatalog | null {
    const revision = this.revisions.find(
      (row) => row.checkoutProvider === provider && row.status === "active",
    );
    if (!revision) return null;
    const items = this.revisionItems
      .filter((item) => item.revisionId === revision.id)
      .map((item) => ({
        offerKey: item.offerKey,
        price: this.priceEntries.find((price) => price.id === item.priceEntryId)!,
      }));
    return { revision, items };
  }

  getCatalogRevision(provider: string, revisionNumber: number): MemoryCatalog | null {
    const revision = this.revisions.find(
      (row) => row.checkoutProvider === provider && row.revision === revisionNumber,
    );
    if (!revision) return null;
    const items = this.revisionItems
      .filter((item) => item.revisionId === revision.id)
      .map((item) => {
        const price = this.priceEntries.find(
          (candidate) => candidate.id === item.priceEntryId,
        );
        if (!price) throw new Error("catalog_price_missing");
        return { offerKey: item.offerKey, price };
      });
    return { revision, items };
  }

  insertCatalogRevision(revision: CatalogRevisionRow): void {
    if (
      this.revisions.some(
        (row) =>
          row.revision === revision.revision ||
          (row.checkoutProvider === revision.checkoutProvider &&
            row.status === "active" &&
            revision.status === "active"),
      )
    ) {
      throw new Error("catalog_revision_duplicate");
    }
    this.revisions.push(revision);
  }

  saveCatalogRevision(revision: CatalogRevisionRow): void {
    const existing = this.revisions.find((row) => row.id === revision.id);
    if (!existing) throw new Error("catalog_revision_missing");
    Object.assign(existing, revision);
  }

  insertPriceEntry(price: PriceEntryRow): void {
    if (
      this.priceEntries.some(
        (row) =>
          row.id === price.id ||
          (row.provider === price.provider &&
            row.providerProductId === price.providerProductId),
      )
    ) {
      throw new Error("catalog_price_duplicate");
    }
    this.priceEntries.push(price);
  }

  insertCatalogRevisionItem(item: CatalogRevisionItemRow): void {
    if (
      this.revisionItems.some(
        (row) =>
          row.id === item.id ||
          (row.revisionId === item.revisionId &&
            (row.offerKey === item.offerKey || row.priceEntryId === item.priceEntryId)),
      )
    ) {
      throw new Error("catalog_revision_item_duplicate");
    }
    this.revisionItems.push(item);
  }

  findPriceByProviderProduct(
    provider: string,
    productId: string,
  ): PriceEntryRow | undefined {
    return this.priceEntries.find(
      (row) => row.provider === provider && row.providerProductId === productId,
    );
  }

  findPriceById(id: string): PriceEntryRow | undefined {
    return this.priceEntries.find((row) => row.id === id);
  }

  listRevisions(): CatalogRevisionRow[] {
    return this.revisions;
  }

  newAttemptId(): string {
    return `bca_${nanoid(12)}`;
  }

  newChangeId(): string {
    return `bpc_${nanoid(12)}`;
  }

  savePlanState(state: PlanStateRow): void {
    this.planStates.set(state.billableEntityId, state);
  }

  findCustomerByPayer(provider: string, payerId: string) {
    return this.customers.find(
      (row) => row.provider === provider && row.payerId === payerId,
    );
  }

  findCustomerById(id: string) {
    return this.customers.find((row) => row.id === id);
  }

  findCustomerByProviderCustomerId(provider: string, providerCustomerId: string) {
    return this.customers.find(
      (row) =>
        row.provider === provider && row.providerCustomerId === providerCustomerId,
    );
  }

  listCustomersByPayer(payerId: string) {
    return this.customers.filter((row) => row.payerId === payerId);
  }

  insertCustomer(customer: ProviderCustomer): void {
    if (
      this.customers.some(
        (row) => row.provider === customer.provider && row.payerId === customer.payerId,
      ) ||
      this.customers.some((row) => row.idempotencyKey === customer.idempotencyKey)
    ) {
      throw new Error("customer_duplicate");
    }
    this.customers.push(customer);
  }

  saveCustomer(customer: ProviderCustomer): void {
    const existing = this.customers.find((row) => row.id === customer.id);
    if (existing) Object.assign(existing, customer);
    else this.customers.push(customer);
  }

  findLiveCheckout(billableEntityId: string) {
    return this.checkouts.find(
      (row) =>
        row.billableEntityId === billableEntityId &&
        (row.status === "creating" || row.status === "open"),
    );
  }

  findResumableCheckout(billableEntityId: string) {
    const rank = (status: string) => {
      if (status === "open" || status === "creating") return 2;
      if (status === "expired") return 1;
      return 0;
    };
    return this.checkouts
      .filter(
        (row) =>
          row.billableEntityId === billableEntityId &&
          (row.status === "creating" ||
            row.status === "open" ||
            row.status === "expired" ||
            row.status === "completed"),
      )
      .sort((left, right) => rank(right.status) - rank(left.status))[0];
  }

  findCheckoutById(id: string) {
    return this.checkouts.find((row) => row.id === id);
  }

  findCheckoutByAttemptId(attemptId: string) {
    return this.checkouts.find((row) => row.attemptId === attemptId);
  }

  findCheckoutByIdempotencyKey(idempotencyKey: string) {
    return this.checkouts.find((row) => row.idempotencyKey === idempotencyKey);
  }

  insertCheckout(attempt: CheckoutAttempt): void {
    if (
      this.checkouts.some((row) => row.idempotencyKey === attempt.idempotencyKey) ||
      this.checkouts.some(
        (row) =>
          row.billableEntityId === attempt.billableEntityId &&
          (row.status === "creating" || row.status === "open"),
      )
    ) {
      throw new Error("checkout_duplicate");
    }
    this.checkouts.push(attempt);
  }

  saveCheckout(attempt: CheckoutAttempt): void {
    const existing = this.checkouts.find((row) => row.id === attempt.id);
    if (existing) Object.assign(existing, attempt);
    else this.checkouts.push(attempt);
  }

  countCreatingCheckouts(): number {
    return this.checkouts.filter((row) => row.status === "creating").length;
  }

  listExpiredCheckouts(now: Date, limit: number): CheckoutAttempt[] {
    return this.checkouts
      .filter(
        (row) =>
          (row.status === "creating" || row.status === "open") &&
          row.expiresAt.getTime() <= now.getTime(),
      )
      .slice(0, limit);
  }

  listPurgeableCheckouts(before: Date, limit: number): CheckoutAttempt[] {
    return this.checkouts
      .filter(
        (row) =>
          row.checkoutUrlEncrypted !== null &&
          row.completedAt != null &&
          row.completedAt.getTime() <= before.getTime() &&
          row.status !== "creating" &&
          row.status !== "open",
      )
      .slice(0, limit);
  }

  findEntitlementSubscription(billableEntityId: string) {
    return this.subscriptions.find(
      (row) => row.billableEntityId === billableEntityId && row.isEntitlementSource,
    );
  }

  listSubscriptionsByEntity(billableEntityId: string) {
    return this.subscriptions.filter(
      (row) => row.billableEntityId === billableEntityId,
    );
  }

  findSubscriptionById(id: string) {
    return this.subscriptions.find((row) => row.id === id);
  }

  findSubscriptionByProviderIds(provider: string, providerSubscriptionId: string) {
    return this.subscriptions.find(
      (row) =>
        row.provider === provider &&
        row.providerSubscriptionId === providerSubscriptionId,
    );
  }

  listSubscriptionsByPayer(payerId: string) {
    return this.subscriptions.filter((row) => row.payerId === payerId);
  }

  upsertSubscription(subscription: CanonicalSubscription): void {
    if (
      subscription.isEntitlementSource &&
      this.subscriptions.some(
        (row) =>
          row.id !== subscription.id &&
          row.billableEntityId === subscription.billableEntityId &&
          row.isEntitlementSource,
      )
    ) {
      throw new Error("subscription_source_conflict");
    }
    const existing = this.subscriptions.find((row) => row.id === subscription.id);
    if (existing) Object.assign(existing, subscription);
    else this.subscriptions.push(subscription);
  }

  listDueSubscriptionDeadlines(now: Date, limit: number): CanonicalSubscription[] {
    return this.subscriptions
      .filter(
        (row) =>
          row.isEntitlementSource &&
          row.status === "cancelled" &&
          row.cancelAtPeriodEnd &&
          row.paidThroughAt !== null &&
          row.paidThroughAt.getTime() <= now.getTime(),
      )
      .slice(0, limit);
  }

  findLivePlanChange(billableEntityId: string) {
    return this.planChanges.find(
      (row) =>
        row.billableEntityId === billableEntityId &&
        (row.status === "creating" || row.status === "pending"),
    );
  }

  findPlanChangeBySubscriptionOffer(subscriptionId: string, offerKey: string) {
    return this.planChanges.find(
      (row) =>
        row.subscriptionId === subscriptionId &&
        (row.status === "pending" || row.status === "creating") &&
        row.targetOfferKey === offerKey,
    );
  }

  findPlanChangeById(id: string) {
    return this.planChanges.find((row) => row.id === id);
  }

  insertPlanChange(attempt: PlanChangeAttempt): void {
    if (
      this.planChanges.some((row) => row.idempotencyKey === attempt.idempotencyKey) ||
      this.planChanges.some(
        (row) =>
          row.billableEntityId === attempt.billableEntityId &&
          (row.status === "creating" || row.status === "pending"),
      )
    ) {
      throw new Error("plan_change_duplicate");
    }
    this.planChanges.push(attempt);
  }

  savePlanChange(attempt: PlanChangeAttempt): void {
    const existing = this.planChanges.find((row) => row.id === attempt.id);
    if (existing) Object.assign(existing, attempt);
    else this.planChanges.push(attempt);
  }

  listPurgeablePlanChanges(before: Date, limit: number): PlanChangeAttempt[] {
    return this.planChanges
      .filter(
        (row) =>
          row.paymentUrlEncrypted !== null &&
          row.completedAt != null &&
          row.completedAt.getTime() <= before.getTime() &&
          row.status !== "creating" &&
          row.status !== "pending",
      )
      .slice(0, limit);
  }

  findWebhook(provider: string, providerEventId: string) {
    return this.webhooks.find(
      (row) => row.provider === provider && row.providerEventId === providerEventId,
    );
  }

  findWebhookByEventId(providerEventId: string) {
    return this.webhooks.find((row) => row.providerEventId === providerEventId);
  }

  insertWebhook(record: WebhookInboxRecord): void {
    if (this.findWebhook(record.provider, record.providerEventId)) {
      throw new Error("webhook_duplicate");
    }
    this.webhooks.push(record);
  }

  saveWebhook(record: WebhookInboxRecord): void {
    const existing = this.webhooks.find((row) => row.id === record.id);
    if (existing) Object.assign(existing, record);
    else this.webhooks.push(record);
  }

  saveWebhookIfOwned(record: WebhookInboxRecord, workerId: string): boolean {
    const existing = this.webhooks.find((row) => row.id === record.id);
    if (
      existing?.status !== "processing" ||
      existing.workerId !== workerId ||
      !existing.lockedAt ||
      !record.lockedAt ||
      existing.lockedAt.getTime() !== record.lockedAt.getTime()
    ) {
      return false;
    }
    Object.assign(existing, record);
    return true;
  }

  listDueWebhooks(now: Date, limit: number) {
    return this.webhooks
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
  }

  claimDueWebhooks(now: Date, limit: number, workerId: string) {
    const claimed: WebhookInboxRecord[] = [];
    for (const row of this.listDueWebhooks(now, limit)) {
      if (claimed.length >= limit) break;
      const leaseExpired =
        row.status === "processing" &&
        (!row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= now.getTime());
      if (!(row.status === "pending" || row.status === "failed" || leaseExpired)) {
        continue;
      }
      row.status = "processing";
      row.workerId = workerId;
      row.lockedAt = now;
      row.leaseExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);
      row.processingAttempts += 1;
      claimed.push(structuredClone(row));
    }
    return claimed;
  }

  listPurgeableWebhooks(before: Date, limit: number): WebhookInboxRecord[] {
    return this.webhooks
      .filter(
        (row) =>
          row.payloadEncrypted != null &&
          row.processedAt != null &&
          row.processedAt.getTime() <= before.getTime() &&
          (row.status === "processed" || row.status === "ignored"),
      )
      .slice(0, limit);
  }

  findLiveJob(subject: ReconciliationSubject) {
    if (
      !subject.checkoutAttemptId &&
      !subject.planChangeAttemptId &&
      !subject.subscriptionId &&
      !subject.providerCustomerId
    ) {
      return undefined;
    }
    return this.jobs.find((job) => {
      if (job.status === "completed" || job.status === "quarantined") return false;
      if (job.provider !== subject.provider) return false;
      if (subject.checkoutAttemptId)
        return job.checkoutAttemptId === subject.checkoutAttemptId;
      if (subject.planChangeAttemptId)
        return job.planChangeAttemptId === subject.planChangeAttemptId;
      if (subject.subscriptionId) return job.subscriptionId === subject.subscriptionId;
      return job.providerCustomerId === subject.providerCustomerId;
    });
  }

  insertJob(job: ReconciliationJob): void {
    if (
      job.operation !== undefined &&
      job.operation !== "reconcile" &&
      job.operation !== "cancellation"
    ) {
      throw new Error("job_operation_invalid");
    }
    if (job.operation === "cancellation" && !job.subscriptionId) {
      throw new Error("job_operation_subject_invalid");
    }
    const subjectCount = [
      job.checkoutAttemptId,
      job.planChangeAttemptId,
      job.subscriptionId,
      job.providerCustomerId,
    ].filter(Boolean).length;
    if (subjectCount !== 1) throw new Error("job_subject_invalid");
    if (this.findLiveJob(job)) throw new Error("job_duplicate");
    this.jobs.push(job);
  }

  saveJob(job: ReconciliationJob): void {
    if (
      job.operation !== undefined &&
      job.operation !== "reconcile" &&
      job.operation !== "cancellation"
    ) {
      throw new Error("job_operation_invalid");
    }
    if (job.operation === "cancellation" && !job.subscriptionId) {
      throw new Error("job_operation_subject_invalid");
    }
    const existing = this.jobs.find((row) => row.id === job.id);
    if (existing) Object.assign(existing, job);
    else this.jobs.push(job);
  }

  saveJobIfOwned(job: ReconciliationJob, workerId: string): boolean {
    if (
      job.operation !== undefined &&
      job.operation !== "reconcile" &&
      job.operation !== "cancellation"
    ) {
      throw new Error("job_operation_invalid");
    }
    if (job.operation === "cancellation" && !job.subscriptionId) {
      throw new Error("job_operation_subject_invalid");
    }
    const existing = this.jobs.find((row) => row.id === job.id);
    if (
      existing?.status !== "processing" ||
      existing.workerId !== workerId ||
      !existing.lockedAt ||
      !job.lockedAt ||
      existing.lockedAt.getTime() !== job.lockedAt.getTime()
    ) {
      return false;
    }
    Object.assign(existing, job);
    return true;
  }

  listClaimableJobs(now: Date, limit: number) {
    const claimed: ReconciliationJob[] = [];
    for (const job of this.jobs) {
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
  }

  claimClaimableJobs(now: Date, limit: number, workerId: string) {
    const claimed: ReconciliationJob[] = [];
    for (const job of this.listClaimableJobs(now, limit)) {
      if (claimed.length >= limit) break;
      const leaseExpired =
        job.status === "processing" &&
        (!job.leaseExpiresAt || job.leaseExpiresAt.getTime() <= now.getTime());
      if (!(job.status === "pending" || job.status === "failed" || leaseExpired)) {
        continue;
      }
      job.status = "processing";
      job.workerId = workerId;
      job.lockedAt = now;
      job.leaseExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);
      job.attemptCount += 1;
      claimed.push(structuredClone(job));
    }
    return claimed;
  }

  health(_now: Date, provider?: string): BillingStoreHealth {
    const pendingInbox = this.webhooks.filter(
      (row) => row.status === "pending" || row.status === "failed",
    );
    const oldest = pendingInbox
      .map((row) => row.occurredAt)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const active = this.revisions.find(
      (row) =>
        row.status === "active" &&
        (provider === undefined || row.checkoutProvider === provider),
    );
    return {
      oldestPendingInboxOccurredAt: oldest ?? null,
      quarantinedWebhooks: this.webhooks.filter((row) => row.status === "quarantined")
        .length,
      quarantinedJobs: this.jobs.filter((row) => row.status === "quarantined").length,
      stuckCreatingCheckouts: this.checkouts.filter((row) => row.status === "creating")
        .length,
      stuckCreatingCustomers: this.customers.filter((row) => row.status === "creating")
        .length,
      unreconciledSubscriptions: this.subscriptions.filter(
        (row) => !row.lastReconciledAt,
      ).length,
      activeRevision: active?.revision ?? null,
    };
  }
}

export function newId(): string {
  return randomUUID();
}

export type ProjectionWrite = {
  subscription: CanonicalSubscription;
  planState: PlanStateRow;
  material: boolean;
  effectId: string | null;
};

export function applySubscriptionProjection(
  store: BillingStore,
  next: CanonicalSubscription,
  now: Date,
  options: { reconcile?: boolean } = {},
): ProjectionWrite | Promise<ProjectionWrite> {
  return Promise.resolve(applySubscriptionProjectionSync(store, next, now, options));
}

async function applySubscriptionProjectionSync(
  store: BillingStore,
  next: CanonicalSubscription,
  now: Date,
  options: { reconcile?: boolean } = {},
): Promise<ProjectionWrite> {
  const state = await store.ensurePlanState(next.billableEntityId);
  const existing = await store.findSubscriptionById(next.id);
  const previousMaterial = existing
    ? {
        status: existing.status as CanonicalSubscriptionStatus,
        providerProductId: existing.providerProductId,
        priceEntryId: existing.priceEntryId,
        catalogRevision: existing.catalogRevision,
        offerKey: existing.offerKey,
        plan: existing.plan,
        interval: existing.interval,
        currentPeriodStartsAt: existing.currentPeriodStartsAt,
        currentPeriodEndsAt: existing.currentPeriodEndsAt,
        paidThroughAt: existing.paidThroughAt,
        trialEndsAt: existing.trialEndsAt,
        cancelAtPeriodEnd: existing.cancelAtPeriodEnd,
        activeSubscriptionId: state.activeSubscriptionId,
      }
    : null;
  const nextMaterial = {
    status: next.status,
    providerProductId: next.providerProductId,
    priceEntryId: next.priceEntryId,
    catalogRevision: next.catalogRevision,
    offerKey: next.offerKey,
    plan: next.plan,
    interval: next.interval,
    currentPeriodStartsAt: next.currentPeriodStartsAt,
    currentPeriodEndsAt: next.currentPeriodEndsAt,
    paidThroughAt: next.paidThroughAt,
    trialEndsAt: next.trialEndsAt,
    cancelAtPeriodEnd: next.cancelAtPeriodEnd,
    activeSubscriptionId: next.isEntitlementSource
      ? next.id
      : state.activeSubscriptionId === next.id
        ? null
        : state.activeSubscriptionId,
  };
  const material =
    !previousMaterial ||
    JSON.stringify(serializeMaterial(previousMaterial)) !==
      JSON.stringify(serializeMaterial(nextMaterial));

  const freshness = {
    lastObservedAt: now,
    lastReconciledAt: options.reconcile ? now : (existing?.lastReconciledAt ?? null),
  };
  const merged: CanonicalSubscription = {
    ...(existing ?? next),
    ...next,
    lastObservedAt: freshness.lastObservedAt,
    lastReconciledAt: freshness.lastReconciledAt,
  };

  await store.upsertSubscription(merged);
  const stored = (await store.findSubscriptionById(merged.id)) ?? merged;

  if (material) {
    state.projectionVersion += 1;
    state.activeSubscriptionId = nextMaterial.activeSubscriptionId;
    await store.savePlanState(state);
    const effectId = `projection:${stored.id}:${state.projectionVersion}`;
    return {
      subscription: stored,
      planState: state,
      material: true,
      effectId,
    };
  }
  return {
    subscription: stored,
    planState: state,
    material: false,
    effectId: null,
  };
}

function serializeMaterial(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = item instanceof Date ? item.toISOString() : item;
  }
  return out;
}
