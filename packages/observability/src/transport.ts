/**
 * Sends telemetry in batches with retries, so a burst of captures (or a slow
 * network) doesn't drop events. Items wait in a bounded queue and go out when
 * `maxBatch` are waiting or after `flushIntervalMs`. A failed batch (network
 * error, timeout, 429 or 5xx) is retried with backoff, then dropped; telemetry
 * never throws into the caller.
 */
export type BatchSenderOptions<T> = {
  send(items: T[], signal: AbortSignal): Promise<Response>;
  maxBatch?: number;
  maxQueue?: number;
  flushIntervalMs?: number;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
};

export type BatchSender<T> = {
  push(item: T): void;
  /** Sends everything queued and waits for in-flight batches. */
  shutdown(): Promise<void>;
};

const RETRYABLE_STATUS = (status: number) => status === 429 || status >= 500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createBatchSender<T>(options: BatchSenderOptions<T>): BatchSender<T> {
  const maxBatch = options.maxBatch ?? 50;
  const maxQueue = options.maxQueue ?? 1_000;
  const flushIntervalMs = options.flushIntervalMs ?? 1_000;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retryDelaysMs = options.retryDelaysMs ?? [500, 2_000];
  const queue: T[] = [];
  const inFlight = new Set<Promise<void>>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function deliver(items: T[]) {
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      const controller = new AbortController();
      const abort = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await options.send(items, controller.signal);
        if (!RETRYABLE_STATUS(response.status)) return;
      } catch {
        // Network error or timeout: retry below.
      } finally {
        clearTimeout(abort);
      }
      const delay = retryDelaysMs[attempt];
      if (delay === undefined) return;
      await sleep(delay);
    }
  }

  function drain() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    while (queue.length) {
      const request = deliver(queue.splice(0, maxBatch)).finally(() =>
        inFlight.delete(request),
      );
      inFlight.add(request);
    }
  }

  return {
    push(item) {
      // Keep memory bounded if the endpoint is down: drop the oldest.
      if (queue.length >= maxQueue) queue.shift();
      queue.push(item);
      if (queue.length >= maxBatch) {
        drain();
      } else if (!timer) {
        timer = setTimeout(drain, flushIntervalMs);
        // Pending telemetry must not keep a CLI or test process alive.
        (timer as { unref?: () => void }).unref?.();
      }
    },
    async shutdown() {
      drain();
      await Promise.allSettled([...inFlight]);
    },
  };
}
