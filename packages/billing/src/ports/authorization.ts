import { BillingWorkflowError } from "../core/errors.js";

export type BillingAction =
  | "checkout"
  | "portal"
  | "plan_change"
  | "cancellation"
  | "payer_transfer";

export type BillingActionGrant = {
  grantId: string;
  actorId: string;
  action: BillingAction;
  target: { kind: string; id: string };
  issuedAt: Date;
  expiresAt: Date;
};

export interface BillingAuthorizationPort {
  consume(
    grant: BillingActionGrant,
    expectedAction: BillingAction,
    expectedTarget: { kind: string; id: string },
    now: Date,
  ): Promise<void>;
}

export class MemoryAuthorizationPort implements BillingAuthorizationPort {
  readonly issued = new Map<string, BillingActionGrant>();
  readonly consumed = new Set<string>();

  issue(grant: BillingActionGrant): BillingActionGrant {
    this.issued.set(grant.grantId, grant);
    return grant;
  }

  async consume(
    grant: BillingActionGrant,
    expectedAction: BillingAction,
    expectedTarget: { kind: string; id: string },
    now: Date,
  ): Promise<void> {
    if (this.consumed.has(grant.grantId)) {
      throw new BillingWorkflowError("grant_consumed");
    }
    const stored = this.issued.get(grant.grantId);
    if (!stored) throw new BillingWorkflowError("grant_invalid");
    if (
      stored.action !== expectedAction ||
      grant.action !== expectedAction ||
      stored.actorId !== grant.actorId
    ) {
      throw new BillingWorkflowError("grant_invalid");
    }
    if (
      stored.target.kind !== expectedTarget.kind ||
      grant.target.kind !== expectedTarget.kind ||
      stored.target.id !== expectedTarget.id ||
      grant.target.id !== expectedTarget.id
    ) {
      throw new BillingWorkflowError("grant_invalid");
    }
    if (stored.expiresAt.getTime() <= now.getTime()) {
      throw new BillingWorkflowError("grant_invalid");
    }
    this.consumed.add(grant.grantId);
  }
}
