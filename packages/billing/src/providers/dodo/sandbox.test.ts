import { describe, expect, it } from "bun:test";
import { frozenClock } from "../../core/clock.js";
import { BillingProviderError } from "../../core/errors.js";
import { createDodoBillingProvider } from "./index.js";

const apiKey = process.env.BILLING_DODO_SANDBOX_API_KEY;
const webhookSecret = process.env.BILLING_DODO_SANDBOX_WEBHOOK_SECRET;
const productId = process.env.BILLING_DODO_SANDBOX_PRODUCT_ID;
const enabled = Boolean(apiKey && webhookSecret && productId);

describe.skipIf(!enabled)("dodo sandbox", () => {
  it("retrieves a configured test-mode product without SendLit metadata", async () => {
    const provider = createDodoBillingProvider({
      apiKey: apiKey!,
      environment: "test_mode",
      webhookSecrets: [{ version: "v1", secret: webhookSecret! }],
      clock: frozenClock(new Date()),
    });
    const product = await provider.retrieveProduct(productId!);
    expect(product.provider).toBe("dodo");
    expect(product.providerProductId).toBe(productId as string);
    expect(product.amountMinor).toBeGreaterThan(0);
    expect(product.interval === "month" || product.interval === "year").toBe(true);
    expect(JSON.stringify(product)).not.toMatch(/sendlit/i);
    await expect(
      provider.retrieveProduct("pdt_unknown_sandbox"),
    ).rejects.toBeInstanceOf(BillingProviderError);
  });
});

describe("dodo sandbox gate", () => {
  it("stays skipped in deterministic CI unless sandbox credentials are injected", () => {
    if (!enabled) {
      expect(apiKey ?? webhookSecret ?? productId).toBeUndefined();
    }
  });
});
