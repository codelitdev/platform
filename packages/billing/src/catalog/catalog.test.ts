import { describe, expect, it } from "bun:test";
import { checkoutIsAvailable, toPublicCatalog } from "./public-view.js";
import { canActivateRevision, olderInstanceMustNotRollback } from "./revisions.js";
import type { BillingOffer } from "./types.js";
import { validateCatalog } from "./validate.js";

const required = ["pro_month", "pro_year", "business_month", "business_year"] as const;

function offers(overrides: Partial<BillingOffer>[] = []): BillingOffer[] {
  const base: BillingOffer[] = [
    {
      key: "pro_month",
      revision: 2,
      plan: "pro",
      interval: "month",
      currency: "USD",
      amountMinor: 4900,
      provider: "dodo",
      providerProductId: "pdt_pro_month",
      providerTrialDays: 14,
    },
    {
      key: "pro_year",
      revision: 2,
      plan: "pro",
      interval: "year",
      currency: "USD",
      amountMinor: 49000,
      provider: "dodo",
      providerProductId: "pdt_pro_year",
      providerTrialDays: 0,
    },
    {
      key: "business_month",
      revision: 2,
      plan: "business",
      interval: "month",
      currency: "USD",
      amountMinor: 19900,
      provider: "dodo",
      providerProductId: "pdt_business_month",
      providerTrialDays: 0,
    },
    {
      key: "business_year",
      revision: 2,
      plan: "business",
      interval: "year",
      currency: "USD",
      amountMinor: 199000,
      provider: "dodo",
      providerProductId: "pdt_business_year",
      providerTrialDays: 0,
    },
  ];
  return base.map((row, i) => ({ ...row, ...(overrides[i] ?? {}) }));
}

describe("catalog validation", () => {
  it("accepts the exact required offer-key set", () => {
    expect(
      validateCatalog({
        offers: offers(),
        requiredOfferKeys: required,
        revision: 2,
        checkoutProvider: "dodo",
      }),
    ).toHaveLength(4);
  });

  it("rejects duplicate offer keys", () => {
    const dup = offers();
    dup[1] = {
      ...dup[1],
      key: "pro_month",
      providerProductId: "pdt_other",
    };
    expect(() =>
      validateCatalog({
        offers: dup,
        requiredOfferKeys: required,
        revision: 2,
        checkoutProvider: "dodo",
      }),
    ).toThrow(/offer_keys_must_be_unique/);
  });

  it("rejects extra or missing keys", () => {
    expect(() =>
      validateCatalog({
        offers: offers().slice(0, 3),
        requiredOfferKeys: required,
        revision: 2,
        checkoutProvider: "dodo",
      }),
    ).toThrow(/offer_set_must_match_required_keys/);
  });

  it("rejects duplicate provider product IDs", () => {
    const dup = offers();
    dup[1] = { ...dup[1], providerProductId: "pdt_pro_month" };
    expect(() =>
      validateCatalog({
        offers: dup,
        requiredOfferKeys: required,
        revision: 2,
        checkoutProvider: "dodo",
      }),
    ).toThrow(/provider_products_must_be_unique/);
  });
});

describe("public catalog projection", () => {
  it("redacts provider IDs", () => {
    const view = toPublicCatalog(2, offers(), true);
    expect(view.revision).toBe(2);
    expect(view.checkoutAvailable).toBe(true);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/pdt_/);
    expect(serialized).not.toMatch(/providerProductId/);
    expect(serialized).not.toMatch(/"provider"/);
    expect(view.offers[0]).toEqual({
      key: "pro_month",
      plan: "pro",
      interval: "month",
      amountMinor: 4900,
      currency: "USD",
      displayTrialDays: 14,
    });
  });

  it("freezes checkout when the requested revision is not the active revision", () => {
    expect(
      checkoutIsAvailable({
        requestedRevision: 2,
        activeRevision: 1,
      }),
    ).toBe(false);
    expect(
      checkoutIsAvailable({
        requestedRevision: 1,
        activeRevision: 1,
      }),
    ).toBe(true);
  });
});

describe("catalog revision activation", () => {
  it("activates only a pending revision newer than the current active revision", () => {
    expect(
      canActivateRevision({
        requested: 2,
        currentActive: 1,
        requestedStatus: "pending_verification",
      }),
    ).toBe(true);
    expect(
      canActivateRevision({
        requested: 1,
        currentActive: 2,
        requestedStatus: "pending_verification",
      }),
    ).toBe(false);
    expect(
      canActivateRevision({
        requested: 2,
        currentActive: 2,
        requestedStatus: "pending_verification",
      }),
    ).toBe(false);
    expect(
      canActivateRevision({
        requested: 3,
        currentActive: null,
        requestedStatus: "retired",
      }),
    ).toBe(false);
    expect(olderInstanceMustNotRollback(1, 2)).toBe(true);
  });
});
