import { describe, expect, it, vi } from "bun:test";
import {
  type BetterAuthSessionApi,
  createOAuthProviderOptions,
  resolveBetterAuthSession,
} from "./better-auth";

function sessionAuth(value: unknown, rejects = false): BetterAuthSessionApi {
  return {
    api: {
      getSession: rejects
        ? vi.fn().mockRejectedValue(value)
        : vi.fn().mockResolvedValue(value),
    },
  } as BetterAuthSessionApi;
}

describe("resolveBetterAuthSession", () => {
  it("maps a Better Auth session to a neutral identity", async () => {
    const auth = sessionAuth({
      user: { id: "user_1", email: "a@example.com", name: "A" },
      session: {
        id: "session_1",
        expiresAt: new Date(Date.now() + 1000),
      },
    });
    const headers = new Headers({ cookie: "session=value" });
    await expect(
      resolveBetterAuthSession({ auth, issuer: "https://auth.example.com/" }, headers),
    ).resolves.toEqual({
      status: "authenticated",
      identity: {
        method: "session",
        issuer: "https://auth.example.com",
        subject: "user_1",
        email: "a@example.com",
        name: "A",
        scopes: [],
      },
    });
    expect(auth.api.getSession).toHaveBeenCalledWith({ headers });
  });

  it.each([null, {}, { user: {} }, { user: { id: "u" } }])(
    "returns missing for an absent or malformed session",
    async (session) => {
      await expect(
        resolveBetterAuthSession(
          {
            auth: sessionAuth(session),
            issuer: "https://auth.example.com",
          },
          new Headers(),
        ),
      ).resolves.toEqual({ status: "missing" });
    },
  );

  it("returns unavailable when session storage fails", async () => {
    const cause = new Error("database offline");
    await expect(
      resolveBetterAuthSession(
        {
          auth: sessionAuth(cause, true),
          issuer: "https://auth.example.com",
        },
        new Headers(),
      ),
    ).resolves.toEqual({ status: "unavailable", cause });
  });

  it.each([
    ["relative", "issuer must be an absolute URL"],
    ["file:///tmp/auth", "issuer must use http or https"],
  ])("validates the issuer before resolving", async (issuer, message) => {
    await expect(
      resolveBetterAuthSession({ auth: sessionAuth(null), issuer }, new Headers()),
    ).rejects.toThrow(message);
  });

  it("requires an HTTPS session issuer in production", async () => {
    process.env.NODE_ENV = "production";
    try {
      await expect(
        resolveBetterAuthSession(
          {
            auth: sessionAuth(null),
            issuer: "http://auth.example.com",
          },
          new Headers(),
        ),
      ).rejects.toThrow("issuer must use https in production");
    } finally {
      delete process.env.NODE_ENV;
    }
  });
});

describe("createOAuthProviderOptions", () => {
  it("creates secure defaults and normalizes lists", () => {
    expect(
      createOAuthProviderOptions({
        loginPage: "/oauth/login",
        consentPage: "https://auth.example.com/oauth/consent",
        scopes: ["openid", "read", "read", " "],
        validAudiences: ["https://api.example.com", "https://api.example.com"],
      }),
    ).toEqual({
      loginPage: "/oauth/login",
      consentPage: "https://auth.example.com/oauth/consent",
      scopes: ["openid", "read"],
      resources: ["https://api.example.com"],
      clientRegistrationDefaultResources: ["https://api.example.com"],
      clientRegistrationAllowedResources: ["https://api.example.com"],
      allowDynamicClientRegistration: false,
      allowUnauthenticatedClientRegistration: false,
    });
  });

  it("maps explicitly opted-in DCR and registration scopes", () => {
    expect(
      createOAuthProviderOptions({
        loginPage: "/login",
        consentPage: "/consent",
        scopes: ["openid", "read"],
        validAudiences: ["https://api.example.com"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedDynamicClientRegistration: true,
        clientRegistrationDefaultScopes: ["openid", "openid"],
        clientRegistrationAllowedScopes: ["read"],
      }),
    ).toMatchObject({
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultScopes: ["openid"],
      clientRegistrationAllowedScopes: ["read"],
      resources: ["https://api.example.com"],
      clientRegistrationDefaultResources: ["https://api.example.com"],
      clientRegistrationAllowedResources: ["https://api.example.com"],
    });
  });

  it.each([
    [
      {
        loginPage: "login",
        consentPage: "/c",
        scopes: ["a"],
        validAudiences: ["b"],
      },
      "loginPage must be an absolute URL or absolute path",
    ],
    [
      {
        loginPage: "//evil.example.com",
        consentPage: "/c",
        scopes: ["a"],
        validAudiences: ["b"],
      },
      "loginPage must be an absolute URL or absolute path",
    ],
    [
      {
        loginPage: "/oauth/login path",
        consentPage: "/c",
        scopes: ["a"],
        validAudiences: ["b"],
      },
      "loginPage must be an absolute URL or absolute path",
    ],
    [
      {
        loginPage: "ftp://example.com/login",
        consentPage: "/c",
        scopes: ["a"],
        validAudiences: ["b"],
      },
      "loginPage must use http or https",
    ],
    [
      {
        loginPage: "/l",
        consentPage: "consent",
        scopes: ["a"],
        validAudiences: ["b"],
      },
      "consentPage must be an absolute URL or absolute path",
    ],
    [
      {
        loginPage: "/l",
        consentPage: "/c",
        scopes: [],
        validAudiences: ["b"],
      },
      "scopes must contain at least one value",
    ],
    [
      {
        loginPage: "/l",
        consentPage: "/c",
        scopes: ["a"],
        validAudiences: [],
      },
      "validAudiences must contain at least one value",
    ],
    [
      {
        loginPage: "/l",
        consentPage: "/c",
        scopes: ["a"],
        validAudiences: ["b"],
        allowUnauthenticatedDynamicClientRegistration: true,
      },
      "unauthenticated dynamic client registration requires dynamic client registration",
    ],
    [
      {
        loginPage: "/l",
        consentPage: "/c",
        scopes: ["a"],
        validAudiences: ["b"],
        clientRegistrationDefaultScopes: ["x"],
      },
      "clientRegistrationDefaultScopes contains unsupported scopes: x",
    ],
    [
      {
        loginPage: "/l",
        consentPage: "/c",
        scopes: ["a"],
        validAudiences: ["b"],
        clientRegistrationAllowedScopes: ["x"],
      },
      "clientRegistrationAllowedScopes contains unsupported scopes: x",
    ],
  ])("rejects invalid provider configuration", (input, message) => {
    expect(() => createOAuthProviderOptions(input)).toThrow(message);
  });

  it("requires HTTPS absolute hosted pages in production", () => {
    process.env.NODE_ENV = "production";
    try {
      expect(() =>
        createOAuthProviderOptions({
          loginPage: "http://auth.example.com/login",
          consentPage: "/consent",
          scopes: ["openid"],
          validAudiences: ["https://api.example.com"],
        }),
      ).toThrow("loginPage must use https in production");
    } finally {
      delete process.env.NODE_ENV;
    }
  });
});
