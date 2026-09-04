export const CHECKOUT_STATUSES = [
  "creating",
  "open",
  "completed",
  "expired",
  "abandoned",
  "conflicted",
] as const;

export type CheckoutAttemptStatus = (typeof CHECKOUT_STATUSES)[number];

export const CHECKOUT_NONTERMINAL: ReadonlySet<CheckoutAttemptStatus> = new Set([
  "creating",
  "open",
]);

export type CheckoutAttempt = {
  id: string;
  attemptId: string;
  billableEntityId: string;
  payerId: string;
  payerEmail: string;
  returnUrl: string;
  provider: string;
  catalogRevision: number;
  offerKey: string;
  plan: string;
  interval: "month" | "year";
  priceEntryId: string;
  quotedAmountMinor: number;
  quotedCurrency: string;
  providerCustomerRowId: string | null;
  providerCheckoutSessionId: string | null;
  checkoutUrlEncrypted: string | null;
  idempotencyKey: string;
  status: CheckoutAttemptStatus;
  expiresAt: Date;
  lastError: string | null;
  completedAt: Date | null;
  applicationFields?: Record<string, unknown>;
};
