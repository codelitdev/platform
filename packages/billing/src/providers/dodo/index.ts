import DodoPayments from "dodopayments";
import type { Clock } from "../../core/clock.js";
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
    DodoBillingProviderOptions,
    PortalSession,
    ProviderCapabilities,
    RawWebhookRequest,
    SubscriptionPlanChangeInput,
    SubscriptionPlanChangeResult,
} from "../contract.js";
import {
    dateOrNull,
    mapDodoHttpError,
    normalizeDodoSubscription,
} from "./normalize.js";

function providerError(error: unknown): BillingProviderError {
    const status = Number((error as { status?: number })?.status ?? 0);
    void error;
    return new BillingProviderError(
        mapDodoHttpError(status),
        "provider_request_failed",
    );
}

export function createDodoBillingProvider(
    options: DodoBillingProviderOptions,
): DodoBillingProvider {
    return new DodoBillingProvider(options);
}

export class DodoBillingProvider implements BillingProviderAdapter {
    readonly provider = "dodo";
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

    private readonly client: DodoPayments;
    private readonly webhookSecrets: DodoBillingProviderOptions["webhookSecrets"];
    private readonly clock: Clock;

    constructor(options: DodoBillingProviderOptions) {
        if (!options.apiKey?.trim()) {
            throw new BillingProviderError("misconfigured", "api_key_missing");
        }
        if (
            options.environment !== "test_mode" &&
            options.environment !== "live_mode"
        ) {
            throw new BillingProviderError(
                "misconfigured",
                "environment_invalid",
            );
        }
        if (
            !Array.isArray(options.webhookSecrets) ||
            options.webhookSecrets.length === 0 ||
            (options.requestTimeoutMs !== undefined &&
                (!Number.isSafeInteger(options.requestTimeoutMs) ||
                    options.requestTimeoutMs < 100 ||
                    options.requestTimeoutMs > 120_000))
        ) {
            throw new BillingProviderError(
                "misconfigured",
                "provider_options_invalid",
            );
        }
        const now = options.clock.now();
        if (
            options.webhookSecrets.some(
                (row) =>
                    !row ||
                    typeof row.version !== "string" ||
                    row.version.length === 0 ||
                    row.version.length > 128 ||
                    typeof row.secret !== "string" ||
                    row.secret.length === 0 ||
                    row.secret.length > 1024,
            )
        ) {
            throw new BillingProviderError(
                "misconfigured",
                "webhook_secrets_invalid",
            );
        }
        const versions = new Set(
            options.webhookSecrets.map((row) => row.version),
        );
        if (versions.size !== options.webhookSecrets.length) {
            throw new BillingProviderError(
                "misconfigured",
                "webhook_secret_versions_duplicate",
            );
        }
        const current = options.webhookSecrets.find(
            (row) =>
                row.secret &&
                row.version &&
                (!row.expiresAt || row.expiresAt.getTime() > now.getTime()),
        );
        if (!current?.secret) {
            throw new BillingProviderError(
                "misconfigured",
                "webhook_secret_missing",
            );
        }
        this.clock = options.clock;
        this.webhookSecrets = options.webhookSecrets;
        this.client = new DodoPayments({
            bearerToken: options.apiKey,
            environment: options.environment,
            timeout: options.requestTimeoutMs ?? 10_000,
            maxRetries: 0,
            webhookKey: current.secret,
        });
    }

    async createCustomer(input: CreateCustomerInput): Promise<BillingCustomer> {
        try {
            const customer = await this.client.customers.create(
                { email: input.email, name: input.name || input.email },
                { idempotencyKey: input.idempotencyKey },
            );
            return {
                provider: this.provider,
                providerCustomerId: customer.customer_id,
            };
        } catch (error) {
            if (error instanceof BillingProviderError) throw error;
            throw providerError(error);
        }
    }

    async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
        try {
            const response = await this.client.checkoutSessions.create(
                {
                    product_cart: [
                        { product_id: input.productId, quantity: 1 },
                    ],
                    customer: { customer_id: input.customerId },
                    billing_currency: input.currency as never,
                    return_url: input.returnUrl,
                    cancel_url: input.cancelUrl,
                    metadata: {
                        checkoutAttemptId: input.attemptId,
                        catalogKey: input.catalogKey,
                    },
                    subscription_data:
                        input.trialDays > 0
                            ? { trial_period_days: input.trialDays }
                            : undefined,
                },
                { idempotencyKey: input.idempotencyKey },
            );
            if (!response.checkout_url) {
                throw new BillingProviderError(
                    "invalid",
                    "provider_checkout_url_missing",
                );
            }
            return {
                provider: this.provider,
                providerCheckoutSessionId: response.session_id,
                checkoutUrl: response.checkout_url,
            };
        } catch (error) {
            if (error instanceof BillingProviderError) throw error;
            throw providerError(error);
        }
    }

    async createPortalSession(input: {
        customerId: string;
        returnUrl: string;
    }): Promise<PortalSession> {
        try {
            const response = await this.client.customers.customerPortal.create(
                input.customerId,
                { return_url: input.returnUrl, send_email: false },
            );
            return { provider: this.provider, portalUrl: response.link };
        } catch (error) {
            if (error instanceof BillingProviderError) throw error;
            throw providerError(error);
        }
    }

    async changeSubscriptionPlan(
        input: SubscriptionPlanChangeInput,
    ): Promise<SubscriptionPlanChangeResult> {
        try {
            const response = await this.client.subscriptions.changePlan(
                input.providerSubscriptionId,
                {
                    product_id: input.targetProviderProductId,
                    quantity: 1,
                    effective_at: input.effectiveAt,
                    proration_billing_mode: input.prorationMode,
                    on_payment_failure: "prevent_change",
                },
                { idempotencyKey: input.idempotencyKey },
            );
            return {
                provider: this.provider,
                providerPaymentId: response.payment_id ?? null,
                paymentUrl: response.payment_link ?? null,
            };
        } catch (error) {
            if (error instanceof BillingProviderError) throw error;
            throw providerError(error);
        }
    }

    private async withReadRetry<T>(fn: () => Promise<T>): Promise<T> {
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                const mapped = providerError(error);
                if (
                    mapped.code !== "unavailable" &&
                    mapped.code !== "rate_limited"
                ) {
                    throw mapped;
                }
                await new Promise((resolve) =>
                    setTimeout(resolve, 100 * 2 ** attempt),
                );
            }
        }
        throw providerError(lastError);
    }

    async retrieveProduct(id: string): Promise<BillingProductSnapshot> {
        try {
            const product = (await this.withReadRetry(() =>
                this.client.products.retrieve(id),
            )) as unknown as Record<string, unknown>;
            const price = product.price as Record<string, unknown> | undefined;
            if (!price || price.type !== "recurring_price") {
                throw new BillingProviderError(
                    "invalid",
                    "provider_product_not_recurring",
                );
            }
            const interval = String(
                price.payment_frequency_interval ??
                    price.subscription_period_interval,
            ).toLowerCase();
            if (interval !== "month" && interval !== "year") {
                throw new BillingProviderError(
                    "invalid",
                    "provider_product_interval_invalid",
                );
            }
            const amountMinor = Number(price.price);
            if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
                throw new BillingProviderError(
                    "invalid",
                    "provider_product_amount_invalid",
                );
            }
            return {
                provider: this.provider,
                providerProductId: String(product.product_id),
                currency: String(price.currency).toUpperCase(),
                amountMinor,
                interval,
            };
        } catch (error) {
            if (error instanceof BillingProviderError) throw error;
            throw providerError(error);
        }
    }

    async retrieveSubscription(id: string): Promise<SubscriptionSnapshot> {
        try {
            const subscription = (await this.withReadRetry(() =>
                this.client.subscriptions.retrieve(id),
            )) as unknown as Record<string, unknown>;
            const observedAt = this.clock.now();
            const providerOccurredAt = dateOrNull(
                subscription.updated_at ?? subscription.created_at,
            );
            return normalizeDodoSubscription(
                subscription,
                "subscription.updated",
                observedAt,
                providerOccurredAt,
            );
        } catch (error) {
            if (error instanceof BillingProviderError) throw error;
            throw providerError(error);
        }
    }

    async retrieveCheckoutSession(
        checkoutSessionId: string,
    ): Promise<CheckoutSessionSnapshot> {
        try {
            const session = await this.withReadRetry(() =>
                this.client.checkoutSessions.retrieve(checkoutSessionId),
            );
            let subscriptionId: string | null = null;
            if (session.payment_id) {
                const payment = await this.withReadRetry(() =>
                    this.client.payments.retrieve(session.payment_id!),
                );
                const id = payment.subscription_id;
                subscriptionId =
                    typeof id === "string" && id.length > 0 ? id : null;
            }
            return {
                provider: this.provider,
                providerCheckoutSessionId: session.id,
                paymentId: session.payment_id ?? null,
                subscriptionId,
            };
        } catch (error) {
            if (error instanceof BillingProviderError) throw error;
            throw providerError(error);
        }
    }

    async cancelSubscription(
        id: string,
        idempotencyKey: string,
    ): Promise<void> {
        try {
            await this.client.subscriptions.update(
                id,
                {
                    status: "cancelled",
                    cancel_at_next_billing_date: false,
                    cancel_reason: "cancelled_by_merchant",
                },
                { idempotencyKey },
            );
        } catch (error) {
            if (error instanceof BillingProviderError) throw error;
            throw providerError(error);
        }
    }

    async parseWebhook(
        input: RawWebhookRequest,
    ): Promise<VerifiedWebhookEnvelope> {
        const eventId =
            input.headers["webhook-id"] ?? input.headers["Webhook-Id"];
        if (!eventId || eventId.length > 256 || /\s/.test(eventId)) {
            throw new Error("webhook_id_invalid");
        }
        const now = this.clock.now();
        const timestampHeader =
            input.headers["webhook-timestamp"] ??
            input.headers["Webhook-Timestamp"];
        const timestamp = Number(timestampHeader);
        if (
            !timestampHeader ||
            !Number.isFinite(timestamp) ||
            Math.abs(now.getTime() / 1000 - timestamp) > 5 * 60
        ) {
            throw new Error("webhook_timestamp_stale");
        }
        let event: Record<string, unknown> | undefined;
        let verifiedVersion: string | undefined;
        for (const candidate of this.webhookSecrets) {
            if (
                candidate.expiresAt &&
                candidate.expiresAt.getTime() <= now.getTime()
            ) {
                continue;
            }
            try {
                event = this.client.webhooks.unwrap(input.body, {
                    headers: input.headers,
                    key: candidate.secret,
                }) as unknown as Record<string, unknown>;
                verifiedVersion = candidate.version;
                break;
            } catch {
                // try next rotation key
            }
        }
        if (!event || !verifiedVersion) {
            throw new Error("webhook_signature_invalid");
        }
        const occurredAt = dateOrNull(event.timestamp);
        if (!occurredAt) throw new Error("webhook_timestamp_missing");
        const data = (event.data ?? {}) as Record<string, unknown>;
        const isSubscription = String(event.type).startsWith("subscription.");
        const subscriptionId = isSubscription
            ? String(data.subscription_id ?? data.id ?? "") || null
            : null;
        const metadata = data.metadata as
            { checkoutAttemptId?: string; catalogKey?: string } | undefined;
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
            eventType: String(event.type),
            occurredAt,
            subscriptionId,
            verifiedKeyVersion: verifiedVersion,
            correlationMetadata: {
                checkoutAttemptId: boundedMetadata(metadata?.checkoutAttemptId),
                catalogKey: boundedMetadata(metadata?.catalogKey),
            },
        };
    }
}

export {
    normalizeDodoSubscription,
    mapDodoStatus,
    mapDodoHttpError,
} from "./normalize.js";
