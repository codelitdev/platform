import type { CheckoutAttemptStatus } from "./checkout-attempt.js";
import type { ProviderCustomerStatus } from "./customer.js";
import type { PlanChangeAttemptStatus } from "./plan-change-attempt.js";
import type { ReconciliationJobStatus } from "./reconciliation-job.js";
import type { CanonicalSubscriptionStatus } from "./ids.js";
import type { WebhookInboxStatus } from "./webhook-inbox.js";

export type TransitionDecision = {
    allowed: boolean;
    reason: string;
};

const allow = (reason: string): TransitionDecision => ({
    allowed: true,
    reason,
});
const deny = (reason: string): TransitionDecision => ({
    allowed: false,
    reason,
});

const SUBSCRIPTION_TRANSITIONS: Record<
    CanonicalSubscriptionStatus,
    ReadonlySet<CanonicalSubscriptionStatus>
> = {
    pending: new Set(["pending", "trialing", "active", "cancelled", "expired"]),
    trialing: new Set([
        "trialing",
        "active",
        "past_due",
        "cancelled",
        "expired",
    ]),
    active: new Set(["active", "past_due", "cancelled", "expired"]),
    past_due: new Set(["past_due", "active", "cancelled", "expired"]),
    cancelled: new Set([
        "cancelled",
        "trialing",
        "active",
        "past_due",
        "expired",
    ]),
    expired: new Set(["expired"]),
};

export type CheckoutTransitionContext = {
    now: Date;
    expiresAt: Date;
    subscriptionObservedAt?: Date | null;
    entityUnchanged?: boolean;
    payerUnchanged?: boolean;
    operatorRepair?: boolean;
};

export function decideSubscriptionTransition(
    from: CanonicalSubscriptionStatus,
    to: CanonicalSubscriptionStatus,
): TransitionDecision {
    if (SUBSCRIPTION_TRANSITIONS[from]?.has(to)) {
        return allow(`subscription:${from}->${to}`);
    }
    return deny(`illegal_subscription_transition:${from}->${to}`);
}

export function decideCheckoutTransition(
    from: CheckoutAttemptStatus,
    to: CheckoutAttemptStatus,
    context: CheckoutTransitionContext,
): TransitionDecision {
    if (from === to) return allow("idempotent");
    if (context.operatorRepair) return allow("operator_repair");

    const terminal = from === "completed" || from === "conflicted";
    if (terminal) {
        return deny("checkout_terminal");
    }

    if (from === "creating") {
        if (
            to === "open" ||
            to === "expired" ||
            to === "abandoned" ||
            to === "conflicted"
        ) {
            return allow(`checkout:creating->${to}`);
        }
        return deny(`illegal_checkout_transition:creating->${to}`);
    }

    if (from === "open") {
        if (
            to === "completed" ||
            to === "expired" ||
            to === "abandoned" ||
            to === "conflicted"
        ) {
            return allow(`checkout:open->${to}`);
        }
        return deny(`illegal_checkout_transition:open->${to}`);
    }

    if (from === "expired") {
        if (to === "conflicted") return allow("checkout:expired->conflicted");
        if (to === "completed") {
            const observed = context.subscriptionObservedAt;
            const preExpiry =
                observed != null &&
                observed.getTime() <= context.expiresAt.getTime();
            if (
                preExpiry &&
                context.entityUnchanged === true &&
                context.payerUnchanged === true
            ) {
                return allow("checkout:expired->completed:pre_expiry");
            }
            return deny("checkout:expired_completed_requires_pre_expiry");
        }
        return deny(`illegal_checkout_transition:expired->${to}`);
    }

    if (from === "abandoned") {
        if (to === "conflicted") return allow("checkout:abandoned->conflicted");
        return deny("checkout:abandoned_late_subscription_conflicted");
    }

    return deny(`illegal_checkout_transition:${from}->${to}`);
}

export function decidePlanChangeTransition(
    from: PlanChangeAttemptStatus,
    to: PlanChangeAttemptStatus,
    operatorRepair = false,
): TransitionDecision {
    if (from === to) return allow("idempotent");
    if (operatorRepair) return allow("operator_repair");
    if (from === "creating") {
        if (
            to === "pending" ||
            to === "succeeded" ||
            to === "failed" ||
            to === "conflicted"
        ) {
            return allow(`plan_change:creating->${to}`);
        }
    }
    if (from === "pending") {
        if (to === "succeeded" || to === "failed" || to === "conflicted") {
            return allow(`plan_change:pending->${to}`);
        }
    }
    return deny(`illegal_plan_change_transition:${from}->${to}`);
}

const WEBHOOK_TRANSITIONS: Record<
    WebhookInboxStatus,
    ReadonlySet<WebhookInboxStatus>
> = {
    pending: new Set(["processing", "ignored", "quarantined"]),
    processing: new Set([
        "processed",
        "failed",
        "ignored",
        "quarantined",
        "pending",
    ]),
    failed: new Set(["processing", "quarantined"]),
    processed: new Set(),
    ignored: new Set(),
    quarantined: new Set(["processing"]),
};

export function decideWebhookInboxTransition(
    from: WebhookInboxStatus,
    to: WebhookInboxStatus,
    operatorRepair = false,
): TransitionDecision {
    if (from === to) return allow("idempotent");
    if (operatorRepair) return allow("operator_repair");
    if (WEBHOOK_TRANSITIONS[from]?.has(to)) {
        return allow(`webhook:${from}->${to}`);
    }
    return deny(`illegal_webhook_transition:${from}->${to}`);
}

const CUSTOMER_TRANSITIONS: Record<
    ProviderCustomerStatus,
    ReadonlySet<ProviderCustomerStatus>
> = {
    creating: new Set(["active", "conflicted"]),
    active: new Set(["conflicted"]),
    conflicted: new Set(),
};

export function decideCustomerTransition(
    from: ProviderCustomerStatus,
    to: ProviderCustomerStatus,
    operatorRepair = false,
): TransitionDecision {
    if (from === to) return allow("idempotent");
    if (operatorRepair) return allow("operator_repair");
    if (CUSTOMER_TRANSITIONS[from]?.has(to)) {
        return allow(`customer:${from}->${to}`);
    }
    return deny(`illegal_customer_transition:${from}->${to}`);
}

const JOB_TRANSITIONS: Record<
    ReconciliationJobStatus,
    ReadonlySet<ReconciliationJobStatus>
> = {
    pending: new Set(["processing", "quarantined"]),
    processing: new Set(["completed", "failed", "pending", "quarantined"]),
    failed: new Set(["processing", "quarantined", "pending"]),
    completed: new Set(["pending"]),
    quarantined: new Set(["pending", "processing"]),
};

export function decideReconciliationTransition(
    from: ReconciliationJobStatus,
    to: ReconciliationJobStatus,
    operatorRepair = false,
): TransitionDecision {
    if (from === to) return allow("idempotent");
    if (operatorRepair) return allow("operator_repair");
    if (JOB_TRANSITIONS[from]?.has(to)) {
        return allow(`reconciliation:${from}->${to}`);
    }
    return deny(`illegal_reconciliation_transition:${from}->${to}`);
}
