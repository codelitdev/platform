import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AuthenticatedIdentity, AuthenticationResult } from "./types";
import {
  type VerifyOAuthAccessTokenOptions,
  validateOAuthVerificationOptions,
  verifyOAuthAccessToken,
} from "./verify-access-token";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedIdentity;
    }
  }
}

export interface CreateOAuthBearerMiddlewareOptions
  extends VerifyOAuthAccessTokenOptions {
  resourceMetadataUrl?: string;
  verifyAccessToken?: (
    options: VerifyOAuthAccessTokenOptions,
    token: string,
  ) => Promise<AuthenticationResult>;
}

function setBearerChallenge(response: Response, resourceMetadataUrl?: string) {
  if (resourceMetadataUrl) {
    response.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${resourceMetadataUrl}"`,
    );
    return;
  }
  response.setHeader("WWW-Authenticate", "Bearer");
}

function sendAuthenticationError(
  response: Response,
  result: Exclude<AuthenticationResult, { status: "authenticated" }>,
  resourceMetadataUrl?: string,
) {
  if (result.status === "unavailable") {
    response.status(503).json({ error: "authentication_unavailable" });
    return;
  }
  setBearerChallenge(response, resourceMetadataUrl);
  if (result.status === "invalid_token") {
    response.status(401).json({
      error: "invalid_token",
      error_description: "The access token is invalid or expired",
    });
    return;
  }
  response.status(401).json({
    error: "unauthorized",
    error_description: "A Bearer access token is required",
  });
}

function bearerToken(request: Request): string | null {
  const value = request.headers.authorization;
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function createOAuthBearerMiddleware(
  options: CreateOAuthBearerMiddlewareOptions,
): RequestHandler {
  const { verifyAccessToken = verifyOAuthAccessToken, ...verificationOptions } =
    options;
  validateOAuthVerificationOptions(verificationOptions);
  if (options.resourceMetadataUrl) {
    let metadataUrl: URL;
    try {
      metadataUrl = new URL(options.resourceMetadataUrl);
    } catch {
      throw new Error("resourceMetadataUrl must be an absolute URL");
    }
    if (!["http:", "https:"].includes(metadataUrl.protocol)) {
      throw new Error("resourceMetadataUrl must use http or https");
    }
    if (process.env.NODE_ENV === "production" && metadataUrl.protocol !== "https:") {
      throw new Error("resourceMetadataUrl must use https in production");
    }
  }
  return async function oauthBearerMiddleware(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    const token = bearerToken(request);
    if (!token) {
      sendAuthenticationError(
        response,
        { status: "missing" },
        options.resourceMetadataUrl,
      );
      return;
    }

    const result = await verifyAccessToken(verificationOptions, token);
    if (result.status !== "authenticated") {
      sendAuthenticationError(response, result, options.resourceMetadataUrl);
      return;
    }
    request.auth = result.identity;
    next();
  };
}
