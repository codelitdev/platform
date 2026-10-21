import { describe, expect, it, vi } from "bun:test";
import { createBatchSender } from "./transport.js";

const ok = () => new Response(null, { status: 200 });
const okSend = <T>() => vi.fn(async (_items: T[], _signal: AbortSignal) => ok());

describe("createBatchSender", () => {
  it("sends a burst in batches instead of one request per item", async () => {
    const send = okSend<number>();
    const sender = createBatchSender<number>({ send, maxBatch: 50 });
    for (let i = 0; i < 120; i++) sender.push(i);
    await sender.shutdown();
    const batches = send.mock.calls.map(([items]) => items);
    expect(batches.map((items) => items.length)).toEqual([50, 50, 20]);
    expect(batches.flat()).toEqual([...Array(120).keys()]);
  });

  it("sends a partial batch after the flush interval", async () => {
    const send = okSend<string>();
    const sender = createBatchSender<string>({ send, flushIntervalMs: 10 });
    sender.push("a");
    expect(send).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries on 429, 5xx and network errors, then gives up quietly", async () => {
    const responses = [
      () => Promise.reject(new Error("socket hang up")),
      () => Promise.resolve(new Response(null, { status: 503 })),
      () => Promise.resolve(ok()),
    ];
    const send = vi.fn(() => (responses.shift() ?? (() => Promise.resolve(ok())))());
    const sender = createBatchSender<string>({ send, retryDelaysMs: [1, 1] });
    sender.push("event");
    await sender.shutdown();
    expect(send).toHaveBeenCalledTimes(3);

    const failing = vi.fn(async () => new Response(null, { status: 500 }));
    const giveUp = createBatchSender<string>({ send: failing, retryDelaysMs: [1, 1] });
    giveUp.push("event");
    await expect(giveUp.shutdown()).resolves.toBeUndefined();
    expect(failing).toHaveBeenCalledTimes(3);
  });

  it("does not retry other client errors", async () => {
    const send = vi.fn(async () => new Response(null, { status: 400 }));
    const sender = createBatchSender<string>({ send, retryDelaysMs: [1, 1] });
    sender.push("event");
    await sender.shutdown();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("aborts a request that takes longer than the timeout", async () => {
    const send = vi.fn(
      (_items: string[], signal: AbortSignal) =>
        new Promise<Response>((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    const sender = createBatchSender<string>({ send, timeoutMs: 5, retryDelaysMs: [] });
    sender.push("event");
    await sender.shutdown();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps the queue bounded by dropping the oldest items", async () => {
    const send = okSend<number>();
    const sender = createBatchSender<number>({ send, maxBatch: 100, maxQueue: 3 });
    for (let i = 0; i < 5; i++) sender.push(i);
    await sender.shutdown();
    expect(send.mock.calls[0]?.[0]).toEqual([2, 3, 4]);
  });
});
