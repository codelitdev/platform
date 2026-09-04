import http from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { toNodeHandler } from "better-auth/node";
import {
  createObservability,
  type Observability,
} from "@codelitdev/observability";
import { frozenClock, systemClock, type Clock } from "@codelitdev/platform";
import type { Logger } from "pino";
import * as schema from "./db/schema/index.js";
import * as billingSchema from "./db/schema/billing.generated.js";
import { applyMigrations } from "./db/migrate.js";
import { composeBilling, type BillingBundle } from "./billing.js";
import { createReferenceAuth } from "./auth/better-auth.js";
import type { AppDb } from "./types.js";
import type { DispatchDeps } from "./deps.js";

export type Runtime = DispatchDeps & {
  client: PGlite | Pool;
  logger: Logger;
  authServer: http.Server | null;
  close(): Promise<void>;
};

export async function createPgliteRuntime(options: {
  clock?: Clock;
  apiKeyPepper?: string;
  serviceName?: string;
  publicApiUrl?: string;
  webOrigin?: string;
  logger?: Logger;
  observability?: Observability;
  authSecret?: string;
}): Promise<Runtime> {
  const client = new PGlite();
  await applyMigrations((sql) => client.exec(sql));
  const db = drizzle(client, {
    schema: { ...schema, ...billingSchema },
  }) as AppDb;
  const clock = options.clock ?? systemClock;
  const billing = composeBilling(db, clock);
  let handler: ReturnType<typeof toNodeHandler> | undefined;
  let authServer: http.Server | null = null;
  let publicApiUrl = options.publicApiUrl;
  if (!publicApiUrl) {
    authServer = http.createServer((req, res) => {
      if (!handler) {
        res.statusCode = 503;
        res.end();
        return;
      }
      void handler(req, res);
    });
    await new Promise<void>((resolve) => {
      authServer!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = authServer.address();
    if (!address || typeof address === "string") {
      throw new Error("auth_listen_failed");
    }
    publicApiUrl = `http://127.0.0.1:${address.port}`;
  }
  const auth = createReferenceAuth({
    db,
    publicApiUrl,
    webOrigin: options.webOrigin,
    secret:
      options.authSecret ??
      "test-secret-that-is-at-least-thirty-two-characters",
  });
  handler = toNodeHandler(auth.auth);
  const importTables = await client.query(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (importTables.rows.length === 0) {
    throw new Error("migrations_did_not_create_tables");
  }
  const observability =
    options.observability ??
    createObservability({
      serviceName: options.serviceName ?? "reference-api",
      environment: "test",
      logs: { level: "silent" },
      contextPolicy: {
        propertyAllowlist: new Set(["path", "method", "job_id"]),
      },
    });
  return {
    client,
    db,
    clock,
    apiKeyPepper: options.apiKeyPepper ?? "test-pepper-please-rotate",
    billing,
    serviceName: options.serviceName ?? "reference-api",
    databaseReady: true,
    logger: options.logger ?? observability.logger,
    observability,
    auth,
    authServer,
    async close() {
      await new Promise<void>((resolve) => {
        if (!authServer) {
          resolve();
          return;
        }
        authServer.close(() => resolve());
      });
      await client.close();
    },
  };
}

/**
 * Production runtime. Migrations are deliberately not run here: the
 * application owns migration generation/deployment and must start only after
 * its schema has been applied.
 */
export async function createPostgresRuntime(options: {
  databaseUrl: string;
  clock?: Clock;
  apiKeyPepper: string;
  serviceName?: string;
  publicApiUrl: string;
  webOrigin?: string;
  logger?: Logger;
  observability?: Observability;
  authSecret: string;
}): Promise<Runtime> {
  const client = new Pool({ connectionString: options.databaseUrl });
  await client.query("select 1");
  const db = drizzlePostgres(client, {
    schema: { ...schema, ...billingSchema },
  }) as unknown as AppDb;
  const clock = options.clock ?? systemClock;
  const billing = composeBilling(db, clock);
  const auth = createReferenceAuth({
    db,
    publicApiUrl: options.publicApiUrl,
    webOrigin: options.webOrigin,
    secret: options.authSecret,
  });
  const observability =
    options.observability ??
    createObservability({
      serviceName: options.serviceName ?? "reference-api",
      environment: "production",
      contextPolicy: {
        propertyAllowlist: new Set(["path", "method", "job_id"]),
      },
    });
  return {
    client,
    db,
    clock,
    apiKeyPepper: options.apiKeyPepper,
    billing,
    serviceName: options.serviceName ?? "reference-api",
    databaseReady: true,
    logger: options.logger ?? observability.logger,
    observability,
    auth,
    authServer: null,
    async close() {
      await client.end();
    },
  };
}

export function freezeRuntimeClock(at: Date): Clock {
  return frozenClock(at);
}

export type { BillingBundle };
