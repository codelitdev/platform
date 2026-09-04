import { describe, expect, it } from "bun:test";
import { createMcpSessionStore } from "./sessions.js";

describe("MCP session store", () => {
  it("notifies consumers when expiry removes a session", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const expired: string[] = [];
    const store = createMcpSessionStore({
      ttlMs: 1,
      clock: { now: () => now },
      onExpire: (session) => expired.push(session.id),
    });
    const session = store.create("user_1");
    now = new Date("2026-01-01T00:00:00.001Z");
    expect(store.get(session.id)).toBeUndefined();
    expect(expired).toEqual([session.id]);
    expect(store.size()).toBe(0);
  });
});
