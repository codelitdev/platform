import {
    oauthProviderAuthServerMetadata,
    oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import {
    Router,
    type NextFunction,
    type Request as ExpressRequest,
    type RequestHandler,
    type Response as ExpressResponse,
} from "express";
import type { OAuthResourceClient } from "./types";

export interface BetterAuthMetadataApi {
    options: {
        baseURL?: string;
        basePath?: string;
    };
    api: {
        getOAuthServerConfig: (...args: never[]) => unknown;
        getOpenIdConfig: (...args: never[]) => unknown;
    };
}

export interface CreateMcpOAuthDiscoveryRoutesOptions {
    auth: BetterAuthMetadataApi;
    oauthResourceClient: OAuthResourceClient;
    resourceUrl: string;
    scopesSupported: readonly string[];
    allowedOrigins: readonly string[] | "*";
}

type NormalizedOptions = Omit<
    CreateMcpOAuthDiscoveryRoutesOptions,
    "resourceUrl" | "scopesSupported" | "allowedOrigins"
> & {
    resourceUrl: string;
    scopesSupported: string[];
    allowedOrigins: Set<string> | "*";
    authorizationServerUrl: string;
    authorizationServerPath: string;
};

function normalizeOptions(
    options: CreateMcpOAuthDiscoveryRoutesOptions,
): NormalizedOptions {
    let resource: URL;
    try {
        resource = new URL(options.resourceUrl);
    } catch {
        throw new Error("resourceUrl must be an absolute URL");
    }
    if (!["http:", "https:"].includes(resource.protocol)) {
        throw new Error("resourceUrl must use http or https");
    }
    if (
        resource.username ||
        resource.password ||
        resource.search ||
        resource.hash
    ) {
        throw new Error(
            "resourceUrl must not include credentials, query, or fragment",
        );
    }
    if (
        process.env.NODE_ENV === "production" &&
        resource.protocol !== "https:"
    ) {
        throw new Error("resourceUrl must use https in production");
    }
    if (!options.auth.options.baseURL) {
        throw new Error("auth.options.baseURL must be configured");
    }
    let authorizationServerBase: URL;
    try {
        authorizationServerBase = new URL(options.auth.options.baseURL);
    } catch {
        throw new Error("auth.options.baseURL must be an absolute URL");
    }
    if (!["http:", "https:"].includes(authorizationServerBase.protocol)) {
        throw new Error("auth.options.baseURL must use http or https");
    }
    if (
        authorizationServerBase.username ||
        authorizationServerBase.password ||
        authorizationServerBase.pathname !== "/" ||
        authorizationServerBase.search ||
        authorizationServerBase.hash
    ) {
        throw new Error("auth.options.baseURL must be an origin URL");
    }
    if (
        process.env.NODE_ENV === "production" &&
        authorizationServerBase.protocol !== "https:"
    ) {
        throw new Error("auth.options.baseURL must use https in production");
    }
    const rawAuthorizationServerPath =
        options.auth.options.basePath || "/api/auth";
    if (
        !rawAuthorizationServerPath.startsWith("/") ||
        rawAuthorizationServerPath.startsWith("//") ||
        rawAuthorizationServerPath.includes("?") ||
        rawAuthorizationServerPath.includes("#") ||
        /\s/.test(rawAuthorizationServerPath)
    ) {
        throw new Error("auth.options.basePath must be an absolute path");
    }
    const authorizationServerPath =
        rawAuthorizationServerPath === "/"
            ? ""
            : rawAuthorizationServerPath.replace(/\/+$/, "");
    const authorizationServerUrl = `${authorizationServerBase
        .toString()
        .replace(/\/$/, "")}${authorizationServerPath}`;
    const scopesSupported = [
        ...new Set(
            options.scopesSupported
                .map((scope) => scope.trim())
                .filter(Boolean),
        ),
    ];
    const allowedOrigins =
        options.allowedOrigins === "*"
            ? "*"
            : new Set(
                  options.allowedOrigins.map((origin) => {
                      let url: URL;
                      try {
                          url = new URL(origin);
                      } catch {
                          throw new Error(
                              "allowedOrigins must contain absolute origins",
                          );
                      }
                      if (!["http:", "https:"].includes(url.protocol)) {
                          throw new Error(
                              "allowedOrigins must use http or https",
                          );
                      }
                      if (
                          url.username ||
                          url.password ||
                          url.pathname !== "/" ||
                          url.search ||
                          url.hash
                      ) {
                          throw new Error(
                              "allowedOrigins must contain origins without paths",
                          );
                      }
                      if (
                          process.env.NODE_ENV === "production" &&
                          url.protocol !== "https:"
                      ) {
                          throw new Error(
                              "allowedOrigins must use https in production",
                          );
                      }
                      return url.origin;
                  }),
              );
    if (allowedOrigins !== "*" && allowedOrigins.size === 0) {
        throw new Error("allowedOrigins must not be empty");
    }
    return {
        ...options,
        resourceUrl: resource.toString(),
        scopesSupported,
        allowedOrigins,
        authorizationServerUrl,
        authorizationServerPath,
    };
}

function applyCors(
    request: { headers: { origin?: string } },
    response: {
        header(name: string, value: string): unknown;
    },
    allowedOrigins: Set<string> | "*",
): boolean {
    const origin = request.headers.origin;
    if (allowedOrigins === "*") {
        response.header("Access-Control-Allow-Origin", "*");
    } else if (origin && allowedOrigins.has(origin)) {
        response.header("Access-Control-Allow-Origin", origin);
        response.header("Vary", "Origin");
    } else if (origin) {
        return false;
    }
    response.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.header(
        "Access-Control-Allow-Headers",
        "Accept, Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
    );
    response.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
    return true;
}

async function sendFetchResponse(
    response: {
        status(code: number): unknown;
        setHeader(name: string, value: string): unknown;
        send(body: string): unknown;
    },
    fetchResponse: Response,
) {
    response.status(fetchResponse.status);
    fetchResponse.headers.forEach((value, key) =>
        response.setHeader(key, value),
    );
    response.send(await fetchResponse.text());
}

function asyncHandler(
    handler: (
        request: ExpressRequest,
        response: ExpressResponse,
    ) => Promise<void>,
): RequestHandler {
    return (request, response, next: NextFunction) => {
        void handler(request, response).catch(next);
    };
}

export function createMcpOAuthDiscoveryRoutes(
    rawOptions: CreateMcpOAuthDiscoveryRoutesOptions,
): Router {
    const options = normalizeOptions(rawOptions);
    const router = Router();
    const authorizationServerPaths = new Set([
        "/.well-known/oauth-authorization-server",
        `/.well-known/oauth-authorization-server${options.authorizationServerPath}`,
    ]);
    const openIdPaths = new Set([
        "/.well-known/openid-configuration",
        `${options.authorizationServerPath}/.well-known/openid-configuration`,
    ]);
    const resourcePath = new URL(options.resourceUrl).pathname.replace(
        /\/$/,
        "",
    );
    const protectedResourcePaths = new Set([
        "/.well-known/oauth-protected-resource",
        `/.well-known/oauth-protected-resource${resourcePath}`,
    ]);
    const metadataPaths = new Set([
        ...authorizationServerPaths,
        ...openIdPaths,
        ...protectedResourcePaths,
    ]);

    router.use((request, response, next) => {
        if (!metadataPaths.has(request.path)) {
            next();
            return;
        }
        if (!applyCors(request, response, options.allowedOrigins)) {
            response.status(403).json({ error: "origin_not_allowed" });
            return;
        }
        if (request.method === "OPTIONS") {
            response.status(204).end();
            return;
        }
        next();
    });

    async function authorizationServerMetadata(
        request: ExpressRequest,
        response: ExpressResponse,
    ) {
        const handler = oauthProviderAuthServerMetadata(options.auth);
        await sendFetchResponse(
            response,
            await handler(
                new Request(
                    `${request.protocol}://${request.get("host")}${request.originalUrl}`,
                    { headers: request.headers as HeadersInit },
                ),
            ),
        );
    }

    async function openIdMetadata(
        request: ExpressRequest,
        response: ExpressResponse,
    ) {
        const handler = oauthProviderOpenIdConfigMetadata(options.auth);
        await sendFetchResponse(
            response,
            await handler(
                new Request(
                    `${request.protocol}://${request.get("host")}${request.originalUrl}`,
                    { headers: request.headers as HeadersInit },
                ),
            ),
        );
    }

    for (const path of authorizationServerPaths) {
        router.get(path, asyncHandler(authorizationServerMetadata));
    }
    for (const path of openIdPaths) {
        router.get(path, asyncHandler(openIdMetadata));
    }

    async function protectedResourceMetadata(
        _request: ExpressRequest,
        response: ExpressResponse,
    ) {
        const metadata = await options.oauthResourceClient
            .getActions()
            .getProtectedResourceMetadata(
                {
                    resource: options.resourceUrl,
                    authorization_servers: [options.authorizationServerUrl],
                    scopes_supported: options.scopesSupported,
                    bearer_methods_supported: ["header"],
                },
            );
        response.json(metadata);
    }

    for (const path of protectedResourcePaths) {
        router.get(path, asyncHandler(protectedResourceMetadata));
    }

    return router;
}
