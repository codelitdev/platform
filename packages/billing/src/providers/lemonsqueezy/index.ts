import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
  LemonSqueezyBillingProviderOptions,
  PortalSession,
  ProviderCapabilities,
  RawWebhookRequest,
  SubscriptionPlanChangeInput,
  SubscriptionPlanChangeResult,
} from "../contract.js";
import {
  dateOrNull,
  mapLemonSqueezyHttpError,
  normalizeLemonSqueezySubscription,
} from "./normalize.js";

type Resource = {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
};

class LemonSqueezyHttpError extends Error {
  constructor(readonly status: number) {
    super(`lemonsqueezy_http_${status}`);
  }
}

function providerError(error: unknown): BillingProviderError {
  if (error instanceof BillingProviderError) return error;
  if (error instanceof LemonSqueezyHttpError) {
    return new BillingProviderError(
      mapLemonSqueezyHttpError(error.status),
      "provider_request_failed",
    );
  }
  return new BillingProviderError("unavailable", "provider_request_failed");
}

const OPAQUE = /^[^\s]{1,256}$/;

export function createLemonSqueezyBillingProvider(
  options: LemonSqueezyBillingProviderOptions,
): LemonSqueezyBillingProvider {
  return new LemonSqueezyBillingProvider(options);
}

/**
 * Lemon Squeezy adapter. Its API has no idempotency keys, so mutations are
 * made safe to retry by looking up current state (`lookup` recovery):
 * customers are reused by email, and cancel and resume set an absolute value.
 */
export class LemonSqueezyBillingProvider implements BillingProviderAdapter {
  readonly provider = "lemonsqueezy";
  readonly capabilities: ProviderCapabilities = {
    planChanges: true,
    intervalChanges: true,
    // The engine only accepts plan changes it started. Turn off plan changes
    // in the store's customer portal settings.
    portalPlanChanges: false,
    portalIntervalChanges: false,
    proratedPlanChanges: true,
    checkoutAssignsCustomer: true,
    // A variant on another interval restarts the billing period and bills it.
    intervalChangesBillImmediately: true,
    mutationRecovery: {
      createCustomer: "lookup",
      createCheckout: "lookup",
      planChange: "lookup",
      cancellation: "lookup",
    },
  };

  private readonly apiKey: string;
  private readonly storeId: string;
  private readonly webhookSecrets: LemonSqueezyBillingProviderOptions["webhookSecrets"];
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: Clock;
  private storeCurrency: string | undefined;

  constructor(options: LemonSqueezyBillingProviderOptions) {
    if (!options.apiKey?.trim()) {
      throw new BillingProviderError("misconfigured", "api_key_missing");
    }
    if (!options.storeId || !OPAQUE.test(options.storeId)) {
      throw new BillingProviderError("misconfigured", "store_id_invalid");
    }
    if (
      !Array.isArray(options.webhookSecrets) ||
      options.webhookSecrets.length === 0 ||
      options.webhookSecrets.some(
        (row) =>
          !row?.version ||
          row.version.length > 128 ||
          !row.secret ||
          row.secret.length > 1024,
      ) ||
      new Set(options.webhookSecrets.map((row) => row.version)).size !==
        options.webhookSecrets.length
    ) {
      throw new BillingProviderError("misconfigured", "webhook_secrets_invalid");
    }
    if (
      options.requestTimeoutMs !== undefined &&
      (!Number.isSafeInteger(options.requestTimeoutMs) ||
        options.requestTimeoutMs < 100 ||
        options.requestTimeoutMs > 120_000)
    ) {
      throw new BillingProviderError("misconfigured", "provider_options_invalid");
    }
    this.apiKey = options.apiKey;
    this.storeId = String(options.storeId);
    this.webhookSecrets = options.webhookSecrets;
    this.baseUrl = (options.apiBaseUrl ?? "https://api.lemonsqueezy.com/v1").replace(
      /\/$/,
      "",
    );
    this.timeoutMs = options.requestTimeoutMs ?? 10_000;
    this.fetchImpl = options.fetch ?? fetch;
    this.clock = options.clock;
  }

  private async request<T = { data: Resource }>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new LemonSqueezyHttpError(response.status);
    return (await response.json()) as T;
  }

  private async read<T = { data: Resource }>(path: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.request<T>("GET", path);
      } catch (error) {
        lastError = error;
        const mapped = providerError(error);
        if (mapped.code !== "unavailable" && mapped.code !== "rate_limited") {
          throw mapped;
        }
        await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
      }
    }
    throw providerError(lastError);
  }

  private storeRelationship() {
    return { store: { data: { type: "stores", id: this.storeId } } };
  }

  private assertStore(attributes: Record<string, unknown>): void {
    if (String(attributes.store_id) !== this.storeId) {
      throw new BillingProviderError("invalid", "provider_store_mismatch");
    }
  }

  async createCustomer(input: CreateCustomerInput): Promise<BillingCustomer> {
    try {
      // Reuse a customer with this email. Checkout can still create another
      // customer; see checkoutAssignsCustomer.
      const query = new URLSearchParams({
        "filter[store_id]": this.storeId,
        "filter[email]": input.email,
      });
      const existing = await this.read<{ data: Resource[] }>(`/customers?${query}`);
      const found = existing.data?.[0];
      if (found)
        return { provider: this.provider, providerCustomerId: String(found.id) };
      const created = await this.request("POST", "/customers", {
        data: {
          type: "customers",
          attributes: { name: input.name || input.email, email: input.email },
          relationships: this.storeRelationship(),
        },
      });
      return { provider: this.provider, providerCustomerId: String(created.data.id) };
    } catch (error) {
      throw providerError(error);
    }
  }

  async createCheckout(input: CreateCheckoutInput): Promise<Checkout> {
    if (input.trialDays > 0) {
      // Trials are configured on the Lemon Squeezy variant, not per checkout.
      throw new BillingProviderError("invalid", "provider_checkout_trial_unsupported");
    }
    if (!/^\d+$/.test(input.productId)) {
      throw new BillingProviderError("invalid", "provider_product_invalid");
    }
    try {
      const created = await this.request("POST", "/checkouts", {
        data: {
          type: "checkouts",
          attributes: {
            checkout_data: {
              email: input.payerEmail,
              custom: {
                checkoutAttemptId: input.attemptId,
                catalogKey: input.catalogKey,
              },
            },
            product_options: {
              redirect_url: input.returnUrl,
              // Only the chosen variant, so the buyer cannot switch plans here.
              enabled_variants: [Number(input.productId)],
            },
            // The checkout link stops working when the engine's attempt expires.
            expires_at: input.expiresAt
              ? input.expiresAt.toISOString().replace(/\.\d{3}Z$/, "Z")
              : null,
          },
          relationships: {
            ...this.storeRelationship(),
            variant: { data: { type: "variants", id: input.productId } },
          },
        },
      });
      const url = created.data.attributes.url;
      if (typeof url !== "string" || !url) {
        throw new BillingProviderError("invalid", "provider_checkout_url_missing");
      }
      return {
        provider: this.provider,
        providerCheckoutSessionId: String(created.data.id),
        checkoutUrl: url,
      };
    } catch (error) {
      throw providerError(error);
    }
  }

  async createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<PortalSession> {
    try {
      const customer = await this.read(
        `/customers/${encodeURIComponent(input.customerId)}`,
      );
      const urls = customer.data.attributes.urls as Record<string, unknown> | undefined;
      const portalUrl = urls?.customer_portal;
      if (typeof portalUrl !== "string" || !portalUrl) {
        throw new BillingProviderError("invalid", "provider_portal_url_missing");
      }
      return { provider: this.provider, portalUrl };
    } catch (error) {
      throw providerError(error);
    }
  }

  async changeSubscriptionPlan(
    input: SubscriptionPlanChangeInput,
  ): Promise<SubscriptionPlanChangeResult> {
    if (input.effectiveAt !== "immediately") {
      // Lemon Squeezy applies a variant change at once.
      throw new BillingProviderError(
        "invalid",
        "provider_scheduled_change_unsupported",
      );
    }
    try {
      await this.patchSubscription(input.providerSubscriptionId, {
        variant_id: Number(input.targetProviderProductId),
        invoice_immediately: input.prorationMode === "prorated_immediately",
        disable_prorations: input.prorationMode === "do_not_bill",
      });
      return { provider: this.provider, providerPaymentId: null, paymentUrl: null };
    } catch (error) {
      throw providerError(error);
    }
  }

  private async patchSubscription(id: string, attributes: Record<string, unknown>) {
    await this.request("PATCH", `/subscriptions/${encodeURIComponent(id)}`, {
      data: { type: "subscriptions", id: String(id), attributes },
    });
  }

  async cancelSubscription(id: string, _idempotencyKey: string): Promise<void> {
    try {
      // `cancelled: true` keeps the subscription until `ends_at`.
      await this.patchSubscription(id, { cancelled: true });
    } catch (error) {
      throw providerError(error);
    }
  }

  async resumeSubscription(id: string, _idempotencyKey: string): Promise<void> {
    try {
      await this.patchSubscription(id, { cancelled: false });
    } catch (error) {
      throw providerError(error);
    }
  }

  private async currency(): Promise<string> {
    if (this.storeCurrency) return this.storeCurrency;
    const store = await this.read(`/stores/${encodeURIComponent(this.storeId)}`);
    this.storeCurrency = String(store.data.attributes.currency ?? "").toUpperCase();
    return this.storeCurrency;
  }

  async retrieveProduct(id: string): Promise<BillingProductSnapshot> {
    try {
      const variant = await this.read(`/variants/${encodeURIComponent(id)}`);
      const attributes = variant.data.attributes;
      if (attributes.is_subscription !== true) {
        throw new BillingProviderError("invalid", "provider_product_not_recurring");
      }
      const interval = String(attributes.interval ?? "").toLowerCase();
      if (
        (interval !== "month" && interval !== "year") ||
        Number(attributes.interval_count) !== 1
      ) {
        throw new BillingProviderError("invalid", "provider_product_interval_invalid");
      }
      const amountMinor = Number(attributes.price);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw new BillingProviderError("invalid", "provider_product_amount_invalid");
      }
      return {
        provider: this.provider,
        providerProductId: String(variant.data.id),
        currency: await this.currency(),
        amountMinor,
        interval,
      };
    } catch (error) {
      throw providerError(error);
    }
  }

  async retrieveSubscription(id: string): Promise<SubscriptionSnapshot> {
    try {
      const subscription = await this.read(`/subscriptions/${encodeURIComponent(id)}`);
      this.assertStore(subscription.data.attributes);
      return normalizeLemonSqueezySubscription(
        String(subscription.data.id),
        subscription.data.attributes,
        this.clock.now(),
      );
    } catch (error) {
      throw providerError(error);
    }
  }

  async retrieveCheckoutSession(
    checkoutSessionId: string,
  ): Promise<CheckoutSessionSnapshot> {
    try {
      const checkout = await this.read(
        `/checkouts/${encodeURIComponent(checkoutSessionId)}`,
      );
      // A Lemon Squeezy checkout does not reference the order or subscription it
      // created; the subscription arrives through webhooks and reconciliation.
      return {
        provider: this.provider,
        providerCheckoutSessionId: String(checkout.data.id),
        paymentId: null,
        subscriptionId: null,
      };
    } catch (error) {
      throw providerError(error);
    }
  }

  async parseWebhook(input: RawWebhookRequest): Promise<VerifiedWebhookEnvelope> {
    const signature = input.headers["x-signature"] ?? input.headers["X-Signature"];
    if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) {
      throw new Error("webhook_signature_invalid");
    }
    const now = this.clock.now();
    const given = Buffer.from(signature, "hex");
    let verifiedVersion: string | undefined;
    for (const candidate of this.webhookSecrets) {
      if (candidate.expiresAt && candidate.expiresAt.getTime() <= now.getTime())
        continue;
      const expected = createHmac("sha256", candidate.secret)
        .update(input.body, "utf8")
        .digest();
      if (expected.length === given.length && timingSafeEqual(expected, given)) {
        verifiedVersion = candidate.version;
        break;
      }
    }
    if (!verifiedVersion) throw new Error("webhook_signature_invalid");

    let event: {
      meta?: { event_name?: unknown; custom_data?: Record<string, unknown> };
      data?: Resource;
    };
    try {
      event = JSON.parse(input.body);
    } catch {
      throw new Error("webhook_body_invalid");
    }
    const eventName = String(event.meta?.event_name ?? "");
    const data = event.data;
    if (!eventName || !data?.attributes) throw new Error("webhook_body_invalid");
    const attributes = data.attributes;
    const occurredAt = dateOrNull(attributes.updated_at ?? attributes.created_at);
    if (!occurredAt) throw new Error("webhook_timestamp_missing");

    const subscriptionId =
      data.type === "subscriptions"
        ? String(data.id)
        : data.type === "subscription-invoices" && attributes.subscription_id != null
          ? String(attributes.subscription_id)
          : null;
    const custom = event.meta?.custom_data ?? {};
    const bounded = (value: unknown): string | undefined =>
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 128 &&
      !/\s/.test(value)
        ? value
        : undefined;
    // Lemon Squeezy sends no event id; a retried delivery has the same body.
    const providerEventId = `ls_${createHash("sha256").update(input.body, "utf8").digest("hex")}`;
    const foreign = String(attributes.store_id) !== this.storeId;
    return {
      provider: this.provider,
      providerEventId,
      eventType: eventName,
      occurredAt,
      subscriptionId,
      verifiedKeyVersion: verifiedVersion,
      correlationMetadata: {
        checkoutAttemptId: bounded(custom.checkoutAttemptId),
        catalogKey: bounded(custom.catalogKey),
      },
      ...(foreign ? { foreign: true } : {}),
    };
  }
}

export {
  mapLemonSqueezyHttpError,
  mapLemonSqueezyStatus,
  normalizeLemonSqueezySubscription,
} from "./normalize.js";
