import { drizzleBillingAdapter } from "@codelitdev/billing/drizzle";
import { FakeBillingProvider } from "@codelitdev/billing/providers";
import { REFERENCE_OFFERS } from "@codelitdev/billing/testing";
import {
  type BillingEngine,
  createBilling,
  MemoryAuditHook,
  MemoryAuthorizationPort,
} from "@codelitdev/billing/workflows";
import type { Clock } from "@codelitdev/platform";
import * as billingSchema from "./db/schema/billing.generated.js";
import type { AppDb } from "./types.js";

export type BillingBundle = {
  billing: BillingEngine;
  fake: FakeBillingProvider;
  authorization: MemoryAuthorizationPort;
  audit: MemoryAuditHook;
};

export function composeBilling(db: AppDb, clock: Clock): BillingBundle {
  const fake = new FakeBillingProvider({ clock });
  fake.seedDefaultCatalog();
  const authorization = new MemoryAuthorizationPort();
  const audit = new MemoryAuditHook();
  const store = drizzleBillingAdapter(db as never, {
    schema: billingSchema,
    clock,
  });
  const billing = createBilling({
    database: store,
    providers: [fake],
    clock,
    authorization,
    hooks: {
      audit,
      lifecycle: {
        async afterProjection() {
          /* product-owned effect hook */
        },
      },
    },
    mode: "cloud",
    checkoutProvider: "fake",
    requestedRevision: 1,
    requiredOfferKeys: REFERENCE_OFFERS.map((offer) => offer.key),
    offers: REFERENCE_OFFERS,
    returnUrlValidator: (url) => url.startsWith("https://app.test/"),
  });
  return { billing, fake, authorization, audit };
}

export async function runBoundedMaintenance(billing: BillingEngine): Promise<number> {
  return billing.runWebhookInboxBatch({
    limit: 25,
    workerId: "__PRODUCT_SLUG__-maintenance",
  });
}
