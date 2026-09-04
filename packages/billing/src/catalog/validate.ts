import { BillingConfigurationError } from "../core/errors.js";
import { assertProviderId, assertProviderName } from "../core/ids.js";
import { assertIso4217, money } from "../core/money.js";
import type { BillingOffer } from "./types.js";

export type CatalogValidationInput<
  PlanId extends string = string,
  OfferKey extends string = string,
> = {
  offers: BillingOffer<PlanId, OfferKey>[];
  requiredOfferKeys: readonly OfferKey[];
  revision: number;
  checkoutProvider: string;
};

export function validateCatalog<
  PlanId extends string = string,
  OfferKey extends string = string,
>(input: CatalogValidationInput<PlanId, OfferKey>): BillingOffer<PlanId, OfferKey>[] {
  if (!Number.isSafeInteger(input.revision) || input.revision <= 0) {
    throw new BillingConfigurationError("revision_must_be_positive");
  }
  assertProviderName(input.checkoutProvider);

  const keys = input.offers.map((offer) => offer.key);
  for (const key of [...keys, ...input.requiredOfferKeys]) {
    if (
      typeof key !== "string" ||
      key.length < 1 ||
      key.length > 128 ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(key)
    ) {
      throw new BillingConfigurationError("offer_key_invalid");
    }
  }
  if (new Set(keys).size !== keys.length) {
    throw new BillingConfigurationError("offer_keys_must_be_unique");
  }
  const required = new Set(input.requiredOfferKeys);
  if (required.size !== input.requiredOfferKeys.length) {
    throw new BillingConfigurationError("required_offer_keys_must_be_unique");
  }
  if (keys.length !== required.size) {
    throw new BillingConfigurationError("offer_set_must_match_required_keys");
  }
  for (const key of keys) {
    if (!required.has(key)) {
      throw new BillingConfigurationError("undeclared_offer_key");
    }
  }

  const products = new Set<string>();
  for (const offer of input.offers) {
    if (offer.revision !== input.revision) {
      throw new BillingConfigurationError("offer_revision_mismatch");
    }
    if (offer.provider !== input.checkoutProvider) {
      throw new BillingConfigurationError("offer_provider_mismatch");
    }
    if (offer.interval !== "month" && offer.interval !== "year") {
      throw new BillingConfigurationError("interval_invalid");
    }
    if (!Number.isSafeInteger(offer.providerTrialDays) || offer.providerTrialDays < 0) {
      throw new BillingConfigurationError("provider_trial_days_invalid");
    }
    money(offer.amountMinor, offer.currency);
    assertIso4217(offer.currency);
    assertProviderId(offer.providerProductId);
    const productKey = `${offer.provider}:${offer.providerProductId}`;
    if (products.has(productKey)) {
      throw new BillingConfigurationError("provider_products_must_be_unique");
    }
    products.add(productKey);
  }
  return input.offers;
}

export function catalogMatchesProviderSnapshot(
  offer: Pick<
    BillingOffer,
    "provider" | "providerProductId" | "currency" | "amountMinor" | "interval"
  >,
  snapshot: {
    provider: string;
    providerProductId: string;
    currency: string;
    amountMinor: number;
    interval: string;
  },
): boolean {
  return (
    snapshot.provider === offer.provider &&
    snapshot.providerProductId === offer.providerProductId &&
    snapshot.currency === offer.currency &&
    snapshot.amountMinor === offer.amountMinor &&
    snapshot.interval === offer.interval
  );
}
