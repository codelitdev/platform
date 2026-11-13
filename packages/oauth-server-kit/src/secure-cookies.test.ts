import { describe, expect, it } from "bun:test";
import { betterAuth } from "better-auth";
import {
  secureCookieOptions,
  secureEmailAndPasswordOptions,
  secureSessionOptions,
  sessionCookieName,
} from "./secure-cookies";

describe("secureCookieOptions", () => {
  it("uses __Host- with Secure and Path=/ over https", () => {
    const advanced = secureCookieOptions({
      baseURL: "https://api.example.com",
      cookiePrefix: "acme",
    });
    expect(advanced).toEqual({
      cookiePrefix: "__Host-acme",
      useSecureCookies: false,
      defaultCookieAttributes: { secure: true, path: "/" },
    });
    expect(sessionCookieName(advanced)).toBe("__Host-acme.session_token");
  });

  it("keeps __Secure- with cross-subdomain cookies over https", () => {
    const advanced = secureCookieOptions({
      baseURL: "https://api.example.com",
      cookiePrefix: "acme",
      crossSubDomainCookies: { enabled: true, domain: "example.com" },
    });
    expect(advanced).toEqual({
      cookiePrefix: "acme",
      useSecureCookies: true,
      crossSubDomainCookies: { enabled: true, domain: "example.com" },
    });
    expect(sessionCookieName(advanced)).toBe("__Secure-acme.session_token");
  });

  it("treats disabled cross-subdomain cookies as plain https", () => {
    expect(
      secureCookieOptions({
        baseURL: "https://api.example.com",
        cookiePrefix: "acme",
        crossSubDomainCookies: { enabled: false },
      }).cookiePrefix,
    ).toBe("__Host-acme");
  });

  it("only sets the prefix over http", () => {
    const advanced = secureCookieOptions({
      baseURL: "http://127.0.0.1:4000",
      cookiePrefix: "acme",
    });
    expect(advanced).toEqual({ cookiePrefix: "acme" });
    expect(sessionCookieName(advanced)).toBe("acme.session_token");
  });

  it("adds the client IP header for every mode", () => {
    for (const baseURL of ["http://localhost:3000", "https://a.example.com"]) {
      expect(
        secureCookieOptions({
          baseURL,
          cookiePrefix: "acme",
          clientIpHeader: "X-Client-IP",
        }).ipAddress,
      ).toEqual({ ipAddressHeaders: ["x-client-ip"] });
    }
  });

  it("validates its input", () => {
    const ok = { baseURL: "https://a.example.com", cookiePrefix: "acme" };
    expect(() => secureCookieOptions({ ...ok, baseURL: "api.example.com" })).toThrow(
      "absolute URL",
    );
    expect(() =>
      secureCookieOptions({ ...ok, baseURL: "ftp://a.example.com" }),
    ).toThrow("http or https");
    expect(() => secureCookieOptions({ ...ok, cookiePrefix: "" })).toThrow(
      "cookiePrefix",
    );
    expect(() => secureCookieOptions({ ...ok, cookiePrefix: "a b" })).toThrow(
      "cookiePrefix",
    );
    expect(() => secureCookieOptions({ ...ok, cookiePrefix: "a;b" })).toThrow(
      "cookiePrefix",
    );
    expect(() => secureCookieOptions({ ...ok, cookiePrefix: "__Host-acme" })).toThrow(
      "__Host-",
    );
    expect(() => secureCookieOptions({ ...ok, clientIpHeader: " " })).toThrow(
      "clientIpHeader",
    );
  });
});

describe("secureSessionOptions", () => {
  it("disables the cookie cache", () => {
    expect(secureSessionOptions()).toEqual({ cookieCache: { enabled: false } });
  });
});

function liveAuth(
  baseURL: string,
  advancedInput: Parameters<typeof secureCookieOptions>[0],
) {
  const advanced = secureCookieOptions(advancedInput);
  const auth = betterAuth({
    baseURL,
    secret: "test-secret-that-is-at-least-thirty-two-characters-long",
    emailAndPassword: { enabled: true },
    advanced,
    session: secureSessionOptions(),
  });
  return { auth, advanced };
}

async function signUp(auth: ReturnType<typeof liveAuth>["auth"], email: string) {
  return auth.api.signUpEmail({
    body: { name: "Tester", email, password: "correct-horse-battery" },
    asResponse: true,
  });
}

describe("live Better Auth round trip", () => {
  it("issues and reads back a __Host- session cookie over https", async () => {
    const baseURL = "https://api.example.com";
    const { auth, advanced } = liveAuth(baseURL, { baseURL, cookiePrefix: "acme" });
    const response = await signUp(auth, "host@example.com");
    expect(response.ok).toBe(true);
    const cookies = response.headers.getSetCookie();
    for (const cookie of cookies) {
      expect(cookie.startsWith("__Host-acme.")).toBe(true);
      expect(cookie).not.toContain("__Secure-");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("Path=/");
      expect(cookie).not.toMatch(/Domain=/i);
    }
    const names = cookies.map((c) => c.split("=", 1)[0]);
    expect(names).toContain(sessionCookieName(advanced));
    expect(names).not.toContain("__Host-acme.session_data");
    const session = cookies
      .map((c) => c.split(";", 1)[0]!)
      .find((c) => c.startsWith(`${sessionCookieName(advanced)}=`))!;
    const resolved = await auth.api.getSession({
      headers: new Headers({ cookie: session }),
    });
    expect(resolved?.user.email).toBe("host@example.com");
    expect(resolved?.session.createdAt).toBeInstanceOf(Date);
    // A plain-name cookie planted over https is not a session.
    const planted = await auth.api.getSession({
      headers: new Headers({ cookie: session.replace("__Host-acme.", "acme.") }),
    });
    expect(planted).toBeNull();
  });

  it("issues a __Secure- cookie with a Domain in cross-subdomain mode", async () => {
    const baseURL = "https://api.example.com";
    const { auth, advanced } = liveAuth(baseURL, {
      baseURL,
      cookiePrefix: "acme",
      crossSubDomainCookies: { enabled: true, domain: "example.com" },
    });
    const response = await signUp(auth, "cross@example.com");
    const session = response.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${sessionCookieName(advanced)}=`))!;
    expect(session).toBeDefined();
    expect(session.startsWith("__Secure-acme.session_token=")).toBe(true);
    expect(session).toMatch(/Domain=example\.com/i);
    expect(session).toContain("Secure");
  });

  it("keeps the plain name over http", async () => {
    const baseURL = "http://127.0.0.1:4000";
    const { auth, advanced } = liveAuth(baseURL, { baseURL, cookiePrefix: "acme" });
    const response = await signUp(auth, "http@example.com");
    const names = response.headers.getSetCookie().map((c) => c.split("=", 1)[0]);
    expect(names).toContain(sessionCookieName(advanced));
    expect(names).toContain("acme.session_token");
    expect(names.some((n) => n!.startsWith("__"))).toBe(false);
  });

  it("rejects a revoked session on the very next request", async () => {
    const baseURL = "http://127.0.0.1:4000";
    const { auth, advanced } = liveAuth(baseURL, { baseURL, cookiePrefix: "acme" });
    const response = await signUp(auth, "revoke@example.com");
    const cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(";", 1)[0]!)
      .find((c) => c.startsWith(`${sessionCookieName(advanced)}=`))!;
    const headers = () => new Headers({ cookie });
    // Prime any would-be cache with a successful read first.
    expect((await auth.api.getSession({ headers: headers() }))?.user.email).toBe(
      "revoke@example.com",
    );
    await auth.api.signOut({ headers: headers() });
    expect(await auth.api.getSession({ headers: headers() })).toBeNull();
  });
});

describe("secureEmailAndPasswordOptions", () => {
  const secret = "test-secret-that-is-at-least-thirty-two-characters-long";
  const body = {
    name: "Tester",
    email: "pw@example.com",
    password: "correct-horse-battery",
  };

  it("keeps password sign-up off by default", async () => {
    expect(secureEmailAndPasswordOptions()).toEqual({ enabled: false });
    const auth = betterAuth({
      baseURL: "https://api.example.com",
      secret,
      emailAndPassword: secureEmailAndPasswordOptions(),
    });
    const response = await auth.api.signUpEmail({ body, asResponse: true });
    expect(response.ok).toBe(false);
  });

  it("requires a verified email before sign-in when a product opts in", async () => {
    expect(secureEmailAndPasswordOptions({ enabled: true })).toEqual({
      enabled: true,
      requireEmailVerification: true,
    });
    const auth = betterAuth({
      baseURL: "https://api.example.com",
      secret,
      emailAndPassword: secureEmailAndPasswordOptions({ enabled: true }),
    });
    const signedUp = await auth.api.signUpEmail({ body, asResponse: true });
    // Signing up must not hand out a session for an unverified address.
    expect(
      signedUp.headers
        .getSetCookie()
        .some((c) => c.includes("session_token=") && !c.includes("session_token=;")),
    ).toBe(false);
    const signIn = await auth.api.signInEmail({
      body: { email: body.email, password: body.password },
      asResponse: true,
    });
    expect(signIn.ok).toBe(false);
  });
});
