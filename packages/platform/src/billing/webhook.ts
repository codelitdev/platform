import type { BillingEngine } from "@codelitdev/billing/workflows";

/** Products mount provider webhooks at this path, for example `/webhooks/billing/dodo`. */
export function billingWebhookPath(provider: string): string {
  return `/webhooks/billing/${provider}`;
}

export type BillingWebhookResponse = {
  status: 200 | 202 | 400 | 503;
  body: { accepted: boolean; duplicate?: boolean; error?: string };
};

/**
 * Handles a provider webhook: verifies and stores it, answers 202 (200 for a
 * duplicate), then drains the inbox in the background. Pass the raw request
 * body exactly as received; signature checks fail on re-serialised JSON.
 */
export async function handleBillingWebhook(input: {
  billing: Pick<BillingEngine, "ingestWebhook" | "runWebhookInboxBatch"> | null;
  provider: string;
  rawBody: string | Buffer | undefined;
  headers: Record<string, string | string[] | undefined>;
  workerId?: string;
  onError?: (error: unknown) => void;
}): Promise<BillingWebhookResponse> {
  if (!input.billing) {
    return { status: 503, body: { accepted: false, error: "billing_not_configured" } };
  }
  if (input.rawBody === undefined) {
    return { status: 400, body: { accepted: false } };
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    if (typeof value === "string") headers[name.toLowerCase()] = value;
    else if (Array.isArray(value) && value[0]) headers[name.toLowerCase()] = value[0];
  }
  const body =
    typeof input.rawBody === "string" ? input.rawBody : input.rawBody.toString("utf8");
  try {
    const ingested = await input.billing.ingestWebhook({
      provider: input.provider,
      raw: { body, headers },
    });
    const billing = input.billing;
    void billing
      .runWebhookInboxBatch({
        workerId: input.workerId ?? `billing-webhook-${process.pid}`,
      })
      .catch((error) => input.onError?.(error));
    return ingested.duplicate
      ? { status: 200, body: { accepted: true, duplicate: true } }
      : { status: 202, body: { accepted: true } };
  } catch (error) {
    input.onError?.(error);
    return { status: 400, body: { accepted: false } };
  }
}
