import { contract } from "@__PRODUCT_SLUG__/api-contract";
import { createOAuthPagesRouter } from "@codelitdev/oauth-server-kit/express";
import { createMcpOAuthDiscoveryRoutes } from "@codelitdev/oauth-server-kit/mcp";
import {
  healthReport,
  readinessReport,
  readOrCreateRequestId,
} from "@codelitdev/platform";
import {
  encodePlatformErrorBody,
  isPublicErrorBody,
  listOperationIds,
} from "@codelitdev/platform/rest";
import { OpenAPIHandler } from "@orpc/openapi/node";
import { implement, ORPCError, onError } from "@orpc/server";
import { toNodeHandler } from "better-auth/node";
import express, { type Express, type RequestHandler } from "express";
import swaggerUi from "swagger-ui-express";
import { AUTH_BASE_PATH, MCP_SCOPES_SUPPORTED } from "./auth/options.js";
import type { DispatchDeps } from "./deps.js";
import { dispatch } from "./dispatch.js";

export function createExpressApp(deps: DispatchDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  const buckets = new Map<string, { window: number; count: number }>();
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    const requestId = readOrCreateRequestId(
      typeof req.headers["x-request-id"] === "string"
        ? req.headers["x-request-id"]
        : undefined,
      deps.clock,
    );
    // Keep the generated correlation ID on the request as well as the
    // response so the oRPC handler and the fallback dispatcher audit the same value.
    req.headers["x-request-id"] = requestId;
    res.setHeader("X-Request-ID", requestId);
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const window = Math.floor(now / 60_000);
    if (buckets.size > 10_000) buckets.clear();
    const current = buckets.get(key);
    if (!current || current.window !== window) {
      buckets.set(key, { window, count: 1 });
    } else if (current.count >= 120) {
      res.status(429).json({
        code: "rate_limited",
        message: "The request was rate limited.",
      });
      return;
    } else {
      current.count += 1;
    }
    next();
  });
  app.use(
    createMcpOAuthDiscoveryRoutes({
      auth: deps.auth.auth,
      oauthResourceClient: deps.auth.oauthResourceClient,
      resourceUrl: deps.auth.mcpResource,
      scopesSupported: [...MCP_SCOPES_SUPPORTED],
      allowedOrigins: "*",
    }),
  );
  app.all(`${AUTH_BASE_PATH}/*`, toNodeHandler(deps.auth.auth));
  app.use(
    createOAuthPagesRouter({
      appName: "__PRODUCT_NAME__",
      authBasePath: AUTH_BASE_PATH,
      allowedRedirectOrigins: [new URL(deps.auth.webOrigin).origin],
      defaultRedirectUrl: `${deps.auth.webOrigin}/`,
      loginMethods: [{ type: "email-otp" }],
    }),
  );
  // The Swagger typings can resolve a separate Express type version in a
  // freshly generated workspace, so normalize its handlers at this boundary.
  app.use(
    "/docs",
    ...(swaggerUi.serve as unknown as RequestHandler[]),
    swaggerUi.setup(undefined, {
      explorer: true,
      swaggerUrl: "/openapi.json",
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: "none",
        defaultModelsExpandDepth: -1,
      },
    }) as unknown as RequestHandler,
  );
  app.use(express.json({ limit: "32kb" }));

  app.use(createRestHandler(deps));
  app.use(async (req, res, next) => {
    try {
      const requestId = readOrCreateRequestId(
        typeof req.headers["x-request-id"] === "string"
          ? req.headers["x-request-id"]
          : undefined,
        deps.clock,
      );
      res.setHeader("X-Request-ID", requestId);
      const response = await dispatch(deps, {
        method: req.method,
        path: req.path,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: req.body,
      });
      for (const [name, value] of Object.entries(response.headers ?? {})) {
        res.setHeader(name, value);
      }
      if (response.body === null || response.body === undefined) {
        res.status(response.status).end();
        return;
      }
      res.status(response.status).json(response.body);
    } catch (error) {
      next(error);
    }
  });
  app.use(
    (
      error: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      deps.observability?.captureException({
        error,
        source: "express",
        context: { method: req.method, path: req.path },
      });
      if (res.headersSent) {
        next(error);
        return;
      }
      const isSyntax = error instanceof SyntaxError;
      res.status(isSyntax ? 400 : 500).json({
        code: isSyntax ? "validation_failed" : "internal_error",
        message: isSyntax
          ? "The request body is invalid."
          : "The request could not be completed.",
      });
    },
  );
  return app;
}

type RestContext = { req: express.Request; res: express.Response };

/**
 * Serves the oRPC contract. oRPC validates input and output against the
 * contract; the handlers forward to `dispatch`, which owns authentication,
 * tenancy and the product logic for both REST and the fallback routes.
 * Requests the contract does not match fall through to the next middleware.
 */
function createRestHandler(deps: DispatchDeps): RequestHandler {
  const os = implement(contract).$context<RestContext>();
  const forward = async ({ context }: { context: RestContext }) => {
    const { req, res } = context;
    const response = await dispatch(deps, {
      method: req.method,
      path: req.path,
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: req.body,
    });
    for (const [name, value] of Object.entries(response.headers ?? {})) {
      res.setHeader(name, value);
    }
    if (response.status >= 400) {
      if (!isPublicErrorBody(response.body)) {
        throw new Error(`dispatch returned a non-platform error (${response.status})`);
      }
      throw new ORPCError(response.body.code, {
        status: response.status,
        data: { details: response.body.details },
      });
    }
    return (response.body ?? undefined) as never;
  };
  const handlers: Record<string, unknown> = {};
  for (const id of listOperationIds(contract)) {
    handlers[id] = os[id as keyof typeof contract].handler(forward as never);
  }
  handlers.health = os.health.handler(() => healthReport(deps.serviceName, deps.clock));
  handlers.ready = os.ready.handler(() => {
    const report = readinessReport([{ name: "database", ready: deps.databaseReady }]);
    if (report.status !== "ready") {
      throw new ORPCError("not_ready", { status: 503, data: report });
    }
    return report;
  });
  const router = os.router(handlers as never);
  const handler = new OpenAPIHandler(router, {
    customErrorResponseBodyEncoder: encodePlatformErrorBody,
    interceptors: [
      // Expected 4xx results are thrown as ORPCError; report only failures,
      // including output that does not match the contract.
      onError((error) => {
        if (error instanceof ORPCError && error.status < 500) return;
        deps.observability?.captureException({ error, source: "rest" });
      }),
    ],
  });
  return async (req, res, next) => {
    try {
      const { matched } = await handler.handle(req, res, {
        context: { req, res },
      });
      if (!matched) next();
    } catch (error) {
      next(error);
    }
  };
}
