import { describe, expect, it } from "bun:test";
import { isRecentlyAuthenticated } from "./recent-authentication";
import type { AuthenticatedIdentity } from "./types";

const now = new Date("2026-03-01T12:00:00.000Z");
const maxAgeMs = 10 * 60 * 1000;

function session(authenticatedAt: Date): AuthenticatedIdentity {
  return {
    method: "session",
    issuer: "https://auth.example.com",
    subject: "u1",
    email: "a@example.com",
    scopes: [],
    authenticatedAt,
  };
}

describe("isRecentlyAuthenticated", () => {
  it("accepts a sign-in inside the window, including the boundary", () => {
    expect(
      isRecentlyAuthenticated(session(new Date(now.getTime() - 1000)), {
        maxAgeMs,
        now,
      }),
    ).toBe(true);
    expect(
      isRecentlyAuthenticated(session(new Date(now.getTime() - maxAgeMs)), {
        maxAgeMs,
        now,
      }),
    ).toBe(true);
  });

  it("refuses an older sign-in", () => {
    expect(
      isRecentlyAuthenticated(session(new Date(now.getTime() - maxAgeMs - 1)), {
        maxAgeMs,
        now,
      }),
    ).toBe(false);
  });

  it("tolerates small clock skew but not a far-future time", () => {
    expect(
      isRecentlyAuthenticated(session(new Date(now.getTime() + 5_000)), {
        maxAgeMs,
        now,
      }),
    ).toBe(true);
    expect(
      isRecentlyAuthenticated(session(new Date(now.getTime() + 10 * 60_000)), {
        maxAgeMs,
        now,
      }),
    ).toBe(false);
  });

  it("refuses an invalid time", () => {
    expect(isRecentlyAuthenticated(session(new Date("nope")), { maxAgeMs, now })).toBe(
      false,
    );
  });

  it("never counts OAuth identities", () => {
    expect(
      isRecentlyAuthenticated(
        {
          method: "oauth",
          issuer: "https://auth.example.com",
          subject: "u1",
          clientId: "c",
          scopes: [],
          audiences: [],
        },
        { maxAgeMs, now },
      ),
    ).toBe(false);
  });

  it("defaults now to the current time", () => {
    expect(isRecentlyAuthenticated(session(new Date()), { maxAgeMs })).toBe(true);
  });
});
