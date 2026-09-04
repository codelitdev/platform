import { createObservability } from "@codelitdev/observability";
import { createExpressApp } from "./express-app.js";
import { createPostgresRuntime } from "./runtime.js";
import { hasSeededWorld, seedWorld } from "./seed.js";

const port = Number(process.env.PORT ?? "4000");
const posthogApiKey = process.env.POSTHOG_API_KEY;
const posthogHost = process.env.POSTHOG_HOST;
const otlpEndpoint = process.env.OTLP_LOGS_ENDPOINT;
const otlpAuthorization = process.env.OTLP_LOGS_AUTHORIZATION;
const observability = createObservability({
  serviceName: "__PRODUCT_SLUG__-api",
  environment: process.env.NODE_ENV ?? "development",
  logs: {
    level: process.env.LOG_LEVEL ?? "info",
    ...(otlpEndpoint
      ? {
          otlp: {
            endpoint: otlpEndpoint,
            ...(otlpAuthorization
              ? { headers: { authorization: otlpAuthorization } }
              : {}),
          },
        }
      : {}),
  },
  ...(posthogApiKey
    ? {
        posthog: {
          apiKey: posthogApiKey,
          ...(posthogHost ? { host: posthogHost } : {}),
        },
      }
    : {}),
  contextPolicy: {
    propertyAllowlist: new Set(["path", "method", "job_id"]),
  },
});
const logger = observability.logger;

const publicApiUrl = process.env.PUBLIC_API_URL ?? `http://127.0.0.1:${port}`;
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const databaseUrl = process.env.DATABASE_URL;
const authSecret = process.env.AUTH_SECRET;
const apiKeyPepper = process.env.API_KEY_PEPPER;
if (!databaseUrl || !authSecret || !apiKeyPepper) {
  throw new Error("DATABASE_URL_AUTH_SECRET_AND_API_KEY_PEPPER_REQUIRED");
}
const runtime = await createPostgresRuntime({
  logger,
  observability,
  publicApiUrl,
  webOrigin,
  databaseUrl,
  authSecret,
  apiKeyPepper,
});

const app = createExpressApp(runtime);
const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
  const listening = app.listen(port, () => resolve(listening));
});
logger.info({ port }, "reference api listening");

if (process.env.SEED === "1") {
  if (await hasSeededWorld(runtime)) {
    logger.info("reference world already seeded; skipping seed");
  } else {
    const world = await seedWorld(runtime, runtime.clock);
    logger.info(
      {
        tenantA: world.tenantA.publicId,
        apiKeyHint: world.apiKeyA.publicId,
        note: world.noteA.publicId,
      },
      "seeded reference world",
    );
    process.stdout.write(
      `REFERENCE_SEED ${JSON.stringify({
        seeded: true,
        tenantA: world.tenantA.publicId,
        noteId: world.noteA.publicId,
      })}\n`,
    );
  }
}

const shutdown = () => {
  server.close(() => {
    void observability
      .shutdown(1000)
      .then(() => runtime.close())
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
