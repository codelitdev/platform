export interface BillingTelemetry {
  event(
    engineEvent: string,
    allowlistedProperties: Record<string, string | number | boolean | null>,
  ): void;
  error(error: unknown, safeContext: Record<string, string>): void;
}

export const noopTelemetry: BillingTelemetry = {
  event() {},
  error() {},
};

export class MemoryTelemetry implements BillingTelemetry {
  readonly events: Array<{
    name: string;
    properties: Record<string, unknown>;
  }> = [];
  failNext = false;

  event(
    engineEvent: string,
    allowlistedProperties: Record<string, string | number | boolean | null>,
  ): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("telemetry_failed");
    }
    this.events.push({
      name: engineEvent,
      properties: allowlistedProperties,
    });
  }

  error(error: unknown, safeContext: Record<string, string>): void {
    this.events.push({
      name: "error",
      properties: {
        ...safeContext,
        message: error instanceof Error ? error.name : "error",
      },
    });
  }
}

export function safeTelemetry(inner: BillingTelemetry): BillingTelemetry {
  return {
    event(name, props) {
      try {
        inner.event(name, props);
      } catch {
        // telemetry must never change a workflow result
      }
    },
    error(error, ctx) {
      try {
        inner.error(error, ctx);
      } catch {
        // ignore
      }
    },
  };
}
