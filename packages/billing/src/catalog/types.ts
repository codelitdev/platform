import type { BillingInterval } from "../core/ids.js";

export type BillingOffer<
  PlanId extends string = string,
  OfferKey extends string = string,
> = {
  key: OfferKey;
  revision: number;
  plan: PlanId;
  interval: BillingInterval;
  currency: string;
  amountMinor: number;
  provider: string;
  providerProductId: string;
  providerTrialDays: number;
};

export type PublicCatalogOffer<
  PlanId extends string = string,
  OfferKey extends string = string,
> = {
  key: OfferKey;
  plan: PlanId;
  interval: BillingInterval;
  amountMinor: number;
  currency: string;
  displayTrialDays: number;
};

export type PublicBillingCatalog<
  PlanId extends string = string,
  OfferKey extends string = string,
> = {
  revision: number;
  currency: string;
  checkoutAvailable: boolean;
  offers: PublicCatalogOffer<PlanId, OfferKey>[];
};

export type CatalogRevisionStatus =
  | "pending_verification"
  | "active"
  | "retired"
  | "invalid"
  | "abandoned";
