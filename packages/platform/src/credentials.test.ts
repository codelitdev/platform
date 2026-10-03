import { describe, expect, it } from "bun:test";
import {
  createSystemCredential,
  extractHttpCredentials,
  extractMcpCredentials,
  mapTransportAuthentication,
  selectHttpCredential,
  selectMcpCredential,
} from "./credentials.js";
import { createPlatformError, PLATFORM_ERROR_MESSAGES } from "./errors.js";

describe("credential extraction and transport mapping", () => {
  it("extracts each HTTP mechanism independently and never emits system", () => {
    const session = extractHttpCredentials({
      cookie: "better-auth.session_token=sess_1; other=1",
    });
    expect(session).toEqual([{ kind: "session", secret: "sess_1" }]);
    const secureSession = extractHttpCredentials({
      cookie: "__Secure-better-auth.session_token=secure_sess_1; other=1",
    });
    expect(secureSession).toEqual([{ kind: "session", secret: "secure_sess_1" }]);
    const oauth = extractHttpCredentials({
      authorization: "Bearer tok_1",
    });
    expect(oauth).toEqual([{ kind: "oauth", secret: "tok_1" }]);
    const apiKey = extractHttpCredentials({
      "x-api-key": "key_1",
    });
    expect(apiKey).toEqual([{ kind: "api_key", secret: "key_1" }]);
    const kinds = [...session, ...oauth, ...apiKey].map((item) => item.kind);
    expect(kinds).toEqual(["session", "oauth", "api_key"]);
  });

  it("returns credential_ambiguous when multiple HTTP mechanisms are supplied", () => {
    const selected = selectHttpCredential({
      cookie: "better-auth.session_token=sess_1",
      authorization: "Bearer tok_1",
    });
    expect(selected.kind).toBe("ambiguous");
    if (selected.kind !== "ambiguous") throw new Error("expected ambiguous");
    expect(selected.error.code).toBe("credential_ambiguous");
    expect(selected.error.message).toBe(PLATFORM_ERROR_MESSAGES.credential_ambiguous);
  });

  it("treats cookie plus API key as ambiguous", () => {
    const selected = selectHttpCredential({
      cookie: "better-auth.session_token=sess_1",
      "x-api-key": "key_1",
    });
    expect(selected.kind).toBe("ambiguous");
  });

  it("rejects a malformed Authorization header instead of falling back", () => {
    for (const authorization of [
      "Basic dXNlcjpwYXNz",
      "Bearer",
      "Bearer a b",
      "tok_1",
    ]) {
      for (const selected of [
        selectHttpCredential({
          authorization,
          cookie: "better-auth.session_token=sess_1",
        }),
        selectMcpCredential({ authorization, "x-api-key": "key_1" }),
      ]) {
        expect(selected.kind).toBe("malformed");
        if (selected.kind !== "malformed") throw new Error(authorization);
        expect(selected.error.code).toBe("unauthenticated");
      }
    }
    expect(selectHttpCredential({ authorization: "  " }).kind).toBe("absent");
    expect(selectHttpCredential({ authorization: "bearer tok_1" }).kind).toBe("single");
  });

  it("MCP accepts bearer or API key, not sessions, and never emits system", () => {
    const withCookie = extractMcpCredentials({
      cookie: "better-auth.session_token=sess_1",
    });
    expect(withCookie).toEqual([]);
    const selected = selectMcpCredential({
      authorization: "Bearer tok_1",
      "x-api-key": "key_1",
    });
    expect(selected.kind).toBe("ambiguous");
    const oauth = selectMcpCredential({ authorization: "Bearer tok_1" });
    expect(oauth).toEqual({
      kind: "single",
      credential: { kind: "oauth", secret: "tok_1" },
    });
    expect(
      extractMcpCredentials({ authorization: "Bearer tok" }).map((item) => item.kind),
    ).toEqual(["oauth"]);
  });

  it("maps absent on a protected route to unauthenticated", () => {
    const mapped = mapTransportAuthentication(
      { kind: "absent" },
      { transport: "http", publicRoute: false },
    );
    expect(mapped).toEqual({
      kind: "rejected",
      error: createPlatformError("unauthenticated"),
    });
  });

  it("allows absent on an explicit public route", () => {
    const mapped = mapTransportAuthentication(
      { kind: "absent" },
      { transport: "http", publicRoute: true },
    );
    expect(mapped).toEqual({ kind: "absent" });
  });

  it("never falls back when rejected", () => {
    const rejected = {
      kind: "rejected" as const,
      error: createPlatformError("unauthenticated"),
    };
    expect(
      mapTransportAuthentication(rejected, {
        transport: "http",
        publicRoute: true,
      }),
    ).toEqual(rejected);
    expect(
      mapTransportAuthentication(rejected, {
        transport: "mcp",
        publicRoute: false,
      }),
    ).toEqual(rejected);
  });

  it("rejects a system credential from HTTP/MCP mapping", () => {
    const mappedHttp = mapTransportAuthentication(
      {
        kind: "authenticated",
        principalId: "acct_1",
        credential: createSystemCredential("job_1"),
      },
      { transport: "http" },
    );
    expect(mappedHttp.kind).toBe("rejected");
    if (mappedHttp.kind !== "rejected") throw new Error("expected rejected");
    expect(mappedHttp.error.code).toBe("internal_error");
    const mappedMcp = mapTransportAuthentication(
      {
        kind: "authenticated",
        principalId: "acct_1",
        credential: { kind: "system" },
      },
      { transport: "mcp" },
    );
    expect(mappedMcp.kind).toBe("rejected");
    if (mappedMcp.kind !== "rejected") throw new Error("expected rejected");
    expect(mappedMcp.error.code).toBe("internal_error");
  });
});
