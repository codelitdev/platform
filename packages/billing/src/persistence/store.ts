import type { CheckoutAttempt } from "../core/checkout-attempt.js";
import type { ProviderCustomer } from "../core/customer.js";
import type { PlanChangeAttempt } from "../core/plan-change-attempt.js";
import type { ReconciliationJob } from "../core/reconciliation-job.js";
import type { CanonicalSubscription } from "../core/subscription.js";
import type { WebhookInboxRecord } from "../core/webhook-inbox.js";

export type PlanStateRow = {
    billableEntityId: string;
    activeSubscriptionId: string | null;
    projectionVersion: number;
};

export type PriceEntryRow = {
    id: string;
    offerKey: string;
    plan: string;
    interval: "month" | "year";
    currency: string;
    amountMinor: number;
    providerTrialDays: number;
    provider: string;
    providerProductId: string;
    verifiedAt: Date | null;
};

export type CatalogRevisionRow = {
    id: string;
    revision: number;
    checkoutProvider: string;
    status:
        "pending_verification" | "active" | "retired" | "invalid" | "abandoned";
    verifiedAt: Date | null;
    activatedAt: Date | null;
    retiredAt: Date | null;
};

export type CatalogRevisionItemRow = {
    id: string;
    revisionId: string;
    offerKey: string;
    priceEntryId: string;
};

export type MemoryCatalog = {
    revision: CatalogRevisionRow;
    items: Array<{ offerKey: string; price: PriceEntryRow }>;
};

export type ReconciliationSubject = {
    provider: string;
    checkoutAttemptId?: string | null;
    planChangeAttemptId?: string | null;
    subscriptionId?: string | null;
    providerCustomerId?: string | null;
    operation?: "reconcile" | "cancellation";
};

export type BillingStoreHealth = {
    oldestPendingInboxOccurredAt: Date | null;
    quarantinedWebhooks: number;
    quarantinedJobs: number;
    stuckCreatingCheckouts: number;
    stuckCreatingCustomers: number;
    unreconciledSubscriptions: number;
    activeRevision: number | null;
};

/** ORM-neutral canonical repositories. Workflows never import Drizzle. */
export interface BillingStore {
    transactionDepth: number;
    isInTransaction?(): boolean;
    withTransaction<T>(fn: () => Promise<T>): Promise<T>;
    noteProviderCall(): void;

    getActiveCatalog(
        provider: string,
    ): Promise<MemoryCatalog | null> | MemoryCatalog | null;
    getCatalogRevision(
        provider: string,
        revision: number,
    ): Promise<MemoryCatalog | null> | MemoryCatalog | null;
    insertCatalogRevision(revision: CatalogRevisionRow): Promise<void> | void;
    saveCatalogRevision(revision: CatalogRevisionRow): Promise<void> | void;
    insertPriceEntry(price: PriceEntryRow): Promise<void> | void;
    insertCatalogRevisionItem(
        item: CatalogRevisionItemRow,
    ): Promise<void> | void;
    findPriceById(
        id: string,
    ): Promise<PriceEntryRow | undefined> | PriceEntryRow | undefined;
    findPriceByProviderProduct(
        provider: string,
        productId: string,
    ): Promise<PriceEntryRow | undefined> | PriceEntryRow | undefined;
    listRevisions(): Promise<CatalogRevisionRow[]> | CatalogRevisionRow[];

    newAttemptId(): string;
    newChangeId(): string;

    ensurePlanState(
        billableEntityId: string,
    ): Promise<PlanStateRow> | PlanStateRow;
    findPlanState(
        billableEntityId: string,
    ): Promise<PlanStateRow | undefined> | PlanStateRow | undefined;
    savePlanState(state: PlanStateRow): Promise<void> | void;

    findCustomerByPayer(
        provider: string,
        payerId: string,
    ): Promise<ProviderCustomer | undefined> | ProviderCustomer | undefined;
    findCustomerById(
        id: string,
    ): Promise<ProviderCustomer | undefined> | ProviderCustomer | undefined;
    findCustomerByProviderCustomerId(
        provider: string,
        providerCustomerId: string,
    ): Promise<ProviderCustomer | undefined> | ProviderCustomer | undefined;
    listCustomersByPayer(
        payerId: string,
    ): Promise<ProviderCustomer[]> | ProviderCustomer[];
    insertCustomer(customer: ProviderCustomer): Promise<void> | void;
    saveCustomer(customer: ProviderCustomer): Promise<void> | void;

    findLiveCheckout(
        billableEntityId: string,
    ): Promise<CheckoutAttempt | undefined> | CheckoutAttempt | undefined;
    findResumableCheckout(
        billableEntityId: string,
    ): Promise<CheckoutAttempt | undefined> | CheckoutAttempt | undefined;
    findCheckoutById(
        id: string,
    ): Promise<CheckoutAttempt | undefined> | CheckoutAttempt | undefined;
    findCheckoutByAttemptId(
        attemptId: string,
    ): Promise<CheckoutAttempt | undefined> | CheckoutAttempt | undefined;
    findCheckoutByIdempotencyKey(
        idempotencyKey: string,
    ): Promise<CheckoutAttempt | undefined> | CheckoutAttempt | undefined;
    insertCheckout(attempt: CheckoutAttempt): Promise<void> | void;
    saveCheckout(attempt: CheckoutAttempt): Promise<void> | void;
    countCreatingCheckouts(): Promise<number> | number;
    listExpiredCheckouts(
        now: Date,
        limit: number,
    ): Promise<CheckoutAttempt[]> | CheckoutAttempt[];
    listPurgeableCheckouts(
        before: Date,
        limit: number,
    ): Promise<CheckoutAttempt[]> | CheckoutAttempt[];

    findEntitlementSubscription(
        billableEntityId: string,
    ):
        | Promise<CanonicalSubscription | undefined>
        | CanonicalSubscription
        | undefined;
    listSubscriptionsByEntity(
        billableEntityId: string,
    ): Promise<CanonicalSubscription[]> | CanonicalSubscription[];
    findSubscriptionById(
        id: string,
    ):
        | Promise<CanonicalSubscription | undefined>
        | CanonicalSubscription
        | undefined;
    findSubscriptionByProviderIds(
        provider: string,
        providerSubscriptionId: string,
    ):
        | Promise<CanonicalSubscription | undefined>
        | CanonicalSubscription
        | undefined;
    listSubscriptionsByPayer(
        payerId: string,
    ): Promise<CanonicalSubscription[]> | CanonicalSubscription[];
    upsertSubscription(
        subscription: CanonicalSubscription,
    ): Promise<void> | void;
    listDueSubscriptionDeadlines(
        now: Date,
        limit: number,
    ): Promise<CanonicalSubscription[]> | CanonicalSubscription[];

    findLivePlanChange(
        billableEntityId: string,
    ): Promise<PlanChangeAttempt | undefined> | PlanChangeAttempt | undefined;
    findPlanChangeBySubscriptionOffer(
        subscriptionId: string,
        offerKey: string,
    ): Promise<PlanChangeAttempt | undefined> | PlanChangeAttempt | undefined;
    findPlanChangeById(
        id: string,
    ): Promise<PlanChangeAttempt | undefined> | PlanChangeAttempt | undefined;
    insertPlanChange(attempt: PlanChangeAttempt): Promise<void> | void;
    savePlanChange(attempt: PlanChangeAttempt): Promise<void> | void;
    listPurgeablePlanChanges(
        before: Date,
        limit: number,
    ): Promise<PlanChangeAttempt[]> | PlanChangeAttempt[];

    findWebhook(
        provider: string,
        providerEventId: string,
    ): Promise<WebhookInboxRecord | undefined> | WebhookInboxRecord | undefined;
    findWebhookByEventId(
        providerEventId: string,
    ): Promise<WebhookInboxRecord | undefined> | WebhookInboxRecord | undefined;
    insertWebhook(record: WebhookInboxRecord): Promise<void> | void;
    saveWebhook(record: WebhookInboxRecord): Promise<void> | void;
    saveWebhookIfOwned(
        record: WebhookInboxRecord,
        workerId: string,
    ): Promise<boolean> | boolean;
    listDueWebhooks(
        now: Date,
        limit: number,
    ): Promise<WebhookInboxRecord[]> | WebhookInboxRecord[];
    claimDueWebhooks(
        now: Date,
        limit: number,
        workerId: string,
    ): Promise<WebhookInboxRecord[]> | WebhookInboxRecord[];
    listPurgeableWebhooks(
        before: Date,
        limit: number,
    ): Promise<WebhookInboxRecord[]> | WebhookInboxRecord[];

    findLiveJob(
        subject: ReconciliationSubject,
    ): Promise<ReconciliationJob | undefined> | ReconciliationJob | undefined;
    insertJob(job: ReconciliationJob): Promise<void> | void;
    saveJob(job: ReconciliationJob): Promise<void> | void;
    saveJobIfOwned(
        job: ReconciliationJob,
        workerId: string,
    ): Promise<boolean> | boolean;
    listClaimableJobs(
        now: Date,
        limit: number,
    ): Promise<ReconciliationJob[]> | ReconciliationJob[];
    claimClaimableJobs(
        now: Date,
        limit: number,
        workerId: string,
    ): Promise<ReconciliationJob[]> | ReconciliationJob[];

    health(
        now: Date,
        provider?: string,
    ): Promise<BillingStoreHealth> | BillingStoreHealth;
}
