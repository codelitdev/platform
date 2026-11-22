import { describe, expect, it, vi } from "bun:test";
import {
  type CaptureClient,
  createObservability,
  otlpLogRecord,
  stackFrames,
} from "./create.js";

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
      const [event] = JSON.parse(String(request.body)).batch as Array<{
        properties: Record<string, unknown>;
      }>;
      const [exception] = event!.properties.$exception_list as Array<{
        type: string;
        value: string;
        stacktrace: { type: string; frames: unknown[] };
      }>;
      expect(exception!.type).toBe("Error");
      expect(exception!.value).toContain("[redacted]");
      expect(exception!.stacktrace.type).toBe("raw");
      expect(exception!.stacktrace.frames.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("turns a V8 stack into error-tracking frames, oldest call first", () => {
    const frames = stackFrames(
      [
        "Error: boom",
        "    at handler (/app/src/routes.ts:10:5)",
        "    at async run (file:///app/node_modules/express/index.js:3:7)",
        "    at node:internal/process/task_queues:95:5",
        "    at <anonymous>",
      ].join("\n"),
    );
    expect(frames).toEqual([
      {
        platform: "node:javascript",
        filename: "<anonymous>",
        function: "?",
        in_app: false,
      },
      {
        platform: "node:javascript",
        filename: "node:internal/process/task_queues",
        function: "?",
        lineno: 95,
        colno: 5,
        in_app: false,
      },
      {
        platform: "node:javascript",
        filename: "/app/node_modules/express/index.js",
        function: "run",
        lineno: 3,
        colno: 7,
        in_app: false,
      },
      {
        platform: "node:javascript",
        filename: "/app/src/routes.ts",
        function: "handler",
        lineno: 10,
        colno: 5,
        in_app: true,
      },
    ]);
  });

  it("ships logs as OTLP records with the service as a resource", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const obs = createObservability({
        serviceName: "reference-api",
        environment: "test",
        logs: { otlp: { endpoint: "https://logs.example/v1/logs" } },
        contextPolicy: { propertyAllowlist: new Set() },
      });
      obs.logger.warn({ jobId: "job_1", attempt: 2 }, "retrying job");
      await obs.shutdown(500);
      const request = (
        fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
      )[0]?.[1];
      if (!request) throw new Error("logs_request_missing");
      const [resourceLogs] = JSON.parse(String(request.body)).resourceLogs;
      expect(resourceLogs.resource.attributes).toEqual([
        { key: "service.name", value: { stringValue: "reference-api" } },
        { key: "deployment.environment", value: { stringValue: "test" } },
      ]);
      const [record] = resourceLogs.scopeLogs[0].logRecords;
      expect(record.severityText).toBe("warn");
      expect(record.severityNumber).toBe(13);
      expect(record.body).toEqual({ stringValue: "retrying job" });
      expect(record.attributes).toEqual([
        { key: "jobId", value: { stringValue: "job_1" } },
        { key: "attempt", value: { intValue: "2" } },
      ]);
      expect(record.timeUnixNano).toMatch(/^\d+000000$/);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("sends a line that is not JSON as the log body", () => {
    expect(otlpLogRecord("plain text")).toEqual({
      severityNumber: 9,
      severityText: "info",
      body: { stringValue: "plain text" },
    });
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

  it("keeps identifier values that the long-token mask would hide", () => {
    const client = fakeClient();
    const obs = createObservability({
      serviceName: "reference-api",
      environment: "test",
      posthog: { apiKey: "phc_test", client },
      contextPolicy: {
        propertyAllowlist: new Set(["team_id", "note", "owner_id"]),
        identifierKeys: new Set(["team_id", "owner_id"]),
      },
    });
    const teamId = "01a15eb2-1861-7bbe-9b50-6a8f0bf0ef6e";
    obs.captureEvent({
      event: "team_paused",
      source: "abuse",
      properties: {
        team_id: teamId,
        owner_id: "someone@example.com",
        note: "abcdefghijklmnopqrstuvwxyz0123",
      },
    });
    const [event] = client.events as Array<{ properties: Record<string, unknown> }>;
    expect(event?.properties.team_id).toBe(teamId);
    expect(event?.properties.owner_id).toBe("[redacted-email]");
    expect(event?.properties.note).toBe("[redacted-token]");
  });

  it("batches events from the default HTTP client with their timestamps", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const obs = createObservability({
        serviceName: "reference-api",
        environment: "test",
        posthog: { apiKey: "phc_test", host: "https://posthog.example" },
        contextPolicy: { propertyAllowlist: new Set() },
        dedupeTtlMs: 0,
        perSourceCap: Number.POSITIVE_INFINITY,
      });
      for (let i = 0; i < 10; i++) {
        obs.captureEvent({ event: `step_${i}`, source: "worker", subjectId: `t${i}` });
      }
      await obs.shutdown(500);
      const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0]).toBe("https://posthog.example/batch/");
      const body = JSON.parse(String(calls[0]?.[1].body));
      expect(body.api_key).toBe("phc_test");
      expect(body.batch).toHaveLength(10);
      expect(typeof body.batch[0].timestamp).toBe("string");
    } finally {
      globalThis.fetch = previousFetch;
    }
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

  it("attaches groups and person properties, and lets product events skip dedupe", () => {
    const client = fakeClient();
    const obs = createObservability({
      serviceName: "reference-api",
      environment: "test",
      posthog: { apiKey: "phc_test", client },
      contextPolicy: {
        propertyAllowlist: new Set(["step", "industry"]),
        identifierKeys: new Set(),
      },
    });
    const schoolId = "sch_0123456789abcdefghijklmnop";
    for (const step of ["you", "school"]) {
      obs.captureEvent({
        event: "Onboarding step completed",
        source: "onboarding",
        subjectId: "user_1",
        properties: { step, secret: "x", unlisted: "y" },
        groups: { school: schoolId, empty: "", bad: { nested: true } },
        personProperties: { industry: "education", email: "ada@example.com" },
        dedupe: false,
      });
    }
    expect(client.events).toHaveLength(2);
    const [first, second] = client.events as Array<{
      event: string;
      distinctId: string;
      properties: Record<string, unknown>;
    }>;
    expect(first!.distinctId).toBe("user_1");
    expect(first!.properties.step).toBe("you");
    expect(second!.properties.step).toBe("school");
    expect(first!.properties.secret).toBeUndefined();
    expect(first!.properties.unlisted).toBeUndefined();
    // Group keys are opaque ids, so long tokens are kept.
    expect(first!.properties.$groups).toEqual({ school: schoolId });
    expect(first!.properties.$set).toEqual({ industry: "education" });
  });

  it("still dedupes events by default and omits empty groups", () => {
    const client = fakeClient();
    const obs = createObservability({
      serviceName: "reference-api",
      environment: "test",
      posthog: { apiKey: "phc_test", client },
      contextPolicy: { propertyAllowlist: new Set() },
    });
    obs.captureEvent({
      event: "ping",
      source: "s",
      subjectId: "u",
      groups: { school: "" },
    });
    obs.captureEvent({ event: "ping", source: "s", subjectId: "u" });
    expect(client.events).toHaveLength(1);
    const [event] = client.events as Array<{ properties: Record<string, unknown> }>;
    expect(event!.properties.$groups).toBeUndefined();
    expect(event!.properties.$set).toBeUndefined();
  });

  it("identifies a group with allowlisted properties", () => {
    const client = fakeClient();
    const obs = createObservability({
      serviceName: "reference-api",
      environment: "test",
      posthog: { apiKey: "phc_test", client },
      contextPolicy: { propertyAllowlist: new Set(["plan"]) },
    });
    obs.identifyGroup({
      groupType: "school",
      groupKey: "sch_1",
      source: "billing",
      properties: { plan: "pro", owner_email: "ada@example.com" },
    });
    obs.identifyGroup({ groupType: "school", groupKey: "", source: "billing" });
    expect(client.events).toEqual([
      {
        event: "$groupidentify",
        distinctId: "$school_sch_1",
        properties: {
          $process_person_profile: false,
          $group_type: "school",
          $group_key: "sch_1",
          $group_set: { service: "reference-api", environment: "test", plan: "pro" },
        },
      },
    ]);
  });

  it("sends personless events without person properties", () => {
    const client = fakeClient();
    const obs = createObservability({
      serviceName: "reference-api",
      environment: "test",
      posthog: { apiKey: "phc_test", client },
      contextPolicy: { propertyAllowlist: new Set(["plan"]) },
    });
    obs.captureEvent({
      event: "Learner enrolled",
      source: "activity",
      subjectId: "school_sch_1",
      groups: { school: "sch_1" },
      personProperties: { plan: "pro" },
      processPerson: false,
    });
    const [event] = client.events as Array<{ properties: Record<string, unknown> }>;
    expect(event!.properties.$process_person_profile).toBe(false);
    expect(event!.properties.$set).toBeUndefined();
    expect(event!.properties.$groups).toEqual({ school: "sch_1" });
  });
});
