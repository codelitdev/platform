import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { frozenClock } from "../../core/clock.js";
import { BillingProviderError } from "../../core/errors.js";
import { createDodoBillingProvider } from "./index.js";

// standardwebhooks checks the signature timestamp against the real time.
const clock = frozenClock(new Date());
const secretBytes = Buffer.from("dodo-brand-test-webhook-key-0001");
const webhookSecret = `whsec_${secretBytes.toString("base64")}`;

function provider(brandId?: string) {
  return createDodoBillingProvider({
    apiKey: "test-api-key",
    environment: "test_mode",
    webhookSecrets: [{ version: "v1", secret: webhookSecret }],
    clock,
    ...(brandId === undefined ? {} : { brandId }),
  });
}

function signed(data: Record<string, unknown>, eventId = "evt_brand_1") {
  const body = JSON.stringify({
    type: "subscription.active",
    timestamp: clock.now().toISOString(),
    data: { subscription_id: "sub_1", product_id: "pdt_1", ...data },
  });
  const timestamp = String(Math.floor(clock.now().getTime() / 1000));
  const signature = createHmac("sha256", secretBytes)
    .update(`${eventId}.${timestamp}.${body}`)
    .digest("base64");
  return {
    body,
    headers: {
      "webhook-id": eventId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
  };
}

describe("dodo brand filtering", () => {
  it("marks events from another brand as foreign", async () => {
    const envelope = await provider("bus_this_product").parseWebhook(
      signed({ brand_id: "bus_other_product" }),
    );
    expect(envelope.foreign).toBe(true);
    expect(envelope.subscriptionId).toBe("sub_1");
  });

  it("keeps events from its own brand", async () => {
    const envelope = await provider("bus_this_product").parseWebhook(
      signed({ brand_id: "bus_this_product" }),
    );
    expect(envelope.foreign).toBeUndefined();
  });

  it("keeps events without a brand_id", async () => {
    const envelope = await provider("bus_this_product").parseWebhook(signed({}));
    expect(envelope.foreign).toBeUndefined();
  });

  it("keeps every event when no brand is configured", async () => {
    const envelope = await provider().parseWebhook(
      signed({ brand_id: "bus_other_product" }),
    );
    expect(envelope.foreign).toBeUndefined();
  });

  it("still rejects a bad signature from another brand", async () => {
    const request = signed({ brand_id: "bus_other_product" });
    request.headers["webhook-signature"] = "v1,AAAA";
    await expect(provider("bus_this_product").parseWebhook(request)).rejects.toThrow(
      "webhook_signature_invalid",
    );
  });

  it("rejects an invalid brand id", () => {
    for (const brandId of ["", "has space", "x".repeat(257)]) {
      expect(() => provider(brandId)).toThrow(BillingProviderError);
    }
  });
});
