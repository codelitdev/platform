import type { BillingOffer, PublicBillingCatalog } from "./types.js";

export function toPublicCatalog<
    PlanId extends string = string,
    OfferKey extends string = string,
>(
    revision: number,
    offers: BillingOffer<PlanId, OfferKey>[],
    checkoutAvailable: boolean,
): PublicBillingCatalog<PlanId, OfferKey> {
    const currency = offers[0]?.currency ?? "";
    return {
        revision,
        currency,
        checkoutAvailable,
        offers: offers.map((offer) => ({
            key: offer.key,
            plan: offer.plan,
            interval: offer.interval,
            amountMinor: offer.amountMinor,
            currency: offer.currency,
            displayTrialDays: offer.providerTrialDays,
        })),
    };
}

export function checkoutIsAvailable(input: {
    requestedRevision: number | null;
    activeRevision: number | null;
}): boolean {
    return (
        input.requestedRevision !== null &&
        input.activeRevision !== null &&
        input.requestedRevision === input.activeRevision
    );
}
