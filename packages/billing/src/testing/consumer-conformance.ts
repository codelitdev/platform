import { REFERENCE_OFFERS } from "./fixtures.js";

/** SendLit-shaped: paid catalog plus an application Free plan that never enters package types. */
export function sendlitShapedCatalog() {
    return {
        applicationFreePlan: "free" as const,
        paidOffers: REFERENCE_OFFERS,
    };
}

/** CourseLit-shaped: no Free plan; two independently billed entities per payer. */
export function courselitShapedCatalog() {
    return {
        applicationFreePlan: null,
        paidOffers: REFERENCE_OFFERS,
        entitiesPerPayer: 2,
    };
}
