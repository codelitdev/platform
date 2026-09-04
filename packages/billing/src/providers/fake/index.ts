import { createHmac, timingSafeEqual } from "node:crypto";
import type { Clock } from "../../core/clock.js";
import { systemClock } from "../../core/clock.js";
import { BillingProviderError } from "../../core/errors.js";
import type {
    SubscriptionSnapshot,
    VerifiedWebhookEnvelope,
} from "../../core/subscription.js";
import type {
    BillingCustomer,
    BillingProductSnapshot,
    BillingProviderAdapter,
    Checkout,
    CheckoutSessionSnapshot,
    CreateCheckoutInput,
    CreateCustomerInput,
    PortalSession,
    ProviderCapabilities,
    RawWebhookRequest,
    SubscriptionPlanChangeInput,
    SubscriptionPlanChangeResult,
} from "../contract.js";

export const FAKE_BILLING_WEBHOOK_KEY = "whsec_fake_test_key";

type MutationName =
    "createCustomer" | "createCheckout" | "planChange" | "cancellation";

export type FakeProviderControls = {
    outage?: boolean;
    delayMs?: number;
    timeoutAfter?: Partial<Record<MutationName, boolean>>;
};

type StoredCheckout = Checkout & {
    productId: string;
    customerId: string;
    attemptId: string;
    catalogKey: string;
    trialDays: number;
    idempotencyKey: string;
};

const WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

function hmac(key: string, payload: string): string {
    return createHmac("sha256", key).update(payload, "utf8").digest("hex");
}

function equalHex(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

export class FakeBillingProvider implements BillingProviderAdapter {
    readonly provider = "fake";
    readonly capabilities: ProviderCapabilities = {
        planChanges: true,
        intervalChanges: true,
        portalPlanChanges: false,
        portalIntervalChanges: false,
        proratedPlanChanges: true,
        mutationRecovery: {
            createCustomer: "idempotency_key",
            createCheckout: "idempotency_key",
            planChange: "idempotency_key",
            cancellation: "idempotency_key",
        },
    };

    private readonly webhookKey: string;
    private readonly clock: Clock;
    private products = new Map<string, BillingProductSnapshot>();
    private customersByKey = new Map<string, BillingCustomer>();
    private customersById = new Map<string, BillingCustomer>();
    private checkoutsByKey = new Map<string, StoredCheckout>();
    private checkoutsById = new Map<string, StoredCheckout>();
    private planChangesByKey = new Map<string, SubscriptionPlanChangeResult>();
    private cancellationsByKey = new Map<string, string>();
    private subscriptions = new Map<string, SubscriptionSnapshot>();
    private nextId = 1;
    controls: FakeProviderControls = {};
    lastCreateCustomerInput: CreateCustomerInput | null = null;
    lastCreateCheckoutInput: CreateCheckoutInput | null = null;
    createCustomerCalls: CreateCustomerInput[] = [];
    createCheckoutCalls: CreateCheckoutInput[] = [];

    constructor(options: { webhookKey?: string; clock?: Clock } = {}) {
        this.webhookKey = options.webhookKey ?? FAKE_BILLING_WEBHOOK_KEY;
        this.clock = options.clock ?? systemClock;
    }

    seedProduct(product: BillingProductSnapshot): void {
        this.products.set(product.providerProductId, {
            ...product,
            provider: this.provider,
        });
    }

    seedDefaultCatalog(): void {
        const rows: Array<
            Pick<
                BillingProductSnapshot,
                "providerProductId" | "amountMinor" | "interval"
            >
        > = [
            {
                providerProductId: "pdt_pro_month",
                amountMinor: 4900,
                interval: "month",
            },
            {
                providerProductId: "pdt_pro_year",
                amountMinor: 49000,
                interval: "year",
            },
            {
                providerProductId: "pdt_business_month",
                amountMinor: 19900,
                interval: "month",
            },
            {
                providerProductId: "pdt_business_year",
                amountMinor: 199000,
                interval: "year",
            },
        ];
        for (const row of rows) {
            this.seedProduct({
                provider: this.provider,
                currency: "USD",
                ...row,
            });
        }
    }

    signWebhook(
        body: string,
        eventId = `evt_${this.nextId++}`,
        occurredAt = this.clock.now(),
    ) {
        const timestamp = String(Math.floor(occurredAt.getTime() / 1000));
        return {
            body,
            headers: {
                "webhook-id": eventId,
                "webhook-timestamp": timestamp,
                "webhook-signature": `v1,${hmac(this.webhookKey, `${eventId}.${timestamp}.${body}`)}`,
            },
        };
    }

    async simulatePayment(
        sessionId: string,
        occurredAt = this.clock.now(),
    ): Promise<SubscriptionSnapshot> {
        const checkout = this.checkoutsById.get(sessionId);
        if (!checkout) {
            throw new BillingProviderError("invalid", "checkout_not_found");
        }
        const existing = [...this.subscriptions.values()].find(
            (row) => row.metadata.checkoutAttemptId === checkout.attemptId,
        );
        if (existing) return existing;
        const periodEnd = new Date(
            occurredAt.getTime() + 30 * 24 * 60 * 60 * 1000,
        );
        const trialEndsAt =
            checkout.trialDays > 0
                ? new Date(
                      occurredAt.getTime() +
                          checkout.trialDays * 24 * 60 * 60 * 1000,
                  )
                : null;
        const snapshot: SubscriptionSnapshot = {
            provider: this.provider,
            providerCustomerId: checkout.customerId,
            providerSubscriptionId: `sub_${this.nextId++}`,
            providerProductId: checkout.productId,
            status:
                trialEndsAt && trialEndsAt > occurredAt ? "trialing" : "active",
            currentPeriodStartsAt: occurredAt,
            currentPeriodEndsAt: periodEnd,
            paidThroughAt: periodEnd,
            trialEndsAt,
            cancelAtPeriodEnd: false,
            providerOccurredAt: occurredAt,
            providerVersion: "1",
            observedAt: this.clock.now(),
            metadata: {
                checkoutAttemptId: checkout.attemptId,
                catalogKey: checkout.catalogKey,
            },
        };
        this.subscriptions.set(snapshot.providerSubscriptionId, snapshot);
        return snapshot;
    }

    async simulatePendingSubscription(
        sessionId: string,
        occurredAt = this.clock.now(),
    ): Promise<SubscriptionSnapshot> {
        const checkout = this.checkoutsById.get(sessionId);
        if (!checkout) {
            throw new BillingProviderError("invalid", "checkout_not_found");
        }
        const existing = [...this.subscriptions.values()].find(
            (row) => row.metadata.checkoutAttemptId === checkout.attemptId,
        );
        if (existing) return existing;
        const snapshot: SubscriptionSnapshot = {
            provider: this.provider,
            providerCustomerId: checkout.customerId,
            providerSubscriptionId: `sub_${this.nextId++}`,
            providerProductId: checkout.productId,
            status: "pending",
            currentPeriodStartsAt: occurredAt,
            currentPeriodEndsAt: occurredAt,
            paidThroughAt: occurredAt,
            trialEndsAt: null,
            cancelAtPeriodEnd: false,
            providerOccurredAt: occurredAt,
            providerVersion: "1",
            observedAt: this.clock.now(),
            metadata: {
                checkoutAttemptId: checkout.attemptId,
                catalogKey: checkout.catalogKey,
            },
        };
        this.subscriptions.set(snapshot.providerSubscriptionId, snapshot);
        return snapshot;
    }

    private async failIfControlled(mutation?: MutationName): Promise<void> {
        if (this.controls.delayMs) {
            await new Promise((resolve) =>
                setTimeout(resolve, this.controls.delayMs),
            );
        }
        if (this.controls.outage) {
            throw new BillingProviderError("unavailable", "outage");
        }
        if (mutation && this.controls.timeoutAfter?.[mutation]) {
            this.controls.timeoutAfter[mutation] = false;
            throw new BillingProviderError("unavailable", "timeout");
        }
    }

    async createCustomer(input: CreateCustomerInput): Promise<BillingCustomer> {
        this.lastCreateCustomerInput = input;
        this.createCustomerCalls.push(input);
        const existing = this.customersByKey.get(input.idempotencyKey);
        if (!existing) {
            const customer: BillingCustomer = {
                provider: this.provider,
                providerCustomerId: `cus_${this.nextId++}`,
            };
            this.customersByKey.set(input.idempotencyKey, customer);
            this.customersById.set(customer.providerCustomerId, customer);
        }
        await this.failIfControlled("createCustomer");
        return this.customersByKey.get(input.idempotencyKey)!;
    }

    async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
        this.lastCreateCheckoutInput = input;
        this.createCheckoutCalls.push(input);
        if (!this.customersById.has(input.customerId)) {
            throw new BillingProviderError("invalid", "customer_not_found");
        }
        if (!this.products.has(input.productId)) {
            throw new BillingProviderError("invalid", "product_not_found");
        }
        if (!this.checkoutsByKey.has(input.idempotencyKey)) {
            const sessionId = `cs_${this.nextId++}`;
            const stored: StoredCheckout = {
                provider: this.provider,
                providerCheckoutSessionId: sessionId,
                checkoutUrl: `https://billing.test/checkout/${sessionId}`,
                productId: input.productId,
                customerId: input.customerId,
                attemptId: input.attemptId,
                catalogKey: input.catalogKey,
                trialDays: input.trialDays,
                idempotencyKey: input.idempotencyKey,
            };
            this.checkoutsByKey.set(input.idempotencyKey, stored);
            this.checkoutsById.set(sessionId, stored);
        }
        await this.failIfControlled("createCheckout");
        const stored = this.checkoutsByKey.get(input.idempotencyKey)!;
        return {
            provider: stored.provider,
            providerCheckoutSessionId: stored.providerCheckoutSessionId,
            checkoutUrl: stored.checkoutUrl,
        };
    }

    async createPortalSession(input: {
        customerId: string;
        returnUrl: string;
    }): Promise<PortalSession> {
        await this.failIfControlled();
        if (!this.customersById.has(input.customerId)) {
            throw new BillingProviderError("invalid", "customer_not_found");
        }
        return {
            provider: this.provider,
            portalUrl: `https://billing.test/portal/${input.customerId}?return=${encodeURIComponent(input.returnUrl)}`,
        };
    }

    async changeSubscriptionPlan(
        input: SubscriptionPlanChangeInput,
    ): Promise<SubscriptionPlanChangeResult> {
        const current = this.subscriptions.get(input.providerSubscriptionId);
        if (!current) {
            throw new BillingProviderError("invalid", "subscription_not_found");
        }
        if (!this.products.has(input.targetProviderProductId)) {
            throw new BillingProviderError("invalid", "product_not_found");
        }
        if (!this.planChangesByKey.has(input.idempotencyKey)) {
            if (input.effectiveAt === "immediately") {
                this.subscriptions.set(input.providerSubscriptionId, {
                    ...current,
                    providerProductId: input.targetProviderProductId,
                    providerOccurredAt: this.clock.now(),
                    observedAt: this.clock.now(),
                    providerVersion: String(
                        Number(current.providerVersion ?? "0") + 1,
                    ),
                });
            }
            this.planChangesByKey.set(input.idempotencyKey, {
                provider: this.provider,
                providerPaymentId:
                    input.prorationMode === "prorated_immediately"
                        ? `pay_${this.nextId++}`
                        : null,
                paymentUrl: null,
            });
        }
        await this.failIfControlled("planChange");
        return this.planChangesByKey.get(input.idempotencyKey)!;
    }

    async retrieveProduct(id: string): Promise<BillingProductSnapshot> {
        await this.failIfControlled();
        const product = this.products.get(id);
        if (!product) {
            throw new BillingProviderError("invalid", "product_not_found");
        }
        return { ...product };
    }

    async retrieveSubscription(id: string): Promise<SubscriptionSnapshot> {
        await this.failIfControlled();
        const subscription = this.subscriptions.get(id);
        if (!subscription) {
            throw new BillingProviderError("invalid", "subscription_not_found");
        }
        return { ...subscription, observedAt: this.clock.now() };
    }

    async retrieveCheckoutSession(
        checkoutSessionId: string,
    ): Promise<CheckoutSessionSnapshot> {
        await this.failIfControlled();
        const checkout = this.checkoutsById.get(checkoutSessionId);
        if (!checkout) {
            throw new BillingProviderError("invalid", "checkout_not_found");
        }
        const subscription = [...this.subscriptions.values()].find(
            (row) => row.metadata.checkoutAttemptId === checkout.attemptId,
        );
        return {
            provider: this.provider,
            providerCheckoutSessionId: checkoutSessionId,
            paymentId: subscription ? `pay_${checkoutSessionId}` : null,
            subscriptionId: subscription?.providerSubscriptionId ?? null,
        };
    }

    async cancelSubscription(
        id: string,
        idempotencyKey: string,
    ): Promise<void> {
        const current = this.subscriptions.get(id);
        if (!current) {
            throw new BillingProviderError("invalid", "subscription_not_found");
        }
        if (!this.cancellationsByKey.has(idempotencyKey)) {
            this.subscriptions.set(id, {
                ...current,
                status: "cancelled",
                cancelAtPeriodEnd: false,
                providerOccurredAt: this.clock.now(),
                observedAt: this.clock.now(),
            });
            this.cancellationsByKey.set(idempotencyKey, id);
        }
        await this.failIfControlled("cancellation");
    }

    async parseWebhook(
        input: RawWebhookRequest,
    ): Promise<VerifiedWebhookEnvelope> {
        const eventId =
            input.headers["webhook-id"] ?? input.headers["Webhook-Id"];
        const timestamp =
            input.headers["webhook-timestamp"] ??
            input.headers["Webhook-Timestamp"];
        const signature =
            input.headers["webhook-signature"] ??
            input.headers["Webhook-Signature"];
        if (
            !eventId ||
            eventId.length > 256 ||
            /\s/.test(eventId) ||
            !timestamp ||
            !signature
        ) {
            throw new Error("webhook_signature_invalid");
        }
        const age = Math.abs(
            this.clock.now().getTime() / 1000 - Number(timestamp),
        );
        if (!Number.isFinite(age) || age > WEBHOOK_MAX_AGE_SECONDS) {
            throw new Error("webhook_timestamp_stale");
        }
        const expected = `v1,${hmac(this.webhookKey, `${eventId}.${timestamp}.${input.body}`)}`;
        if (!equalHex(signature, expected)) {
            throw new Error("webhook_signature_invalid");
        }
        let event: {
            type?: string;
            data?: {
                subscription_id?: string;
                metadata?: { checkoutAttemptId?: string; catalogKey?: string };
            };
        };
        try {
            event = JSON.parse(input.body) as typeof event;
        } catch {
            throw new Error("webhook_payload_invalid");
        }
        const boundedMetadata = (value: unknown): string | undefined =>
            typeof value === "string" &&
            value.length > 0 &&
            value.length <= 128 &&
            !/\s/.test(value)
                ? value
                : undefined;
        return {
            provider: this.provider,
            providerEventId: eventId,
            eventType: String(event.type ?? "unknown"),
            occurredAt: new Date(Number(timestamp) * 1000),
            subscriptionId: event.data?.subscription_id ?? null,
            verifiedKeyVersion: "v1",
            correlationMetadata: {
                checkoutAttemptId: boundedMetadata(
                    event.data?.metadata?.checkoutAttemptId,
                ),
                catalogKey: boundedMetadata(event.data?.metadata?.catalogKey),
            },
        };
    }
}
