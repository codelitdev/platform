import { createRequestId, type Clock, systemClock } from "@codelitdev/platform";

export type McpSession = {
  id: string;
  /** Principal that authenticated the initialize request. */
  ownerId?: string;
  createdAt: Date;
  expiresAt: Date;
};

export function createMcpSessionStore(options: {
  ttlMs?: number;
  clock?: Clock;
  onExpire?: (session: McpSession) => void;
}) {
  const ttlMs = options.ttlMs ?? 30 * 60 * 1000;
  const clock = options.clock ?? systemClock;
  const sessions = new Map<string, McpSession>();
  let closed = false;

  function purge(now: Date) {
    for (const [id, session] of sessions) {
      if (session.expiresAt.getTime() <= now.getTime()) {
        sessions.delete(id);
        try {
          options.onExpire?.(session);
        } catch {
          // Session expiry must not leave stale session state behind because a
          // best-effort transport cleanup failed.
        }
      }
    }
  }

  return {
    create(ownerId?: string): McpSession {
      if (closed) throw new Error("mcp_sessions_closed");
      const now = clock.now();
      purge(now);
      const session: McpSession = {
        id: createRequestId(clock),
        ...(ownerId ? { ownerId } : {}),
        createdAt: now,
        expiresAt: new Date(now.getTime() + ttlMs),
      };
      sessions.set(session.id, session);
      return session;
    },
    get(id: string | undefined): McpSession | undefined {
      if (!id || closed) return undefined;
      purge(clock.now());
      return sessions.get(id);
    },
    delete(id: string): boolean {
      return sessions.delete(id);
    },
    size(): number {
      purge(clock.now());
      return sessions.size;
    },
    shutdown() {
      closed = true;
      sessions.clear();
    },
    get closed() {
      return closed;
    },
  };
}

export type McpSessionStore = ReturnType<typeof createMcpSessionStore>;
