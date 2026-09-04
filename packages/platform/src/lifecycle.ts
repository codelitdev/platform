import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import { serializeDate } from "./dates.js";

export type HealthReport = {
  status: "ok";
  service: string;
  time: string;
};

export type ReadinessCheck = {
  name: string;
  ready: boolean;
};

export type ReadinessReport = {
  status: "ready" | "not_ready";
  checks: Record<string, boolean>;
};

export function healthReport(
  service: string,
  clock: Clock = systemClock,
): HealthReport {
  return {
    status: "ok",
    service,
    time: serializeDate(clock.now()),
  };
}

export function readinessReport(checks: readonly ReadinessCheck[]): ReadinessReport {
  const mapped: Record<string, boolean> = {};
  let ready = true;
  for (const check of checks) {
    mapped[check.name] = check.ready;
    if (!check.ready) ready = false;
  }
  return { status: ready ? "ready" : "not_ready", checks: mapped };
}

export type ShutdownHook = () => Promise<void> | void;

export type GracefulShutdown = {
  shuttingDown: () => boolean;
  shutdown: () => Promise<void>;
};

export function createGracefulShutdown(options: {
  timeoutMs: number;
  hooks: readonly ShutdownHook[];
}): GracefulShutdown {
  let shuttingDown = false;
  let inFlight: Promise<void> | undefined;
  return {
    shuttingDown: () => shuttingDown,
    async shutdown() {
      if (inFlight) return inFlight;
      shuttingDown = true;
      inFlight = (async () => {
        const work = Promise.all(
          options.hooks.map(async (hook) => {
            await hook();
          }),
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("shutdown_timeout"));
          }, options.timeoutMs);
        });
        try {
          await Promise.race([work, timeout]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      })();
      return inFlight;
    },
  };
}
