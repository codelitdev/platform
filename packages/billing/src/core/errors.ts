export type WorkflowErrorCode =
  | "catalog_changed"
  | "catalog_unavailable"
  | "provider_unavailable"
  | "active_subscription_exists"
  | "checkout_pending"
  | "subscription_required"
  | "subscription_not_changeable"
  | "plan_change_pending"
  | "plan_change_not_supported"
  | "same_offer"
  | "invalid_return_url"
  | "payer_mismatch"
  | "operation_conflicted"
  | "operation_quarantined"
  | "unsupported_operation"
  | "grant_invalid"
  | "grant_consumed"
  | "composition_invalid";

export type ProviderErrorCode =
  | "invalid"
  | "unauthorized"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "misconfigured";

export type WorkflowErrorDetails = {
  publicCatalog?: unknown;
  currentRevision?: number;
};

export class BillingWorkflowError extends Error {
  readonly retryable: boolean;
  readonly details: WorkflowErrorDetails;

  constructor(
    public readonly code: WorkflowErrorCode,
    options: { retryable?: boolean; details?: WorkflowErrorDetails } = {},
  ) {
    super(code);
    this.name = "BillingWorkflowError";
    this.retryable = options.retryable ?? retryableByDefault(code);
    this.details = options.details ?? {};
  }
}

export class BillingProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BillingProviderError";
  }
}

export class BillingCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingCompositionError";
  }
}

export class BillingConfigurationError extends Error {
  constructor(message: string) {
    super(`billing_configuration_invalid:${message}`);
    this.name = "BillingConfigurationError";
  }
}

export function providerErrorSummary(error: unknown): string {
  if (error instanceof BillingProviderError) return `provider_${error.code}`;
  return "provider_error";
}

function retryableByDefault(code: WorkflowErrorCode): boolean {
  return code === "provider_unavailable" || code === "catalog_unavailable";
}
