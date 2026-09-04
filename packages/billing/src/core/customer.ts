export const CUSTOMER_STATUSES = ["creating", "active", "conflicted"] as const;
export type ProviderCustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export type ProviderCustomer = {
  id: string;
  provider: string;
  payerId: string;
  payerEmail: string;
  providerCustomerId: string | null;
  idempotencyKey: string;
  status: ProviderCustomerStatus;
  lastError: string | null;
};
