import type { NextFunction, Request, Response } from "express";
import pino, { type Logger } from "pino";
import { type Clock, createDedupe, createSourceCap } from "./limits.js";
import { opaqueSubjectId, pickAllowlisted, redactText } from "./redaction.js";
import { createBatchSender } from "./transport.js";

export type ObservabilityClock = Clock;

export type CaptureClient = {
  captureException(
    error: Error,
    distinctId: string,
    properties: Record<string, unknown>,
  ): void;
  capture(input: {
    event: string;
    distinctId: string;
    properties: Record<string, unknown>;
  }): void;
  shutdown(): Promise<void>;
};

type OtlpValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };

function otlpValue(value: unknown): OtlpValue | null {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  if (value && typeof value === "object") {
    return { stringValue: JSON.stringify(value) };
  }
  return null;
}

/** pino levels as OTLP severities (trace 1, debug 5, info 9, warn 13, error 17, fatal 21). */
function otlpSeverity(level: unknown) {
  const n = typeof level === "number" ? level : 30;
  if (n >= 60) return { severityNumber: 21, severityText: "fatal" };
  if (n >= 50) return { severityNumber: 17, severityText: "error" };
  if (n >= 40) return { severityNumber: 13, severityText: "warn" };
  if (n >= 30) return { severityNumber: 9, severityText: "info" };
  if (n >= 20) return { severityNumber: 5, severityText: "debug" };
  return { severityNumber: 1, severityText: "trace" };
}

/** pino fields the record or its resource already carries. */
const LOG_RECORD_FIELDS = new Set([
  "level",
  "time",
  "msg",
  "service",
  "environment",
  "name",
]);

/**
 * One pino JSON line as an OTLP log record. The message is the body and the
 * other fields become attributes, so log tools can filter on them.
 */
export function otlpLogRecord(line: string) {
  let entry: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      entry = parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON: send the line as it is.
  }
  if (!entry) return { ...otlpSeverity(30), body: { stringValue: line } };
  const attributes: Array<{ key: string; value: OtlpValue }> = [];
  for (const [key, value] of Object.entries(entry)) {
    if (LOG_RECORD_FIELDS.has(key)) continue;
    const otlp = otlpValue(value);
    if (otlp) attributes.push({ key, value: otlp });
  }
  const time = typeof entry.time === "number" ? entry.time : Date.now();
  return {
    timeUnixNano: `${Math.round(time)}000000`,
    ...otlpSeverity(entry.level),
    body: { stringValue: typeof entry.msg === "string" ? entry.msg : line },
    attributes,
  };
}

function createOtlpLogStream(input: {
  endpoint: string;
  headers?: Record<string, string>;
  serviceName: string;
  environment: string;
}) {
  const resource = {
    attributes: [
      { key: "service.name", value: { stringValue: input.serviceName } },
      {
        key: "deployment.environment",
        value: { stringValue: input.environment },
      },
    ],
  };
  const sender = createBatchSender<string>({
    send: (messages, signal) =>
      fetch(input.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...input.headers },
        body: JSON.stringify({
          resourceLogs: [
            {
              resource,
              scopeLogs: [
                {
                  scope: { name: input.serviceName },
                  logRecords: messages.map(otlpLogRecord),
                },
              ],
            },
          ],
        }),
        signal,
      }),
  });
  return {
    stream: {
      write(message: string) {
        sender.push(message.trim());
      },
    },
    shutdown: () => sender.shutdown(),
  };
}

const STACK_FRAME =
  /^\s*at (?:async )?(?:(.+?) \()?(?:(.+):(\d+):(\d+)|([^)]+))\)?\s*$/;
const STACK_FRAME_LIMIT = 50;

/**
 * V8 stack lines as PostHog error-tracking frames, oldest call first (the
 * order PostHog's SDKs send). Error tracking builds issues from
 * `$exception_list`; without it a server exception never becomes an issue.
 */
export function stackFrames(stack: string) {
  const frames: Array<Record<string, unknown>> = [];
  for (const line of stack.split("\n")) {
    const match = line.match(STACK_FRAME);
    if (!match) continue;
    const raw = match[2] ?? match[5] ?? "";
    const filename = raw.startsWith("file://") ? raw.slice(7) : raw;
    frames.push({
      platform: "node:javascript",
      filename,
      function: match[1] ?? "?",
      ...(match[3] ? { lineno: Number(match[3]), colno: Number(match[4]) } : {}),
      in_app:
        Boolean(filename) &&
        !filename.includes("/node_modules/") &&
        !filename.startsWith("node:") &&
        filename !== "native" &&
        filename !== "<anonymous>",
    });
  }
  return frames.reverse().slice(-STACK_FRAME_LIMIT);
}

function createHttpCaptureClient(input: {
  apiKey: string;
  host?: string;
}): CaptureClient {
  const endpoint = `${(input.host ?? "https://app.posthog.com").replace(/\/$/, "")}/batch/`;
  const sender = createBatchSender<Record<string, unknown>>({
    send: (batch, signal) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({ api_key: input.apiKey, batch }),
        signal,
      }),
  });
  // Events wait in a batch, so each carries the time it happened.
  const send = (payload: Record<string, unknown>) =>
    sender.push({ ...payload, timestamp: new Date().toISOString() });
  return {
    captureException(error, distinctId, properties) {
      send({
        event: "$exception",
        distinct_id: distinctId,
        properties: {
          ...properties,
          $exception_message: error.message,
          $exception_type: error.name,
          $exception_list: [
            {
              type: error.name,
              value: error.message,
              mechanism: { handled: true, synthetic: false },
              stacktrace: { type: "raw", frames: stackFrames(error.stack ?? "") },
            },
          ],
          $exception_stack_trace_raw: redactText(error.stack ?? "", 2_000),
        },
      });
    },
    capture(input) {
      send({
        event: input.event,
        distinct_id: input.distinctId,
        properties: input.properties,
      });
    },
    shutdown: () => sender.shutdown(),
  };
}

export type ContextPolicy = {
  propertyAllowlist: ReadonlySet<string>;
  /** Allowlisted keys holding opaque record ids (for example `team_id`).
   * Their values are sent as-is apart from email and secret masking. Don't
   * list keys that can hold session or access tokens. */
  identifierKeys?: ReadonlySet<string>;
};

export type CreateObservabilityOptions = {
  serviceName: string;
  environment: string;
  posthog?: {
    apiKey: string;
    host?: string;
    client?: CaptureClient;
  };
  logs?: {
    level?: string;
    otlp?: {
      endpoint: string;
      headers?: Record<string, string>;
    };
  };
  contextPolicy: ContextPolicy;
  clock?: Clock;
  perSourceCap?: number;
  dedupeTtlMs?: number;
  dedupeMaxKeys?: number;
};

export type CaptureEventInput = {
  event: string;
  source: string;
  subjectId?: unknown;
  properties?: Record<string, unknown>;
  /** PostHog groups the event belongs to, as `{ groupType: groupKey }`
   * (for example `{ school: "sch_123" }`). Keys are opaque record ids. */
  groups?: Record<string, unknown>;
  /** Person properties to set (`$set`), filtered by the same allowlist. */
  personProperties?: Record<string, unknown>;
  /** Product events pass `false`: each occurrence counts, so the 60-second
   * fingerprint dedupe that protects noisy signals must not drop them. The
   * per-source cap still applies. Defaults to `true`. */
  dedupe?: boolean;
  /** `false` sends `$process_person_profile: false`: the event creates no
   * person. PostHog does not link personless events to groups, so when group
   * analytics must count an event, send it under a stable subject per group
   * instead. Defaults to `true`. */
  processPerson?: boolean;
};

export type IdentifyGroupInput = {
  groupType: string;
  groupKey: unknown;
  source: string;
  /** Group properties (`$group_set`), filtered by the allowlist. */
  properties?: Record<string, unknown>;
};

export type Observability = {
  logger: Logger;
  captureEvent(input: CaptureEventInput): void;
  /** Sets properties on a PostHog group, such as a school's plan. */
  identifyGroup(input: IdentifyGroupInput): void;
  captureException(input: {
    error: unknown;
    source: string;
    subjectId?: unknown;
    context?: Record<string, unknown>;
    severity?: "error" | "warning" | "critical";
  }): void;
  expressErrorHandler(
    error: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ): void;
  shutdown(timeoutMs?: number): Promise<void>;
  enabled: boolean;
};

/** A group key is an opaque record id: kept as-is apart from email masking. */
function groupKeyOf(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const key = redactText(String(value).trim(), 200, { keepLongTokens: true });
  return key || null;
}

function groupKeys(groups: Record<string, unknown> | undefined) {
  if (!groups) return null;
  const out: Record<string, string> = {};
  for (const [type, value] of Object.entries(groups)) {
    const key = groupKeyOf(value);
    if (type.trim() && key) out[type.trim()] = key;
  }
  return Object.keys(out).length ? out : null;
}

const systemClock: Clock = { now: () => new Date() };

function errorParts(error: unknown) {
  if (error instanceof Error) {
    const message = redactText(error.message, 500);
    const stack = redactText(error.stack ?? "", 2_000);
    const normalized = new Error(message);
    normalized.name = error.name || "Error";
    normalized.stack = stack;
    const stackTop = redactText((error.stack ?? "").split("\n")[1]?.trim() ?? "", 300);
    return {
      name: error.name || "Error",
      message,
      stackTop,
      normalized,
    };
  }
  const message = redactText(
    typeof error === "string" ? error : "Unknown error thrown",
    500,
  );
  const normalized = new Error(message);
  normalized.stack = redactText(normalized.stack ?? "", 2_000);
  return {
    name: "Error",
    message,
    stackTop: "",
    normalized,
  };
}

/**
 * Explicit factory. Does not read environment variables or create SDK
 * clients at module import. Tenant identity is an opaque `subjectId`.
 */
export function createObservability(
  options: CreateObservabilityOptions,
): Observability {
  const clock = options.clock ?? systemClock;
  const otlp = options.logs?.otlp
    ? createOtlpLogStream({
        ...options.logs.otlp,
        serviceName: options.serviceName,
        environment: options.environment,
      })
    : null;
  const logger = pino(
    {
      name: options.serviceName,
      level: options.logs?.level ?? "info",
      redact: {
        paths: [
          "authorization",
          "cookie",
          "headers.authorization",
          "headers.cookie",
          'headers["x-api-key"]',
          "password",
          "secret",
          "token",
          "body",
          "email",
          "card",
        ],
        remove: true,
      },
      base: {
        service: options.serviceName,
        environment: options.environment,
      },
    },
    otlp
      ? pino.multistream([{ stream: process.stdout }, { stream: otlp.stream }])
      : undefined,
  );
  const client = options.posthog
    ? (options.posthog.client ?? createHttpCaptureClient(options.posthog))
    : null;
  const enabled = Boolean(client || otlp);
  const dedupe = createDedupe({
    ttlMs: options.dedupeTtlMs ?? 60_000,
    maxKeys: options.dedupeMaxKeys ?? 10_000,
    clock,
  });
  const cap = createSourceCap({
    perSource: options.perSourceCap ?? 100,
    clock,
  });
  const seenExpress = new WeakSet<object>();
  const allowlisted = (properties: Record<string, unknown>) =>
    pickAllowlisted(
      properties,
      options.contextPolicy.propertyAllowlist,
      options.contextPolicy.identifierKeys,
    );

  const captureException: Observability["captureException"] = (input) => {
    if (!client) return;
    try {
      const parts = errorParts(input.error);
      const subject = opaqueSubjectId(input.subjectId);
      const fingerprint = `${input.source}|${parts.name}|${parts.stackTop}`;
      if (dedupe.shouldSkip(fingerprint)) return;
      if (cap.isLimited(input.source)) return;
      client.captureException(parts.normalized, subject, {
        service: options.serviceName,
        environment: options.environment,
        source: input.source,
        subject_id: subject,
        severity: input.severity ?? "error",
        error_name: parts.name,
        error_message: parts.message,
        error_stack_top: parts.stackTop,
        ...pickAllowlisted(
          input.context ?? {},
          options.contextPolicy.propertyAllowlist,
          options.contextPolicy.identifierKeys,
        ),
      });
    } catch {
      // Telemetry must never fail the caller.
    }
  };

  return {
    logger,
    enabled,
    captureEvent(input) {
      if (!client) return;
      try {
        const subject = opaqueSubjectId(input.subjectId);
        const fingerprint = `${input.source}|event|${input.event}|${subject}`;
        if (input.dedupe !== false && dedupe.shouldSkip(fingerprint)) return;
        if (cap.isLimited(input.source)) return;
        const groups = groupKeys(input.groups);
        const personProperties = input.personProperties
          ? allowlisted(input.personProperties)
          : {};
        client.capture({
          event: input.event,
          distinctId: subject,
          properties: {
            service: options.serviceName,
            environment: options.environment,
            source: input.source,
            subject_id: subject,
            ...allowlisted(input.properties ?? {}),
            ...(groups ? { $groups: groups } : {}),
            ...(input.processPerson === false
              ? { $process_person_profile: false }
              : Object.keys(personProperties).length
                ? { $set: personProperties }
                : {}),
          },
        });
      } catch {
        // Telemetry must never fail the caller.
      }
    },
    identifyGroup(input) {
      if (!client) return;
      try {
        const groupType = input.groupType.trim();
        const groupKey = groupKeyOf(input.groupKey);
        if (!groupType || !groupKey || cap.isLimited(input.source)) return;
        client.capture({
          event: "$groupidentify",
          // PostHog's SDKs use `$type_key`, which keeps it apart from real
          // distinct ids. PostHog drops a personless `$groupidentify`, so it
          // must not set `$process_person_profile: false`.
          distinctId: `$${groupType}_${groupKey}`,
          properties: {
            $group_type: groupType,
            $group_key: groupKey,
            $group_set: {
              service: options.serviceName,
              environment: options.environment,
              ...allowlisted(input.properties ?? {}),
            },
          },
        });
      } catch {
        // Telemetry must never fail the caller.
      }
    },
    captureException,
    expressErrorHandler(error, _req, _res, next) {
      if (error && typeof error === "object") {
        if (seenExpress.has(error)) {
          next(error);
          return;
        }
        seenExpress.add(error);
      }
      captureException({ error, source: "express" });
      next(error);
    },
    async shutdown(timeoutMs = 2000) {
      if (!client && !otlp) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      try {
        await Promise.race([
          Promise.all([
            client?.shutdown() ?? Promise.resolve(),
            otlp?.shutdown() ?? Promise.resolve(),
          ]).then(() => undefined),
          timeout,
        ]);
      } catch {
        // best-effort
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
