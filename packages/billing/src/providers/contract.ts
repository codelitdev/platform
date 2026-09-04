import type { Clock } from "../core/clock.js";
import type {
    BillingInterval,
    CanonicalSubscriptionStatus,
} from "../core/ids.js";
import type {
    SubscriptionSnapshot,
    VerifiedWebhookEnvelope,
} from "../core/subscription.js";

export type BillingProductSnapshot = {
    provider: string;
    providerProductId: string;
    currency: string;
    amountMinor: number;
    interval: BillingInterval;
};

export type BillingCustomer = {
    provider: string;
    providerCustomerId: string;
};

export type Checkout = {
    provider: string;
    providerCheckoutSessionId: string;
    checkoutUrl: string;
};

export type PortalSession = {
    provider: string;
    portalUrl: string;
};

export type SubscriptionPlanChangeInput = {
    providerSubscriptionId: string;
    targetProviderProductId: string;
    effectiveAt: "immediately" | "next_billing_date";
    prorationMode: "prorated_immediately" | "do_not_bill";
    idempotencyKey: string;
};

export type SubscriptionPlanChangeResult = {
    provider: string;
    providerPaymentId: string | null;
    paymentUrl: string | null;
};

export type RawWebhookRequest = {
    body: string;
    headers: Record<string, string>;
};

export type MutationRecovery = "idempotency_key" | "lookup" | "unsupported";

export type ProviderCapabilities = {
    planChanges: boolean;
    intervalChanges: boolean;
    portalPlanChanges: boolean;
    portalIntervalChanges: boolean;
    proratedPlanChanges: boolean;
    mutationRecovery: {
        createCustomer: MutationRecovery;
        createCheckout: MutationRecovery;
        planChange: MutationRecovery;
        cancellation: MutationRecovery;
    };
};

export type CreateCustomerInput = {
    email: string;
    name?: string | null;
    idempotencyKey: string;
};

export type CreateCheckoutInput = {
    productId: string;
    currency: string;
    customerId: string;
    payerEmail: string;
    returnUrl: string;
    cancelUrl?: string;
    attemptId: string;
    catalogKey: string;
    trialDays: number;
    idempotencyKey: string;
};

export type CheckoutSessionSnapshot = {
    provider: string;
    providerCheckoutSessionId: string;
    paymentId: string | null;
    subscriptionId: string | null;
};

export interface BillingProviderAdapter {
    readonly provider: string;
    readonly capabilities: ProviderCapabilities;
    createCustomer(input: CreateCustomerInput): Promise<BillingCustomer>;
    createCheckout(input: CreateCheckoutInput): Promise<Checkout>;
    createPortalSession(input: {
        customerId: string;
        returnUrl: string;
    }): Promise<PortalSession>;
    changeSubscriptionPlan(
        input: SubscriptionPlanChangeInput,
    ): Promise<SubscriptionPlanChangeResult>;
    cancelSubscription(
        subscriptionId: string,
        idempotencyKey: string,
    ): Promise<void>;
    retrieveProduct(productId: string): Promise<BillingProductSnapshot>;
    retrieveSubscription(subscriptionId: string): Promise<SubscriptionSnapshot>;
    retrieveCheckoutSession(
        checkoutSessionId: string,
    ): Promise<CheckoutSessionSnapshot>;
    parseWebhook(input: RawWebhookRequest): Promise<VerifiedWebhookEnvelope>;
}

export type DodoBillingProviderOptions = {
    apiKey: string;
    environment: "test_mode" | "live_mode";
    webhookSecrets: Array<{
        version: string;
        secret: string;
        expiresAt?: Date | null;
    }>;
    requestTimeoutMs?: number;
    clock: Clock;
};

export type { CanonicalSubscriptionStatus };
