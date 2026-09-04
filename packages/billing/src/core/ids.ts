const PROVIDER_ID_MAX = 256;
const OPAQUE_ID_MAX = 256;

export type BillingInterval = "month" | "year";

export type CanonicalSubscriptionStatus =
  | "pending"
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled"
  | "expired";

export type BillableEntityRef = {
  kind: string;
  id: string;
};

export type PayerRef = {
  id: string;
  email: string;
  name?: string;
};

export function assertOpaqueId(value: string, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > OPAQUE_ID_MAX) {
    throw new Error(`${label}_invalid`);
  }
  if (value !== value.trim() || /\s/.test(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

export function assertProviderId(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.length > PROVIDER_ID_MAX ||
    /\s/.test(value)
  ) {
    throw new Error("provider_id_invalid");
  }
  return value;
}

export function assertProviderName(value: string): string {
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(value)) {
    throw new Error("provider_name_invalid");
  }
  return value;
}
