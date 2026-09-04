import type { Observability } from "@codelitdev/observability";
import type { Clock } from "@codelitdev/platform";
import type { AuthRuntime } from "./auth/authenticate.js";
import type { BillingBundle } from "./billing.js";

export type DispatchDeps = AuthRuntime & {
  clock: Clock;
  billing: BillingBundle;
  serviceName: string;
  databaseReady: boolean;
  observability?: Observability;
};
