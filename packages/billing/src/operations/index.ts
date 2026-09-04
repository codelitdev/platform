import { createHash } from "node:crypto";
import type { BillingEngine, OperatorContext } from "../workflows/engine.js";
import { healthFacts } from "../maintenance/health.js";
import type { Clock } from "../core/clock.js";
import type { SensitiveValuePort } from "../ports/sensitive-values.js";
import { BillingWorkflowError } from "../core/errors.js";

export type OperationsDeps = {
    billing: BillingEngine;
    clock: Clock;
    requestedRevision: number | null;
    checkoutProvider?: string;
    sensitiveValues?: SensitiveValuePort;
};

function assertOperatorContext(context: OperatorContext): void {
    if (
        !context.actorId.trim() ||
        !context.reason.trim() ||
        context.reason.length > 500 ||
        (context.ticket !== undefined && context.ticket.length > 256)
    ) {
        throw new BillingWorkflowError("grant_invalid");
    }
}

function digest(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

export type WebhookInspectView = {
    id: string;
    provider: string;
    providerEventId: string;
    eventType: string;
    status: string;
    lastError: string | null;
    subscriptionId: string | null;
    checkoutAttemptId: string | null;
    processingAttempts: number;
    occurredAt: Date;
    hasPayload: boolean;
};

export function createOperations(deps: OperationsDeps) {
    let decryptSequence = 0;

    async function decryptReplay(
        context: OperatorContext,
        ciphertext: string,
    ): Promise<string> {
        if (!deps.sensitiveValues) {
            throw new BillingWorkflowError("composition_invalid");
        }
        assertOperatorContext(context);
        await deps.billing.recordOperatorAudit(
            context,
            `operator:decrypt-replay:${digest(ciphertext)}:${context.actorId}:${++decryptSequence}`,
            null,
            { requested: "decrypt_replay" },
        );
        return deps.sensitiveValues.decrypt(ciphertext, {
            operatorActorId: context.actorId,
            reason: context.reason,
        });
    }

    async function reconcileSubscription(
        context: OperatorContext,
        subscriptionId: string,
    ) {
        assertOperatorContext(context);
        await deps.billing.store.withTransaction(async () => {
            const sub =
                await deps.billing.store.findSubscriptionById(subscriptionId);
            if (!sub) throw new BillingWorkflowError("subscription_required");
            const previous = await deps.billing.store.findLiveJob({
                provider: sub.provider,
                subscriptionId: sub.id,
            });
            const job = await deps.billing.enqueueJob({
                provider: sub.provider,
                subscriptionId: sub.id,
            });
            await deps.billing.recordOperatorAudit(
                context,
                `operator:reconcile:${job.id}:${context.actorId}`,
                previous ?? null,
                { requested: "reconcile" },
                { subscriptionId: sub.id },
            );
        });
        await deps.billing.runReconciliationBatch({
            workerId: `ops:${context.actorId}`,
        });
    }

    return {
        inspectEntity(entityId: string) {
            return deps.billing.commercialState(entityId);
        },
        health() {
            return healthFacts(
                deps.billing.store,
                deps.clock,
                deps.requestedRevision,
                deps.checkoutProvider,
            );
        },
        reconcileSubscription,
        async reconcileEntity(context: OperatorContext, entityId: string) {
            const sub =
                await deps.billing.store.findEntitlementSubscription(entityId);
            if (!sub) throw new BillingWorkflowError("subscription_required");
            await reconcileSubscription(context, sub.id);
        },
        async inspectWebhook(
            providerEventId: string,
        ): Promise<WebhookInspectView> {
            const row =
                await deps.billing.store.findWebhookByEventId(providerEventId);
            if (!row) throw new BillingWorkflowError("operation_conflicted");
            return {
                id: row.id,
                provider: row.provider,
                providerEventId: row.providerEventId,
                eventType: row.eventType,
                status: row.status,
                lastError: row.lastError,
                subscriptionId: row.subscriptionId,
                checkoutAttemptId: row.checkoutAttemptId,
                processingAttempts: row.processingAttempts,
                occurredAt: row.occurredAt,
                hasPayload: Boolean(row.payloadEncrypted),
            };
        },
        async inspectWebhookReplay(
            context: OperatorContext,
            providerEventId: string,
        ): Promise<string> {
            const row =
                await deps.billing.store.findWebhookByEventId(providerEventId);
            if (!row?.payloadEncrypted) {
                throw new BillingWorkflowError("operation_conflicted");
            }
            return decryptReplay(context, row.payloadEncrypted);
        },
        async retryWebhook(
            context: OperatorContext,
            providerEventId: string,
            mode: "preserve_attempts" | "new_budget",
        ) {
            assertOperatorContext(context);
            if (mode !== "preserve_attempts" && mode !== "new_budget") {
                throw new BillingWorkflowError("operation_conflicted");
            }
            await deps.billing.store.withTransaction(async () => {
                const row =
                    await deps.billing.store.findWebhookByEventId(
                        providerEventId,
                    );
                if (!row)
                    throw new BillingWorkflowError("operation_conflicted");
                const previous = {
                    status: row.status,
                    processingAttempts: row.processingAttempts,
                    availableAt: row.availableAt,
                };
                if (mode === "new_budget") row.processingAttempts = 0;
                row.status = "pending";
                row.availableAt = deps.clock.now();
                row.workerId = null;
                row.lockedAt = null;
                row.leaseExpiresAt = null;
                await deps.billing.store.saveWebhook(row);
                await deps.billing.recordOperatorAudit(
                    context,
                    `operator:retry-webhook:${row.id}:${context.actorId}:${mode}:${row.processingAttempts}`,
                    previous,
                    {
                        status: row.status,
                        processingAttempts: row.processingAttempts,
                        mode,
                    },
                    { providerEventId: row.providerEventId },
                );
            });
            await deps.billing.runWebhookInboxBatch({
                workerId: `ops:${context.actorId}`,
            });
        },
        async projectProviderSubscription(
            context: OperatorContext,
            input: {
                providerSubscriptionId: string;
                checkoutAttemptId?: string;
            },
        ) {
            assertOperatorContext(context);
            const write = await deps.billing.projectFromProvider(input);
            await deps.billing.recordOperatorAudit(
                context,
                `operator:project-provider:${input.providerSubscriptionId}:${context.actorId}`,
                null,
                write.subscription,
                {
                    subscriptionId: write.subscription.id,
                    billableEntityId: write.subscription.billableEntityId,
                },
            );
            return write;
        },
        async requestCancellation(
            context: OperatorContext,
            subscriptionId: string,
        ) {
            await deps.billing.operatorCancel(context, subscriptionId);
        },
        decryptReplay,
        catalog() {
            return deps.billing.publicCatalog();
        },
        catalogRevisions() {
            return deps.billing.store.listRevisions();
        },
        recordRequestedCatalog() {
            return deps.billing.recordRequestedCatalog();
        },
        verifyRequestedCatalog() {
            return deps.billing.verifyRequestedCatalog();
        },
        abandonRequestedCatalog(context: OperatorContext) {
            assertOperatorContext(context);
            return deps.billing.abandonRequestedCatalog(context);
        },
    };
}
