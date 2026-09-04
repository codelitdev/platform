import { BillingProviderError } from "../core/errors.js";
import type { BillingProviderAdapter } from "../providers/contract.js";
import {
  FAKE_BILLING_WEBHOOK_KEY,
  FakeBillingProvider,
} from "../providers/fake/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertRejects(
  fn: () => Promise<unknown>,
  test: (error: unknown) => boolean,
  message: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(test(error), message);
    return;
  }
  throw new Error(`${message}: did not reject`);
}

export async function runBillingProviderContract(
  adapter: BillingProviderAdapter,
  helpers: {
    signWebhook: FakeBillingProvider["signWebhook"];
    simulatePayment: FakeBillingProvider["simulatePayment"];
    productId: string;
    otherProductId: string;
    injectTimeoutAfter?: (
      mutation: "createCustomer" | "createCheckout" | "planChange" | "cancellation",
    ) => void;
  },
): Promise<void> {
  assert(adapter.capabilities.portalPlanChanges === false, "portalPlanChanges");
  assert(adapter.capabilities.portalIntervalChanges === false, "portalIntervalChanges");
  assert(
    adapter.capabilities.mutationRecovery.createCustomer !== "unsupported",
    "createCustomer recovery",
  );
  assert(
    adapter.capabilities.mutationRecovery.createCheckout !== "unsupported",
    "createCheckout recovery",
  );

  const product = await adapter.retrieveProduct(helpers.productId);
  assert(product.provider === adapter.provider, "product provider");
  assert(product.providerProductId === helpers.productId, "product id");
  assert(product.amountMinor > 0, "amount");
  assert(product.interval === "month" || product.interval === "year", "interval");

  await assertRejects(
    () => adapter.retrieveProduct("pdt_unknown"),
    (error) => error instanceof BillingProviderError,
    "unknown product",
  );

  const customer = await adapter.createCustomer({
    email: "payer@example.com",
    name: "Payer",
    idempotencyKey: "customer:contract:1",
  });
  const customerAgain = await adapter.createCustomer({
    email: "payer@example.com",
    name: "Payer",
    idempotencyKey: "customer:contract:1",
  });
  assert(
    customerAgain.providerCustomerId === customer.providerCustomerId,
    "customer idempotent",
  );

  if (helpers.injectTimeoutAfter) {
    helpers.injectTimeoutAfter("createCustomer");
    const timeoutCustomerKey = "customer:contract:timeout";
    await assertRejects(
      () =>
        adapter.createCustomer({
          email: "timeout@example.com",
          name: "Timeout",
          idempotencyKey: timeoutCustomerKey,
        }),
      (error) => error instanceof BillingProviderError && error.code === "unavailable",
      "customer timeout",
    );
    const recoveredCustomer = await adapter.createCustomer({
      email: "timeout@example.com",
      name: "Timeout",
      idempotencyKey: timeoutCustomerKey,
    });
    assert(/^cus_/.test(recoveredCustomer.providerCustomerId), "recovered customer id");
    const recoveredAgain = await adapter.createCustomer({
      email: "timeout@example.com",
      name: "Timeout",
      idempotencyKey: timeoutCustomerKey,
    });
    assert(
      recoveredAgain.providerCustomerId === recoveredCustomer.providerCustomerId,
      "customer timeout retry same id",
    );
  }

  const checkout = await adapter.createCheckout({
    productId: helpers.productId,
    currency: product.currency,
    customerId: customer.providerCustomerId,
    payerEmail: "payer@example.com",
    returnUrl: "https://app.test/billing",
    attemptId: "bca_attempt_1",
    catalogKey: "pro_month",
    trialDays: 14,
    idempotencyKey: "checkout:contract:1",
  });
  assert(checkout.checkoutUrl.startsWith("http"), "checkout url");
  const checkoutAgain = await adapter.createCheckout({
    productId: helpers.productId,
    currency: product.currency,
    customerId: customer.providerCustomerId,
    payerEmail: "payer@example.com",
    returnUrl: "https://app.test/billing",
    attemptId: "bca_attempt_1",
    catalogKey: "pro_month",
    trialDays: 14,
    idempotencyKey: "checkout:contract:1",
  });
  assert(
    checkoutAgain.providerCheckoutSessionId === checkout.providerCheckoutSessionId,
    "checkout idempotent",
  );
  const unpaidSession = await adapter.retrieveCheckoutSession(
    checkout.providerCheckoutSessionId,
  );
  assert(
    unpaidSession.providerCheckoutSessionId === checkout.providerCheckoutSessionId,
    "checkout session retrieve",
  );
  assert(unpaidSession.subscriptionId === null, "unpaid session has no sub");

  if (helpers.injectTimeoutAfter) {
    helpers.injectTimeoutAfter("createCheckout");
    const timeoutCheckoutKey = "checkout:contract:timeout";
    await assertRejects(
      () =>
        adapter.createCheckout({
          productId: helpers.productId,
          currency: product.currency,
          customerId: customer.providerCustomerId,
          payerEmail: "payer@example.com",
          returnUrl: "https://app.test/billing",
          attemptId: "bca_attempt_timeout",
          catalogKey: "pro_month",
          trialDays: 0,
          idempotencyKey: timeoutCheckoutKey,
        }),
      (error) => error instanceof BillingProviderError && error.code === "unavailable",
      "checkout timeout",
    );
    const recoveredCheckout = await adapter.createCheckout({
      productId: helpers.productId,
      currency: product.currency,
      customerId: customer.providerCustomerId,
      payerEmail: "payer@example.com",
      returnUrl: "https://app.test/billing",
      attemptId: "bca_attempt_timeout",
      catalogKey: "pro_month",
      trialDays: 0,
      idempotencyKey: timeoutCheckoutKey,
    });
    const recoveredCheckoutAgain = await adapter.createCheckout({
      productId: helpers.productId,
      currency: product.currency,
      customerId: customer.providerCustomerId,
      payerEmail: "payer@example.com",
      returnUrl: "https://app.test/billing",
      attemptId: "bca_attempt_timeout",
      catalogKey: "pro_month",
      trialDays: 0,
      idempotencyKey: timeoutCheckoutKey,
    });
    assert(
      recoveredCheckoutAgain.providerCheckoutSessionId ===
        recoveredCheckout.providerCheckoutSessionId,
      "checkout timeout retry same id",
    );
  }

  const paid = await helpers.simulatePayment(checkout.providerCheckoutSessionId);
  const paidSession = await adapter.retrieveCheckoutSession(
    checkout.providerCheckoutSessionId,
  );
  assert(
    paidSession.subscriptionId === paid.providerSubscriptionId,
    "paid session exposes subscription",
  );
  assert(paid.status === "trialing" || paid.status === "active", "paid status");
  assert(paid.metadata.checkoutAttemptId === "bca_attempt_1", "attempt metadata");
  assert(!/sendlit/.test(JSON.stringify(paid.metadata)), "no sendlit keys");
  const retrieved = await adapter.retrieveSubscription(paid.providerSubscriptionId);
  assert(retrieved.providerProductId === helpers.productId, "retrieved product");
  assert(
    retrieved.providerCustomerId === customer.providerCustomerId,
    "retrieved customer",
  );
  assert(retrieved.observedAt instanceof Date, "observedAt");

  if (adapter.capabilities.planChanges) {
    if (helpers.injectTimeoutAfter) {
      helpers.injectTimeoutAfter("planChange");
      await assertRejects(
        () =>
          adapter.changeSubscriptionPlan({
            providerSubscriptionId: paid.providerSubscriptionId,
            targetProviderProductId: helpers.otherProductId,
            effectiveAt: "immediately",
            prorationMode: "prorated_immediately",
            idempotencyKey: "plan-change:contract:timeout",
          }),
        (error) =>
          error instanceof BillingProviderError && error.code === "unavailable",
        "plan change timeout",
      );
      const recoveredChange = await adapter.changeSubscriptionPlan({
        providerSubscriptionId: paid.providerSubscriptionId,
        targetProviderProductId: helpers.otherProductId,
        effectiveAt: "immediately",
        prorationMode: "prorated_immediately",
        idempotencyKey: "plan-change:contract:timeout",
      });
      const recoveredChangeAgain = await adapter.changeSubscriptionPlan({
        providerSubscriptionId: paid.providerSubscriptionId,
        targetProviderProductId: helpers.otherProductId,
        effectiveAt: "immediately",
        prorationMode: "prorated_immediately",
        idempotencyKey: "plan-change:contract:timeout",
      });
      assert(
        recoveredChangeAgain.providerPaymentId === recoveredChange.providerPaymentId,
        "plan change timeout retry same payment",
      );
    } else {
      const changed = await adapter.changeSubscriptionPlan({
        providerSubscriptionId: paid.providerSubscriptionId,
        targetProviderProductId: helpers.otherProductId,
        effectiveAt: "immediately",
        prorationMode: "prorated_immediately",
        idempotencyKey: "plan-change:contract:1",
      });
      assert(changed.provider === adapter.provider, "plan change provider");
    }
    const afterChange = await adapter.retrieveSubscription(paid.providerSubscriptionId);
    assert(
      afterChange.providerProductId === helpers.otherProductId,
      "product after change",
    );
  }

  const portal = await adapter.createPortalSession({
    customerId: customer.providerCustomerId,
    returnUrl: "https://app.test/billing",
  });
  assert(portal.portalUrl.startsWith("http"), "portal url");

  if (helpers.injectTimeoutAfter) {
    helpers.injectTimeoutAfter("cancellation");
    await assertRejects(
      () =>
        adapter.cancelSubscription(
          paid.providerSubscriptionId,
          "cancel:contract:timeout",
        ),
      (error) => error instanceof BillingProviderError && error.code === "unavailable",
      "cancel timeout",
    );
    await adapter.cancelSubscription(
      paid.providerSubscriptionId,
      "cancel:contract:timeout",
    );
  } else {
    await adapter.cancelSubscription(paid.providerSubscriptionId, "cancel:contract:1");
  }
  const cancelled = await adapter.retrieveSubscription(paid.providerSubscriptionId);
  assert(cancelled.status === "cancelled", "cancelled");

  const signed = helpers.signWebhook(
    JSON.stringify({
      type: "subscription.updated",
      data: {
        subscription_id: paid.providerSubscriptionId,
        customer_id: customer.providerCustomerId,
        product_id: helpers.otherProductId,
        status: "cancelled",
        metadata: { checkoutAttemptId: "bca_attempt_1" },
      },
    }),
  );
  const event = await adapter.parseWebhook(signed);
  assert(event.provider === adapter.provider, "envelope provider");
  assert(event.subscriptionId === paid.providerSubscriptionId, "envelope sub");
  assert(event.eventType === "subscription.updated", "envelope type");
  assert(!("snapshot" in event), "envelope vs snapshot");
  assert(Boolean(event.verifiedKeyVersion), "verified key");

  await assertRejects(
    () =>
      adapter.parseWebhook({
        body: signed.body,
        headers: {
          ...signed.headers,
          "webhook-signature": "v1,deadbeef",
        },
      }),
    (error) =>
      error instanceof Error && /webhook_signature_invalid/.test(error.message),
    "bad signature",
  );

  const stale = helpers.signWebhook(
    JSON.stringify({ type: "subscription.updated", data: {} }),
    "evt_stale",
    new Date(Date.now() - 10 * 60 * 1000),
  );
  await assertRejects(
    () => adapter.parseWebhook(stale),
    (error) => error instanceof Error && /webhook_timestamp_stale/.test(error.message),
    "stale webhook",
  );
}

export function createContractFake(): {
  adapter: FakeBillingProvider;
  helpers: Parameters<typeof runBillingProviderContract>[1];
} {
  const adapter = new FakeBillingProvider({
    webhookKey: FAKE_BILLING_WEBHOOK_KEY,
  });
  adapter.seedDefaultCatalog();
  return {
    adapter,
    helpers: {
      signWebhook: adapter.signWebhook.bind(adapter),
      simulatePayment: adapter.simulatePayment.bind(adapter),
      productId: "pdt_pro_month",
      otherProductId: "pdt_business_month",
      injectTimeoutAfter: (mutation) => {
        adapter.controls.timeoutAfter = { [mutation]: true };
      },
    },
  };
}
