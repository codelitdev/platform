import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { frozenClock } from "../../core/clock.js";
import { BillingProviderError } from "../../core/errors.js";
import { createLemonSqueezyBillingProvider, mapLemonSqueezyStatus } from "./index.js";

const clock = frozenClock(new Date("2026-06-01T00:00:00.000Z"));
const secret = "ls-webhook-secret";

type Call = { method: string; url: string; body?: unknown };

function fakeFetch(routes: Record<string, unknown>, calls: Call[] = []) {
  return (async (url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = String(url).replace("https://api.lemonsqueezy.com/v1", "");
    calls.push({
      method,
      url: path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const key = `${method} ${path.split("?")[0]}`;
    if (!(key in routes)) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as typeof fetch;
}

function adapter(routes: Record<string, unknown> = {}, calls: Call[] = []) {
  return createLemonSqueezyBillingProvider({
    apiKey: "ls_test_key",
    storeId: "123",
    webhookSecrets: [{ version: "v1", secret }],
    clock,
    fetch: fakeFetch(routes, calls),
  });
}

const subscriptionAttributes = {
  store_id: 123,
  customer_id: 9,
  variant_id: 77,
  status: "active",
  cancelled: false,
  renews_at: "2026-07-01T00:00:00.000Z",
  ends_at: null,
  trial_ends_at: null,
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-01T00:00:00.000Z",
};

function signed(body: unknown) {
  const raw = JSON.stringify(body);
  return {
    body: raw,
    headers: { "x-signature": createHmac("sha256", secret).update(raw).digest("hex") },
  };
}

describe("lemon squeezy adapter", () => {
  it("maps statuses onto canonical ones", () => {
    expect(mapLemonSqueezyStatus("on_trial")).toBe("trialing");
    expect(mapLemonSqueezyStatus("active")).toBe("active");
    expect(mapLemonSqueezyStatus("past_due")).toBe("past_due");
    expect(mapLemonSqueezyStatus("paused")).toBe("past_due");
    expect(mapLemonSqueezyStatus("cancelled")).toBe("cancelled");
    expect(mapLemonSqueezyStatus("unpaid")).toBe("cancelled");
    expect(mapLemonSqueezyStatus("expired")).toBe("expired");
  });

  it("leaves plan changes to the engine and bills interval changes at once", () => {
    const { capabilities } = adapter();
    expect(capabilities.portalPlanChanges).toBe(false);
    expect(capabilities.portalIntervalChanges).toBe(false);
    expect(capabilities.intervalChangesBillImmediately).toBe(true);
  });

  it("reads a cancelled subscription as paid until ends_at", async () => {
    const snapshot = await adapter({
      "GET /subscriptions/55": {
        data: {
          id: "55",
          type: "subscriptions",
          attributes: {
            ...subscriptionAttributes,
            status: "cancelled",
            cancelled: true,
            renews_at: null,
            ends_at: "2026-07-01T00:00:00.000Z",
          },
        },
      },
    }).retrieveSubscription("55");
    expect(snapshot).toMatchObject({
      provider: "lemonsqueezy",
      providerSubscriptionId: "55",
      providerCustomerId: "9",
      providerProductId: "77",
      status: "cancelled",
      cancelAtPeriodEnd: true,
    });
    expect(snapshot.paidThroughAt?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("rejects subscriptions from another store", async () => {
    await expect(
      adapter({
        "GET /subscriptions/55": {
          data: {
            id: "55",
            type: "subscriptions",
            attributes: { ...subscriptionAttributes, store_id: 999 },
          },
        },
      }).retrieveSubscription("55"),
    ).rejects.toThrow(BillingProviderError);
  });

  it("cancels and resumes by setting cancelled", async () => {
    const calls: Call[] = [];
    const ls = adapter({ "PATCH /subscriptions/55": { data: { id: "55" } } }, calls);
    await ls.cancelSubscription("55", "cancel:1");
    await ls.resumeSubscription("55", "resume:1");
    expect(calls.map((call) => (call.body as any).data.attributes)).toEqual([
      { cancelled: true },
      { cancelled: false },
    ]);
  });

  it("reuses a customer with the same email and sends attempt data to checkout", async () => {
    const calls: Call[] = [];
    const ls = adapter(
      {
        "GET /customers": { data: [{ id: "9", type: "customers", attributes: {} }] },
        "POST /checkouts": {
          data: {
            id: "chk_1",
            type: "checkouts",
            attributes: { url: "https://store.lemonsqueezy.com/checkout/abc" },
          },
        },
      },
      calls,
    );
    expect(
      await ls.createCustomer({ email: "a@example.com", idempotencyKey: "k" }),
    ).toEqual({ provider: "lemonsqueezy", providerCustomerId: "9" });
    expect(
      calls.some((call) => call.method === "POST" && call.url === "/customers"),
    ).toBe(false);
    const checkout = await ls.createCheckout({
      productId: "77",
      currency: "USD",
      customerId: "9",
      payerEmail: "a@example.com",
      returnUrl: "https://app.example.com/billing",
      attemptId: "bca_1",
      catalogKey: "pro_month",
      trialDays: 0,
      idempotencyKey: "k",
      expiresAt: new Date("2026-01-01T01:00:00.123Z"),
    });
    expect(checkout.checkoutUrl).toBe("https://store.lemonsqueezy.com/checkout/abc");
    const body = calls.find((call) => call.url === "/checkouts")?.body as any;
    expect(body.data.attributes.checkout_data.custom).toEqual({
      checkoutAttemptId: "bca_1",
      catalogKey: "pro_month",
    });
    expect(body.data.relationships.variant.data.id).toBe("77");
    expect(body.data.relationships.store.data.id).toBe("123");
    expect(body.data.attributes.expires_at).toBe("2026-01-01T01:00:00Z");
    expect(body.data.attributes.product_options.enabled_variants).toEqual([77]);
  });

  it("reads a monthly variant with the store currency", async () => {
    const product = await adapter({
      "GET /variants/77": {
        data: {
          id: "77",
          type: "variants",
          attributes: {
            is_subscription: true,
            interval: "month",
            interval_count: 1,
            price: 1000,
          },
        },
      },
      "GET /stores/123": {
        data: { id: "123", type: "stores", attributes: { currency: "usd" } },
      },
    }).retrieveProduct("77");
    expect(product).toEqual({
      provider: "lemonsqueezy",
      providerProductId: "77",
      currency: "USD",
      amountMinor: 1000,
      interval: "month",
    });
  });

  it("verifies webhooks, keeps attempt data, and marks other stores foreign", async () => {
    const event = {
      meta: {
        event_name: "subscription_created",
        custom_data: { checkoutAttemptId: "bca_1", catalogKey: "pro_month" },
      },
      data: { id: "55", type: "subscriptions", attributes: subscriptionAttributes },
    };
    const envelope = await adapter().parseWebhook(signed(event));
    expect(envelope).toMatchObject({
      provider: "lemonsqueezy",
      eventType: "subscription_created",
      subscriptionId: "55",
      verifiedKeyVersion: "v1",
      correlationMetadata: { checkoutAttemptId: "bca_1", catalogKey: "pro_month" },
    });
    expect(envelope.foreign).toBeUndefined();
    expect(envelope.providerEventId.startsWith("ls_")).toBe(true);

    const invoice = await adapter().parseWebhook(
      signed({
        meta: { event_name: "subscription_payment_success" },
        data: {
          id: "inv_1",
          type: "subscription-invoices",
          attributes: {
            store_id: 123,
            subscription_id: 55,
            created_at: "2026-05-01T00:00:00Z",
          },
        },
      }),
    );
    expect(invoice.subscriptionId).toBe("55");

    const other = await adapter().parseWebhook(
      signed({
        ...event,
        data: {
          ...event.data,
          attributes: { ...subscriptionAttributes, store_id: 999 },
        },
      }),
    );
    expect(other.foreign).toBe(true);
  });

  it("rejects a bad signature", async () => {
    const request = signed({ meta: { event_name: "x" }, data: {} });
    request.headers["x-signature"] = "0".repeat(64);
    await expect(adapter().parseWebhook(request)).rejects.toThrow(
      "webhook_signature_invalid",
    );
  });
});
