import type { BillableEntityRef, PayerRef } from "../core/ids.js";
import type { BillingEngine } from "./engine.js";

export function getBillableEntityBillingBlockers(
    billing: BillingEngine,
    entity: BillableEntityRef,
    now: Date,
) {
    return billing.getBillableEntityBillingBlockers(entity, now);
}

export function getPayerBillingResponsibilities(
    billing: BillingEngine,
    payer: PayerRef,
    now: Date,
) {
    return billing.getPayerBillingResponsibilities(payer, now);
}
