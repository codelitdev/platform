import { contract } from "@__PRODUCT_SLUG__/api-contract";
import { createOAuthPagesRouter } from "@codelitdev/oauth-server-kit/express";
import { createMcpOAuthDiscoveryRoutes } from "@codelitdev/oauth-server-kit/mcp";
import { readOrCreateRequestId } from "@codelitdev/platform";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { toNodeHandler } from "better-auth/node";
import express, { type Express } from "express";
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
    // response so ts-rest and the fallback dispatcher audit the same value.
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
  app.use(express.json({ limit: "32kb" }));

  const server = initServer();
  const forward = async (input: {
    req: {
      method: string;
      path: string;
      headers: Record<string, string | string[] | undefined>;
      body?: unknown;
    };
    res: { setHeader(name: string, value: string): void };
  }) => {
    const response = await dispatch(deps, {
      method: input.req.method,
      path: input.req.path,
      headers: input.req.headers,
      body: input.req.body,
    });
    for (const [name, value] of Object.entries(response.headers ?? {})) {
      input.res.setHeader(name, value);
    }
    return { status: response.status, body: response.body } as never;
  };
  const router = server.router(contract, {
    health: forward,
    ready: forward,
    listNotes: forward,
    createNote: forward,
    updateNote: forward,
    deleteNote: forward,
    getEntitlement: forward,
    listTenants: forward,
    createTenant: forward,
    selectTenant: forward,
    listApiKeys: forward,
    createApiKey: forward,
    revokeApiKey: forward,
    createInvitation: forward,
    acceptInvitation: forward,
    revokeInvitation: forward,
  } as never);
  createExpressEndpoints(contract, router, app, {
    logInitialization: false,
    responseValidation: true,
    requestValidationErrorHandler: (_error, _req, res) => {
      res.status(400).json({
        code: "validation_failed",
        message: "The request body is invalid.",
      });
    },
  });
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
