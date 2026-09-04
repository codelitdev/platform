import { createObservability, redactText } from "@codelitdev/observability";
import { eq } from "drizzle-orm";
import { runPlatformConformance } from "@codelitdev/platform-conformance";
import { contract } from "@reference-product/api-contract";
import { runBoundedMaintenance } from "./billing.js";
import { mcpFor } from "./dispatch.js";
import { createExpressApp } from "./express-app.js";
import type { Runtime } from "./runtime.js";
import type { SeededWorld } from "./seed.js";

type Principal = {
  id: string;
  sessionCookie: string;
  oauthToken?: string;
};

export function createReferenceConformanceAdapter(
  runtime: Runtime,
  world: SeededWorld,
) {
  const app = createExpressApp(runtime);
  let server: ReturnType<typeof app.listen> | undefined;
  let baseUrl: string | undefined;
  async function ensureServer(): Promise<string> {
    if (baseUrl) return baseUrl;
    server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("conformance_http_listener_unavailable");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    return baseUrl;
  }
  async function http(input: {
    method: string;
    path: string;
    headers: Record<string, string | undefined>;
    body?: unknown;
  }) {
    const url = `${await ensureServer()}${input.path}`;
    const headers = new Headers();
    for (const [name, value] of Object.entries(input.headers)) {
      if (value !== undefined) headers.set(name, value);
    }
    const hasBody = input.body !== undefined;
    if (hasBody && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const response = await fetch(url, {
      method: input.method,
      headers,
      ...(hasBody ? { body: JSON.stringify(input.body) } : {}),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return {
      status: response.status,
      body,
      headers: Object.fromEntries(response.headers.entries()),
    };
  }
  const owner: Principal = {
    id: world.owner.id,
    sessionCookie: world.owner.sessionCookie,
    oauthToken: world.owner.oauthToken,
  };
  const member: Principal = {
    id: world.member.id,
    sessionCookie: world.member.sessionCookie,
  };
  let checkoutAuditEffectId: string | undefined;
  return {
    async reset() {
      const schema = await import("./db/schema/index.js");
      await runtime.db.delete(schema.notes).where(
        // The conformance mutation has a fixed title and can be
        // removed without disturbing seeded product data.
        eq(schema.notes.title, "conformance note"),
      );
    },
    async close() {
      if (!server) return;
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
      server = undefined;
      baseUrl = undefined;
    },
    fixtures: {
      owner,
      member,
      outsider: {
        id: world.outsider.id,
        sessionCookie: world.outsider.sessionCookie,
      },
      tenantA: world.tenantA,
      tenantB: world.tenantB,
    },
    credentials: {
      async session(principal: Principal) {
        return { cookie: principal.sessionCookie };
      },
      async oauth(principal: Principal) {
        if (!principal.oauthToken) {
          throw new Error("oauth_token_missing");
        }
        return { authorization: `Bearer ${principal.oauthToken}` };
      },
      async apiKey() {
        return { apiKey: world.apiKeyA.raw };
      },
      async system() {
        return { kind: "system" as const };
      },
    },
    http,
    async mcp(input: {
      headers: Record<string, string | undefined>;
      tool: string;
      args?: unknown;
    }) {
      return http({
        method: "POST",
        path: "/mcp",
        headers: input.headers,
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: input.tool, arguments: input.args ?? {} },
        },
      });
    },
    async readAuditEvents() {
      const schema = await import("./db/schema/index.js");
      const rows = await runtime.db.select().from(schema.auditEvents);
      return rows.map((row) => ({
        action: row.action,
        resourceId: row.resourceId,
        actorId: row.actorId,
      }));
    },
    async openapiDocument() {
      const response = await http({
        method: "GET",
        path: "/openapi.json",
        headers: {},
      });
      const document = response.body as { paths: Record<string, unknown> };
      const contractOperationIds = Object.keys(contract);
      return { paths: document.paths, contractOperationIds };
    },
    observability: {
      async redact(secret: string) {
        return redactText(secret);
      },
      async disabledDoesNotThrow() {
        try {
          const obs = createObservability({
            serviceName: "reference-conformance",
            environment: "test",
            logs: { level: "silent" },
            contextPolicy: { propertyAllowlist: new Set(["path"]) },
          });
          obs.captureEvent({ event: "noop", source: "conformance" });
          obs.captureException({
            error: new Error("noop"),
            source: "conformance",
          });
          return { threw: false };
        } catch {
          return { threw: true };
        }
      },
      async failingSinkDoesNotFailRequest() {
        const obs = createObservability({
          serviceName: "reference-conformance",
          environment: "test",
          logs: { level: "silent" },
          contextPolicy: { propertyAllowlist: new Set(["path"]) },
          posthog: {
            apiKey: "phc_test",
            client: {
              captureException() {
                throw new Error("sink-down");
              },
              capture() {
                throw new Error("sink-down");
              },
              async shutdown() {
                throw new Error("sink-down");
              },
            },
          },
        });
        obs.captureEvent({ event: "x", source: "conformance" });
        obs.captureException({
          error: new Error("x"),
          source: "conformance",
        });
        const health = await http({
          method: "GET",
          path: "/health",
          headers: {},
        });
        return { requestStatus: health.status };
      },
    },
    billingComposition: {
      async generatedSchemaCurrent() {
        const tables = await (
          runtime.client as {
            query(sql: string): Promise<{ rows: Array<unknown> }>;
          }
        ).query(
          "select tablename from pg_tables where schemaname = 'public' and tablename like 'billing_%'",
        );
        const names = new Set(
          tables.rows.map((row) => (row as { tablename?: string }).tablename),
        );
        return [
          "billing_catalog_revisions",
          "billing_price_entries",
          "billing_checkout_attempts",
          "billing_subscriptions",
        ].every((name) => names.has(name));
      },
      async actionGrantRejected() {
        try {
          const now = runtime.clock.now();
          await runtime.billing.billing.startCheckout({
            grant: {
              grantId: "conformance-invalid-grant",
              actorId: world.owner.id,
              action: "checkout",
              target: { kind: "tenant", id: world.tenantB.id },
              issuedAt: now,
              expiresAt: new Date(now.getTime() + 60_000),
            },
            entity: { kind: "tenant", id: world.tenantB.id },
            payer: {
              id: world.owner.id,
              email: "owner@example.test",
              name: "Conformance owner",
            },
            offerKey: "pro_month",
            catalogRevision: 1,
            returnUrl: "https://app.test/billing",
          });
          return false;
        } catch {
          return true;
        }
      },
      async fakeProviderWorks() {
        const now = runtime.clock.now();
        const grant = runtime.billing.authorization.issue({
          grantId: "conformance-checkout-grant",
          actorId: world.owner.id,
          action: "checkout",
          target: { kind: "tenant", id: world.tenantB.id },
          issuedAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
        });
        const checkout = await runtime.billing.billing.startCheckout({
          grant,
          entity: { kind: "tenant", id: world.tenantB.id },
          payer: {
            id: world.owner.id,
            email: "owner@example.test",
            name: "Conformance owner",
          },
          offerKey: "pro_month",
          catalogRevision: 1,
          returnUrl: "https://app.test/billing",
        });
        checkoutAuditEffectId = `checkout:${checkout.attempt.id}:open`;
        return (
          checkout.attempt.status === "open" &&
          checkout.checkoutUrl.startsWith("https://")
        );
      },
      async maintenanceInvoked() {
        const processed = await runBoundedMaintenance(runtime.billing.billing);
        return processed >= 0;
      },
      async auditRecorded() {
        return Boolean(
          checkoutAuditEffectId &&
          runtime.billing.audit.records.some(
            (record) => record.effectId === checkoutAuditEffectId,
          ),
        );
      },
    },
    async shutdown() {
      const mcp = mcpFor(runtime);
      await mcp.shutdown();
      const after = await http({
        method: "POST",
        path: "/mcp",
        headers: {
          authorization: `Bearer ${world.owner.oauthToken}`,
          "x-tenant-id": world.tenantA.publicId,
        },
        body: { jsonrpc: "2.0", id: 99, method: "tools/list" },
      });
      return { mcpStatus: after.status };
    },
  };
}

export async function runReferenceConformance(
  runtime: Runtime,
  world: SeededWorld,
) {
  const adapter = createReferenceConformanceAdapter(runtime, world);
  try {
    return await runPlatformConformance(adapter, {
      mcp: true,
      billing: true,
      observability: true,
      openapi: true,
      shutdown: true,
    });
  } finally {
    await adapter.close?.();
  }
}
