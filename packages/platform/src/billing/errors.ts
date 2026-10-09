import {
  BillingCompositionError,
  BillingConfigurationError,
  BillingWorkflowError,
} from "@codelitdev/billing/core";

export type BillingErrorResponse = {
  status: 403 | 409 | 502 | 503;
  body: { error: string; retryable?: boolean };
};

const FORBIDDEN = new Set(["grant_invalid", "grant_consumed", "payer_mismatch"]);
const UNAVAILABLE = new Set(["provider_unavailable", "catalog_unavailable"]);

/**
 * Maps an error thrown by a billing workflow to an HTTP response. Workflow
 * errors expose only their stable code. Anything else becomes a generic
 * failure, so provider and SDK messages never reach the client.
 */
export function billingErrorResponse(error: unknown): BillingErrorResponse {
  if (error instanceof BillingWorkflowError) {
    const status = FORBIDDEN.has(error.code)
      ? 403
      : UNAVAILABLE.has(error.code)
        ? 503
        : 409;
    return {
      status,
      body: error.retryable
        ? { error: error.code, retryable: true }
        : { error: error.code },
    };
  }
  if (
    error instanceof BillingConfigurationError ||
    error instanceof BillingCompositionError
  ) {
    return { status: 503, body: { error: "billing_not_configured" } };
  }
  return { status: 502, body: { error: "billing_request_failed" } };
}
