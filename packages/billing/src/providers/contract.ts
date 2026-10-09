import type { Clock } from "../core/clock.js";
import type { BillingInterval, CanonicalSubscriptionStatus } from "../core/ids.js";
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
  /**
   * The provider picks the customer during checkout, so a new subscription can
   * name a customer other than the one the checkout was created for.
   */
  checkoutAssignsCustomer?: boolean;
  /**
   * A change to another billing interval starts a new period and bills at
   * once, so `do_not_bill` cannot be honoured across intervals.
   */
  intervalChangesBillImmediately?: boolean;
  /** Plan changes take effect at once; `next_billing_date` is not supported. */
  immediatePlanChangesOnly?: boolean;
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
  /** When the checkout attempt expires. Adapters that can, close the provider checkout then. */
  expiresAt?: Date;
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
  /**
   * Schedules cancellation at the end of the paid period. The subscription
   * keeps its status until then, and its snapshot reports
   * `cancelAtPeriodEnd: true`.
   */
  cancelSubscription(subscriptionId: string, idempotencyKey: string): Promise<void>;
  /** Clears a scheduled cancellation, so the subscription renews again. */
  resumeSubscription(subscriptionId: string, idempotencyKey: string): Promise<void>;
  retrieveProduct(productId: string): Promise<BillingProductSnapshot>;
  retrieveSubscription(subscriptionId: string): Promise<SubscriptionSnapshot>;
  retrieveCheckoutSession(checkoutSessionId: string): Promise<CheckoutSessionSnapshot>;
  parseWebhook(input: RawWebhookRequest): Promise<VerifiedWebhookEnvelope>;
}

export type LemonSqueezyBillingProviderOptions = {
  apiKey: string;
  /** The product's store. Webhooks and subscriptions from other stores are ignored or rejected. */
  storeId: string;
  /** Signing secrets of the store's webhook; older ones may stay during rotation. */
  webhookSecrets: Array<{
    version: string;
    secret: string;
    expiresAt?: Date | null;
  }>;
  requestTimeoutMs?: number;
  /** Default `https://api.lemonsqueezy.com/v1`. */
  apiBaseUrl?: string;
  /** Override for tests. */
  fetch?: typeof fetch;
  clock: Clock;
};

export type DodoBillingProviderOptions = {
  apiKey: string;
  environment: "test_mode" | "live_mode";
  webhookSecrets: Array<{
    version: string;
    secret: string;
    expiresAt?: Date | null;
  }>;
  requestTimeoutMs?: number;
  /**
   * The Dodo brand this product sells under. Dodo delivers every event of the
   * business to every webhook endpoint, so events whose `brand_id` names
   * another brand are recorded as ignored instead of being processed. Events
   * without a `brand_id` are processed as before.
   */
  brandId?: string;
  clock: Clock;
};

export type { CanonicalSubscriptionStatus };
