import type { CheckoutAttempt } from "../core/checkout-attempt.js";
import type { CanonicalSubscription } from "../core/subscription.js";
import type { PlanStateRow } from "../persistence/store.js";

export type BillingBlocker =
  | "nonterminal_subscription"
  | "future_paid_entitlement"
  | "live_checkout"
  | "pending_plan_change";

/** Experimental until CourseLit consumes the same hook contract. */
export type BillingLifecycleHooks = {
  afterCheckoutOpen?(input: {
    attempt: CheckoutAttempt;
    checkoutUrl: string;
  }): Promise<void>;
  afterProjection?(input: {
    material: boolean;
    previous: CanonicalSubscription | null;
    next: CanonicalSubscription;
    planState: PlanStateRow;
  }): Promise<void>;
};

export type PayerResponsibility = {
  provider: string;
  providerCustomerId: string | null;
  subscriptionIds: string[];
};
