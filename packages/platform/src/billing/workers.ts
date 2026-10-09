import type { BillingEngine } from "@codelitdev/billing/workflows";

type MaintainedBilling = Pick<
  BillingEngine,
  | "recordRequestedCatalog"
  | "verifyRequestedCatalog"
  | "runWebhookInboxBatch"
  | "runReconciliationBatch"
  | "runDeadlineBatch"
  | "purgeExpiredSensitiveValues"
>;

export type BillingWorkerTask =
  | "catalog"
  | "webhooks"
  | "reconciliation"
  | "deadlines"
  | "retention";

/**
 * Runs the billing engine's maintenance batches on timers: catalog
 * verification, the webhook inbox, reconciliation (including stuck-work
 * discovery), deadlines, and retention of stored secrets. A tick is skipped
 * while the previous one is still running. Call `stop` on shutdown, for
 * example as a graceful-shutdown hook.
 */
export function startBillingWorkers(options: {
  billing: MaintainedBilling;
  /** Unique per process, for example `${product}-billing-${process.pid}`. */
  workerId: string;
  /** Default one minute. */
  intervalMs?: number;
  /** How long stored secrets are kept. Default 30 days. */
  retentionMs?: number;
  /** Default one hour. */
  retentionIntervalMs?: number;
  onError?: (task: BillingWorkerTask, error: unknown) => void;
}): { stop: () => Promise<void> } {
  const { billing, workerId } = options;
  const onError = options.onError ?? (() => undefined);
  const retentionMs = options.retentionMs ?? 30 * 24 * 60 * 60 * 1000;
  let running: Promise<void> | null = null;

  async function attempt(task: BillingWorkerTask, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (error) {
      onError(task, error);
    }
  }

  async function tick() {
    await attempt("catalog", () => billing.verifyRequestedCatalog());
    await attempt("webhooks", () => billing.runWebhookInboxBatch({ workerId }));
    await attempt("reconciliation", () =>
      billing.runReconciliationBatch({ workerId: `${workerId}-reconcile` }),
    );
    await attempt("deadlines", () => billing.runDeadlineBatch());
  }

  function schedule(fn: () => Promise<void>) {
    if (running) return;
    running = fn().finally(() => {
      running = null;
    });
  }

  void attempt("catalog", () => billing.recordRequestedCatalog());
  const batches = setInterval(() => schedule(tick), options.intervalMs ?? 60 * 1000);
  const retention = setInterval(
    () =>
      void attempt("retention", () =>
        billing.purgeExpiredSensitiveValues({
          before: new Date(Date.now() - retentionMs),
        }),
      ),
    options.retentionIntervalMs ?? 60 * 60 * 1000,
  );
  batches.unref?.();
  retention.unref?.();

  return {
    async stop() {
      clearInterval(batches);
      clearInterval(retention);
      await running;
    },
  };
}
