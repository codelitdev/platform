import { type BillingOffer, validateCatalog } from "../../catalog/index.js";
import type { Clock } from "../../core/clock.js";
import type { BillingInterval } from "../../core/ids.js";
import { BillingConfigurationError } from "../../core/errors.js";
import type {
  BillingProviderAdapter,
  DodoBillingProviderOptions,
  LemonSqueezyBillingProviderOptions,
} from "../contract.js";

/**
 * Picks the payment provider and the paid catalog from environment variables, so
 * a product changes provider by changing settings, not code (ADR 0019).
 *
 * The env record is passed in; nothing here reads the process environment. Settings:
 *
 *   BILLING_PROVIDER=dodo | lemonsqueezy     where new checkout goes
 *   BILLING_CATALOG_REVISION=<n>             raise it whenever prices, product ids or the provider change
 *   BILLING_CURRENCY=USD
 *   BILLING_DATA_ENCRYPTION_KEY=<base64>     encrypts stored checkout URLs and webhook payloads
 *   BILLING_<OFFER>_AMOUNT_MINOR=<n>         per offer, e.g. BILLING_PRO_MONTH_AMOUNT_MINOR
 *   BILLING_<OFFER>_PRODUCT_ID=<id>          Dodo product id or Lemon Squeezy variant id
 *
 * plus the credentials of each provider in use (`BILLING_PROVIDER_ENV`). A provider
 * other than the checkout one stays connected while any of its credentials is set,
 * so its existing subscriptions keep receiving webhooks after a switch.
 */
export const BILLING_PROVIDER_NAMES = ["dodo", "lemonsqueezy"] as const;
export type BillingProviderName = (typeof BILLING_PROVIDER_NAMES)[number];

/** Credentials each provider needs. All of them must be set once any one is. */
export const BILLING_PROVIDER_ENV: Record<BillingProviderName, readonly string[]> = {
  dodo: ["DODO_PAYMENTS_API_KEY", "DODO_PAYMENTS_WEBHOOK_KEY_CURRENT"],
  lemonsqueezy: [
    "LEMONSQUEEZY_API_KEY",
    "LEMONSQUEEZY_STORE_ID",
    "LEMONSQUEEZY_WEBHOOK_SECRET",
  ],
};

export type BillingEnv = Record<string, string | undefined>;

/** One paid offer of the product. Its env names come from the key: `pro_month` reads `BILLING_PRO_MONTH_*`. */
export type BillingEnvOffer<
  PlanId extends string = string,
  OfferKey extends string = string,
> = {
  key: OfferKey;
  plan: PlanId;
  interval: BillingInterval;
};

export type BillingProviderEnvConfig<
  PlanId extends string = string,
  OfferKey extends string = string,
> = {
  /** Where new checkout goes. */
  checkoutProvider: BillingProviderName;
  /** The checkout provider first, then every other provider with credentials set. */
  providers: BillingProviderName[];
  revision: number;
  currency: string;
  offers: BillingOffer<PlanId, OfferKey>[];
};

function value(env: BillingEnv, name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw ? raw : undefined;
}

function required(env: BillingEnv, name: string): string {
  const raw = value(env, name);
  if (!raw) throw new BillingConfigurationError(`${name}_required`);
  return raw;
}

function positiveInt(env: BillingEnv, name: string): number {
  const raw = required(env, name);
  const parsed = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(parsed)) {
    throw new BillingConfigurationError(`${name}_invalid`);
  }
  return parsed;
}

function isProviderName(name: string): name is BillingProviderName {
  return (BILLING_PROVIDER_NAMES as readonly string[]).includes(name);
}

function connected(env: BillingEnv, name: BillingProviderName): boolean {
  const set = BILLING_PROVIDER_ENV[name].filter((key) => value(env, key));
  if (set.length === 0) return false;
  if (set.length !== BILLING_PROVIDER_ENV[name].length) {
    const missing = BILLING_PROVIDER_ENV[name].find((key) => !value(env, key));
    throw new BillingConfigurationError(`${missing}_required`);
  }
  return true;
}

/**
 * Reads the checkout provider, connected providers and paid catalog. Returns null
 * when `BILLING_PROVIDER` is unset, so a product can fall back to a fake provider in
 * development. Anything set but incomplete or invalid throws, naming the setting.
 */
export function readBillingProviderEnv<PlanId extends string, OfferKey extends string>(
  env: BillingEnv,
  options: { offers: readonly BillingEnvOffer<PlanId, OfferKey>[] },
): BillingProviderEnvConfig<PlanId, OfferKey> | null {
  const checkoutProvider = value(env, "BILLING_PROVIDER");
  if (!checkoutProvider) return null;
  if (!isProviderName(checkoutProvider)) {
    throw new BillingConfigurationError("BILLING_PROVIDER_invalid");
  }
  for (const name of BILLING_PROVIDER_ENV[checkoutProvider]) required(env, name);
  const providers: BillingProviderName[] = [
    checkoutProvider,
    ...BILLING_PROVIDER_NAMES.filter(
      (name) => name !== checkoutProvider && connected(env, name),
    ),
  ];
  // Only read by the app's sensitive-values store, but checked here so a missing key
  // fails at startup rather than at the first checkout.
  required(env, "BILLING_DATA_ENCRYPTION_KEY");
  const revision = positiveInt(env, "BILLING_CATALOG_REVISION");
  const currency = required(env, "BILLING_CURRENCY").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BillingConfigurationError("BILLING_CURRENCY_invalid");
  }
  const productPattern =
    checkoutProvider === "lemonsqueezy" ? /^[0-9]+$/ : /^\S{2,256}$/;
  const offers = options.offers.map((offer): BillingOffer<PlanId, OfferKey> => {
    const name = `BILLING_${offer.key.toUpperCase()}`;
    const providerProductId = required(env, `${name}_PRODUCT_ID`);
    if (!productPattern.test(providerProductId)) {
      throw new BillingConfigurationError(`${name}_PRODUCT_ID_invalid`);
    }
    return {
      key: offer.key,
      revision,
      plan: offer.plan,
      interval: offer.interval,
      currency,
      amountMinor: positiveInt(env, `${name}_AMOUNT_MINOR`),
      provider: checkoutProvider,
      providerProductId,
      // Trials are the product's own; provider products must have none.
      providerTrialDays: 0,
    };
  });
  if (new Set(offers.map((offer) => offer.providerProductId)).size !== offers.length) {
    throw new BillingConfigurationError("BILLING_PRODUCT_IDS_must_be_unique");
  }
  validateCatalog({
    offers,
    requiredOfferKeys: offers.map((offer) => offer.key),
    revision,
    checkoutProvider,
  });
  return { checkoutProvider, providers, revision, currency, offers };
}

function secrets(current: string, previous: string | undefined) {
  return [
    { version: "current", secret: current },
    ...(previous ? [{ version: "previous", secret: previous }] : []),
  ];
}

export function dodoOptionsFromEnv(
  env: BillingEnv,
  clock: Clock,
): DodoBillingProviderOptions {
  const environment = value(env, "DODO_PAYMENTS_ENVIRONMENT") ?? "test_mode";
  if (environment !== "test_mode" && environment !== "live_mode") {
    throw new BillingConfigurationError("DODO_PAYMENTS_ENVIRONMENT_invalid");
  }
  const brandId = value(env, "DODO_BRAND_ID");
  return {
    apiKey: required(env, "DODO_PAYMENTS_API_KEY"),
    environment,
    webhookSecrets: secrets(
      required(env, "DODO_PAYMENTS_WEBHOOK_KEY_CURRENT"),
      value(env, "DODO_PAYMENTS_WEBHOOK_KEY_PREVIOUS"),
    ),
    // Dodo sends every brand's events to every endpoint; others are ignored.
    ...(brandId ? { brandId } : {}),
    clock,
  };
}

export function lemonSqueezyOptionsFromEnv(
  env: BillingEnv,
  clock: Clock,
): LemonSqueezyBillingProviderOptions {
  return {
    apiKey: required(env, "LEMONSQUEEZY_API_KEY"),
    storeId: required(env, "LEMONSQUEEZY_STORE_ID"),
    webhookSecrets: secrets(
      required(env, "LEMONSQUEEZY_WEBHOOK_SECRET"),
      value(env, "LEMONSQUEEZY_WEBHOOK_SECRET_PREVIOUS"),
    ),
    clock,
  };
}

/**
 * Adapters for the given providers, checkout provider first. Each adapter is loaded
 * only when used, so the optional `dodopayments` SDK is needed only with Dodo.
 */
export async function createBillingProvidersFromEnv(
  providers: readonly BillingProviderName[],
  env: BillingEnv,
  clock: Clock,
): Promise<BillingProviderAdapter[]> {
  return Promise.all(
    providers.map(async (name): Promise<BillingProviderAdapter> => {
      if (name === "dodo") {
        const { createDodoBillingProvider } = await import("../dodo/index.js");
        return createDodoBillingProvider(dodoOptionsFromEnv(env, clock));
      }
      const { createLemonSqueezyBillingProvider } = await import(
        "../lemonsqueezy/index.js"
      );
      return createLemonSqueezyBillingProvider(lemonSqueezyOptionsFromEnv(env, clock));
    }),
  );
}
