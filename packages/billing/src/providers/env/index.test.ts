import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { systemClock } from "../../core/clock.js";
import {
  type BillingEnv,
  createBillingProvidersFromEnv,
  dodoOptionsFromEnv,
  lemonSqueezyOptionsFromEnv,
  readBillingProviderEnv,
} from "./index.js";

const OFFERS = [
  { key: "pro_month", plan: "pro", interval: "month" },
  { key: "pro_year", plan: "pro", interval: "year" },
] as const;

const LEMONSQUEEZY: BillingEnv = {
  LEMONSQUEEZY_API_KEY: "ls-key",
  LEMONSQUEEZY_STORE_ID: "4242",
  LEMONSQUEEZY_WEBHOOK_SECRET: "ls-secret",
};
const DODO: BillingEnv = {
  DODO_PAYMENTS_API_KEY: "dodo-key",
  DODO_PAYMENTS_WEBHOOK_KEY_CURRENT: "whsec_current",
};

function env(provider: string, overrides: BillingEnv = {}): BillingEnv {
  const dodo = provider === "dodo";
  return {
    BILLING_PROVIDER: provider,
    BILLING_CATALOG_REVISION: "3",
    BILLING_CURRENCY: "usd",
    BILLING_DATA_ENCRYPTION_KEY: "test-encryption-key",
    BILLING_PRO_MONTH_AMOUNT_MINOR: "1900",
    BILLING_PRO_YEAR_AMOUNT_MINOR: "19000",
    BILLING_PRO_MONTH_PRODUCT_ID: dodo ? "pdt_month" : "1001",
    BILLING_PRO_YEAR_PRODUCT_ID: dodo ? "pdt_year" : "1002",
    ...(dodo ? DODO : LEMONSQUEEZY),
    ...overrides,
  };
}

const read = (values: BillingEnv) => readBillingProviderEnv(values, { offers: OFFERS });

describe("readBillingProviderEnv", () => {
  it("returns null without BILLING_PROVIDER", () => {
    expect(read({})).toBeNull();
    expect(read({ BILLING_PROVIDER: "  " })).toBeNull();
  });

  it("builds the catalog for the checkout provider", () => {
    for (const provider of ["dodo", "lemonsqueezy"] as const) {
      const config = read(env(provider));
      expect(config?.checkoutProvider).toBe(provider);
      expect(config?.providers).toEqual([provider]);
      expect(config?.revision).toBe(3);
      expect(config?.currency).toBe("USD");
      expect(config?.offers[0]).toEqual({
        key: "pro_month",
        revision: 3,
        plan: "pro",
        interval: "month",
        currency: "USD",
        amountMinor: 1900,
        provider,
        providerProductId: provider === "dodo" ? "pdt_month" : "1001",
        providerTrialDays: 0,
      });
    }
  });

  it("switches provider by settings alone and keeps the old one connected", () => {
    const config = read(env("dodo", LEMONSQUEEZY));
    expect(config?.checkoutProvider).toBe("dodo");
    expect(config?.providers).toEqual(["dodo", "lemonsqueezy"]);
    expect(config?.offers.every((offer) => offer.provider === "dodo")).toBe(true);
  });

  it("rejects an unknown provider", () => {
    expect(() => read(env("stripe"))).toThrow("BILLING_PROVIDER_invalid");
  });

  it("names a missing setting", () => {
    expect(() => read(env("dodo", { DODO_PAYMENTS_API_KEY: "" }))).toThrow(
      "DODO_PAYMENTS_API_KEY_required",
    );
    expect(() =>
      read(env("lemonsqueezy", { BILLING_PRO_YEAR_AMOUNT_MINOR: undefined })),
    ).toThrow("BILLING_PRO_YEAR_AMOUNT_MINOR_required");
    expect(() => read(env("dodo", { BILLING_DATA_ENCRYPTION_KEY: "" }))).toThrow(
      "BILLING_DATA_ENCRYPTION_KEY_required",
    );
  });

  it("refuses a partly configured second provider", () => {
    expect(() => read(env("dodo", { LEMONSQUEEZY_API_KEY: "ls-key" }))).toThrow(
      "LEMONSQUEEZY_STORE_ID_required",
    );
  });

  it("validates amounts, revision, currency and product ids", () => {
    expect(() =>
      read(env("dodo", { BILLING_PRO_MONTH_AMOUNT_MINOR: "19.00" })),
    ).toThrow("BILLING_PRO_MONTH_AMOUNT_MINOR_invalid");
    expect(() => read(env("dodo", { BILLING_CATALOG_REVISION: "0" }))).toThrow(
      "BILLING_CATALOG_REVISION_invalid",
    );
    expect(() => read(env("dodo", { BILLING_CURRENCY: "dollars" }))).toThrow(
      "BILLING_CURRENCY_invalid",
    );
    expect(() =>
      read(env("lemonsqueezy", { BILLING_PRO_MONTH_PRODUCT_ID: "pdt_month" })),
    ).toThrow("BILLING_PRO_MONTH_PRODUCT_ID_invalid");
    expect(() =>
      read(env("dodo", { BILLING_PRO_YEAR_PRODUCT_ID: "pdt_month" })),
    ).toThrow("BILLING_PRODUCT_IDS_must_be_unique");
  });
});

describe("provider options", () => {
  it("reads Dodo options with rotation and brand", () => {
    const options = dodoOptionsFromEnv(
      {
        ...DODO,
        DODO_PAYMENTS_ENVIRONMENT: "live_mode",
        DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS: "whsec_old",
        DODO_BRAND_ID: "brnd_1",
      },
      systemClock,
    );
    expect(options.environment).toBe("live_mode");
    expect(options.brandId).toBe("brnd_1");
    expect(options.webhookSecrets.map((entry) => entry.version)).toEqual([
      "current",
      "previous",
    ]);
    expect(dodoOptionsFromEnv(DODO, systemClock).environment).toBe("test_mode");
    expect(() =>
      dodoOptionsFromEnv({ ...DODO, DODO_PAYMENTS_ENVIRONMENT: "prod" }, systemClock),
    ).toThrow("DODO_PAYMENTS_ENVIRONMENT_invalid");
  });

  it("reads Lemon Squeezy options", () => {
    const options = lemonSqueezyOptionsFromEnv(LEMONSQUEEZY, systemClock);
    expect(options.storeId).toBe("4242");
    expect(options.webhookSecrets).toEqual([
      { version: "current", secret: "ls-secret" },
    ]);
  });
});

describe("createBillingProvidersFromEnv", () => {
  it("creates each connected adapter, checkout provider first", async () => {
    const adapters = await createBillingProvidersFromEnv(
      ["dodo", "lemonsqueezy"],
      { ...DODO, ...LEMONSQUEEZY },
      systemClock,
    );
    expect(adapters.map((adapter) => adapter.provider)).toEqual([
      "dodo",
      "lemonsqueezy",
    ]);
  });

  it("does not read process.env or import the Dodo SDK statically", async () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const source = await readFile(path.join(dir, "index.ts"), "utf8");
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/from "dodopayments"/);
    expect(source).not.toMatch(/^import .*\/dodo\/index\.js/m);
  });
});
