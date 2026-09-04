import { describe, expect, it, vi } from "bun:test";
import { type CaptureClient, createObservability } from "./create.js";

function frozen(at: Date) {
  return { now: () => new Date(at.getTime()) };
}

function fakeClient(): CaptureClient & {
  exceptions: unknown[];
  events: unknown[];
  shutdowns: number;
} {
  const exceptions: unknown[] = [];
  const events: unknown[] = [];
  return {
    exceptions,
    events,
    shutdowns: 0,
    captureException(error, distinctId, properties) {
      exceptions.push({ error, distinctId, properties });
    },
    capture(input) {
      events.push(input);
    },
    async shutdown() {
      this.shutdowns += 1;
    },
  };
}

describe("createObservability", () => {
  it("keeps stdout logging and no-ops capture when PostHog is absent", () => {
    const obs = createObservability({
      serviceName: "reference-api",
      environment: "test",
      contextPolicy: { propertyAllowlist: new Set(["job_id"]) },
    });
    expect(obs.enabled).toBe(false);
    expect(typeof obs.logger.info).toBe("function");
    obs.captureException({ error: new Error("boom"), source: "test" });
    obs.captureEvent({ event: "x", source: "test" });
  });

  it("does not read process.env at import or construction", () => {
    const previous = process.env.POSTHOG_API_KEY;
    process.env.POSTHOG_API_KEY = "phc_should_not_be_read";
    const client = fakeClient();
    const obs = createObservability({
      serviceName: "reference-api",
      environment: "test",
      contextPolicy: { propertyAllowlist: new Set() },
    });
    obs.captureException({ error: new Error("boom"), source: "test" });
    expect(client.exceptions).toHaveLength(0);
    expect(obs.enabled).toBe(false);
    process.env.POSTHOG_API_KEY = previous;
  });

  it("allowlists properties, uses opaque subjectId, and redacts emails", () => {
    const client = fakeClient();
    const obs = createObservability({
      serviceName: "reference-api",
      environment: "test",
      posthog: { apiKey: "phc_test", client },
      contextPolicy: { propertyAllowlist: new Set(["job_id", "path"]) },
    });
    obs.captureException({
      error: new Error("failed for user@example.com"),
      source: "notes.update",
      subjectId: "tnt_abc",
      context: {
        job_id: "job_1",
        path: "/v1/notes",
        teamId: "should-not-appear",
        email: "user@example.com",
      },
    });
    expect(client.exceptions).toHaveLength(1);
    const captured = client.exceptions[0] as {
      distinctId: string;
      properties: Record<string, unknown>;
    };
    expect(captured.distinctId).toBe("tnt_abc");
    expect(captured.properties.subject_id).toBe("tnt_abc");
    expect(captured.properties.job_id).toBe("job_1");
    expect(captured.properties.teamId).toBeUndefined();
    expect(captured.properties.email).toBeUndefined();
    expect(String(captured.properties.error_message)).toContain("[redacted-email]");
    expect(JSON.stringify(captured)).not.toContain("user@example.com");
  });

  it("never passes an unredacted exception to a capture client", () => {
    const client = fakeClient();
    const obs = createObservability({
      serviceName: "reference-api",
      environment: "test",
      posthog: { apiKey: "phc_test", client },
      contextPolicy: { propertyAllowlist: new Set() },
    });
    const error = new Error("failed password=super-secret-value");
    error.stack = "Error: password=super-secret-value\n  at token=also-secret";
    obs.captureException({ error, source: "worker" });
    const captured = client.exceptions[0] as { error: Error };
    expect(captured.error.message).not.toContain("super-secret-value");
    expect(captured.error.stack).not.toContain("super-secret-value");
    expect(captured.error.stack).not.toContain("also-secret");
  });

  it("redacts exception payloads sent by the default HTTP client", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const obs = createObservability({
        serviceName: "reference-api",
        environment: "test",
        posthog: { apiKey: "phc_test", host: "https://posthog.example" },
        contextPolicy: { propertyAllowlist: new Set() },
      });
      obs.captureException({
        error: new Error("failed password=super-secret-value"),
        source: "worker",
      });
      await obs.shutdown(500);
      const request = (
        fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
      )[0]?.[1];
      expect(request).toBeDefined();
      if (!request) throw new Error("capture_request_missing");
      const payload = JSON.stringify(request.body);
      expect(payload).not.toContain("super-secret-value");
      expect(payload).toContain("[redacted]");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("dedupes identical exceptions and applies a per-source cap", () => {
    const client = fakeClient();
    const clock = frozen(new Date("2026-03-01T00:00:00.000Z"));
    const obs = createObservability({
      serviceName: "reference-api",
      environment: "test",
      posthog: { apiKey: "phc_test", client },
      contextPolicy: { propertyAllowlist: new Set() },
      clock,
      perSourceCap: 2,
    });
    const error = new Error("boom");
    obs.captureException({ error, source: "worker" });
    obs.captureException({ error, source: "worker" });
    expect(client.exceptions).toHaveLength(1);
    obs.captureException({ error: new Error("other-1"), source: "worker" });
    obs.captureException({ error: new Error("other-2"), source: "worker" });
    expect(client.exceptions).toHaveLength(2);
  });

  it("bounds high-volume events with the same source cap", () => {
    const client = fakeClient();
    const obs = createObservability({
      serviceName: "reference-api",
      environment: "test",
      posthog: { apiKey: "phc_test", client },
      contextPolicy: { propertyAllowlist: new Set() },
      perSourceCap: 2,
      dedupeTtlMs: 0,
    });
    obs.captureEvent({ event: "one", source: "worker" });
    obs.captureEvent({ event: "two", source: "worker" });
    obs.captureEvent({ event: "three", source: "worker" });
    expect(client.events).toHaveLength(2);
  });

  it("does not double-report the same Express error object", () => {
    const client = fakeClient();
    const obs = createObservability({
      serviceName: "reference-api",
      environment: "test",
      posthog: { apiKey: "phc_test", client },
      contextPolicy: { propertyAllowlist: new Set() },
    });
    const err = new Error("express");
    const next = vi.fn();
    obs.expressErrorHandler(err, {} as never, {} as never, next);
    obs.expressErrorHandler(err, {} as never, {} as never, next);
    expect(client.exceptions).toHaveLength(1);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("swallows capture failures and bounds shutdown", async () => {
    const client: CaptureClient = {
      captureException() {
        throw new Error("down");
      },
      capture() {
        throw new Error("down");
      },
      async shutdown() {
        await new Promise(() => {
          /* hang */
        });
      },
    };
    const obs = createObservability({
      serviceName: "reference-api",
      environment: "test",
      posthog: { apiKey: "phc_test", client },
      contextPolicy: { propertyAllowlist: new Set() },
    });
    expect(() =>
      obs.captureException({ error: new Error("x"), source: "s" }),
    ).not.toThrow();
    const started = Date.now();
    await obs.shutdown(50);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("fans structured logs to OTLP without disabling stdout", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const obs = createObservability({
        serviceName: "reference-api",
        environment: "test",
        logs: {
          level: "info",
          otlp: { endpoint: "https://collector.example/v1/logs" },
        },
        contextPolicy: { propertyAllowlist: new Set() },
      });
      obs.logger.info({ job_id: "job_1" }, "worker started");
      await obs.shutdown(500);
      expect(obs.enabled).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://collector.example/v1/logs",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
