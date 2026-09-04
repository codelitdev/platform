import type { NextFunction, Request, Response } from "express";
import pino, { type Logger } from "pino";
import { type Clock, createDedupe, createSourceCap } from "./limits.js";
import { opaqueSubjectId, pickAllowlisted, redactText } from "./redaction.js";

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

function createOtlpLogStream(input: {
  endpoint: string;
  headers?: Record<string, string>;
}) {
  const pending = new Set<Promise<void>>();
  const stream = {
    write(message: string) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      const request = fetch(input.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...input.headers },
        body: JSON.stringify({
          resourceLogs: [
            {
              scopeLogs: [
                {
                  logRecords: [{ body: { stringValue: message.trim() } }],
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      })
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(timer);
          pending.delete(request);
        });
      pending.add(request);
    },
  };
  return {
    stream,
    async shutdown() {
      await Promise.allSettled([...pending]);
    },
  };
}

function createHttpCaptureClient(input: {
  apiKey: string;
  host?: string;
}): CaptureClient {
  const endpoint = `${(input.host ?? "https://app.posthog.com").replace(/\/$/, "")}/capture/`;
  const pending = new Set<Promise<void>>();
  const send = (payload: Record<string, unknown>) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    const request = fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({ api_key: input.apiKey, ...payload }),
      signal: controller.signal,
    })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        pending.delete(request);
      });
    pending.add(request);
  };
  return {
    captureException(error, distinctId, properties) {
      send({
        event: "$exception",
        distinct_id: distinctId,
        properties: {
          ...properties,
          $exception_message: error.message,
          $exception_type: error.name,
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
    async shutdown() {
      await Promise.allSettled([...pending]);
    },
  };
}

export type ContextPolicy = {
  propertyAllowlist: ReadonlySet<string>;
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

export type Observability = {
  logger: Logger;
  captureEvent(input: {
    event: string;
    source: string;
    subjectId?: unknown;
    properties?: Record<string, unknown>;
  }): void;
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
  const otlp = options.logs?.otlp ? createOtlpLogStream(options.logs.otlp) : null;
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
        if (dedupe.shouldSkip(fingerprint) || cap.isLimited(input.source)) {
          return;
        }
        client.capture({
          event: input.event,
          distinctId: subject,
          properties: {
            service: options.serviceName,
            environment: options.environment,
            source: input.source,
            subject_id: subject,
            ...pickAllowlisted(
              input.properties ?? {},
              options.contextPolicy.propertyAllowlist,
            ),
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
