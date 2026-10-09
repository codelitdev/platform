import { createHash, randomBytes } from "node:crypto";
import { BillingWorkflowError } from "@codelitdev/billing/core";
import type {
  BillingAction,
  BillingActionGrant,
  BillingAuthorizationPort,
} from "@codelitdev/billing/workflows";
import { type Clock, systemClock } from "../clock.js";

/** Storage for single-use action tokens. */
export interface ActionGrantStore {
  insert(record: { identifier: string; value: string; expiresAt: Date }): Promise<void>;
  /**
   * Atomically removes the unexpired record with this identifier and returns
   * its value, or returns null when there is none.
   */
  take(identifier: string, now: Date): Promise<string | null>;
  /** Removes expired records. Optional housekeeping. */
  purgeExpired?(now: Date): Promise<void>;
}

export type BillingGrantTarget = { kind: string; id: string };

type StoredGrant = {
  actorId: string;
  sessionId: string;
  action: BillingAction;
  target: BillingGrantTarget;
};

export type IssueBillingGrantResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; error: "recent_authentication_required" };

const IDENTIFIER_PREFIX = "billing-action:";

function identifierFor(token: string): string {
  return `${IDENTIFIER_PREFIX}${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

/**
 * Single-use billing action grants. The product issues a token after it has
 * authenticated the person, then passes it back with the billing request. A
 * token is bound to one person, session, action, and target, expires quickly,
 * and works once. `authorization` is the port to pass to `createBilling`.
 */
export function createBillingActionGrants(options: {
  store: ActionGrantStore;
  clock?: Clock;
  /** How long an issued token stays valid. Default five minutes. */
  ttlMs?: number;
  /** How recently the session must have signed in. Default 15 minutes. */
  recentAuthMaxAgeMs?: number;
}) {
  const clock = options.clock ?? systemClock;
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  const recentAuthMaxAgeMs = options.recentAuthMaxAgeMs ?? 15 * 60 * 1000;

  async function issue(input: {
    actorId: string;
    sessionId: string;
    /** When the session signed in. */
    sessionCreatedAt: Date;
    action: BillingAction;
    target: BillingGrantTarget;
  }): Promise<IssueBillingGrantResult> {
    const now = clock.now();
    if (now.getTime() - input.sessionCreatedAt.getTime() > recentAuthMaxAgeMs) {
      return { ok: false, error: "recent_authentication_required" };
    }
    await options.store.purgeExpired?.(now);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + ttlMs);
    const value: StoredGrant = {
      actorId: input.actorId,
      sessionId: input.sessionId,
      action: input.action,
      target: input.target,
    };
    await options.store.insert({
      identifier: identifierFor(token),
      value: JSON.stringify(value),
      expiresAt,
    });
    return { ok: true, token, expiresAt };
  }

  /** Builds the grant to pass to a billing workflow from a token the client sent. */
  function grant(input: {
    token: string;
    actorId: string;
    sessionId: string;
    action: BillingAction;
    target: BillingGrantTarget;
  }): BillingActionGrant {
    const now = clock.now();
    return {
      grantId: `${input.sessionId}:${input.token}`,
      actorId: input.actorId,
      action: input.action,
      target: input.target,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
    };
  }

  const authorization: BillingAuthorizationPort = {
    async consume(candidate, expectedAction, expectedTarget, now) {
      const separator = candidate.grantId.lastIndexOf(":");
      const sessionId = candidate.grantId.slice(0, separator);
      const token = candidate.grantId.slice(separator + 1);
      if (separator <= 0 || !token) throw new BillingWorkflowError("grant_invalid");
      const raw = await options.store.take(identifierFor(token), now);
      if (!raw) throw new BillingWorkflowError("grant_invalid");
      let stored: StoredGrant;
      try {
        stored = JSON.parse(raw) as StoredGrant;
      } catch {
        throw new BillingWorkflowError("grant_invalid");
      }
      if (
        stored.actorId !== candidate.actorId ||
        stored.sessionId !== sessionId ||
        stored.action !== expectedAction ||
        stored.target?.kind !== expectedTarget.kind ||
        stored.target?.id !== expectedTarget.id
      ) {
        throw new BillingWorkflowError("grant_invalid");
      }
    },
  };

  return { issue, grant, authorization };
}

/** In-memory grant store for tests and single-process development. */
export class MemoryActionGrantStore implements ActionGrantStore {
  private readonly records = new Map<string, { value: string; expiresAt: Date }>();

  async insert(record: { identifier: string; value: string; expiresAt: Date }) {
    this.records.set(record.identifier, {
      value: record.value,
      expiresAt: record.expiresAt,
    });
  }

  async take(identifier: string, now: Date) {
    const record = this.records.get(identifier);
    if (!record) return null;
    this.records.delete(identifier);
    return record.expiresAt.getTime() > now.getTime() ? record.value : null;
  }

  async purgeExpired(now: Date) {
    for (const [identifier, record] of this.records) {
      if (record.expiresAt.getTime() <= now.getTime()) this.records.delete(identifier);
    }
  }
}
