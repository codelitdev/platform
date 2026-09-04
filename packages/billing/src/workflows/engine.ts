import { checkoutIsAvailable, toPublicCatalog } from "../catalog/public-view.js";
import { canActivateRevision } from "../catalog/revisions.js";
import type { BillingOffer, PublicBillingCatalog } from "../catalog/types.js";
import {
  catalogMatchesProviderSnapshot,
  validateCatalog,
} from "../catalog/validate.js";
import type { CheckoutAttempt } from "../core/checkout-attempt.js";
import type { Clock } from "../core/clock.js";
import type { ProviderCustomer } from "../core/customer.js";
import {
  BillingCompositionError,
  BillingProviderError,
  BillingWorkflowError,
  providerErrorSummary,
} from "../core/errors.js";
import type { BillableEntityRef, PayerRef } from "../core/ids.js";
import type { PlanChangeAttempt } from "../core/plan-change-attempt.js";
import type { ReconciliationJob } from "../core/reconciliation-job.js";
import type {
  CanonicalSubscription,
  SubscriptionSnapshot,
  VerifiedWebhookEnvelope,
} from "../core/subscription.js";
import { retainsPaidEntitlement } from "../core/subscription.js";
import {
  decideCheckoutTransition,
  decideCustomerTransition,
  decidePlanChangeTransition,
  decideSubscriptionTransition,
  decideWebhookInboxTransition,
} from "../core/transitions.js";
import type { WebhookInboxRecord } from "../core/webhook-inbox.js";
import {
  billingWebhookRetry,
  DEFAULT_WEBHOOK_MAX_ATTEMPTS,
} from "../maintenance/retry.js";
import {
  applySubscriptionProjection,
  MemoryBillingStore,
  newId,
} from "../persistence/memory.js";
import type {
  BillingStore,
  MemoryCatalog,
  PriceEntryRow,
} from "../persistence/store.js";
import type { BillingAuditHook } from "../ports/audit.js";
import type {
  BillingAction,
  BillingActionGrant,
  BillingAuthorizationPort,
} from "../ports/authorization.js";
import type {
  BillingBlocker,
  BillingLifecycleHooks,
  PayerResponsibility,
} from "../ports/lifecycle.js";
import type { SensitiveValuePort } from "../ports/sensitive-values.js";
import {
  type BillingTelemetry,
  noopTelemetry,
  safeTelemetry,
} from "../ports/telemetry.js";
import type {
  BillingProductSnapshot,
  BillingProviderAdapter,
} from "../providers/contract.js";
import { BillingProviderRegistry } from "../providers/registry.js";

export type CommercialBillingState = {
  activePaidPlan: string | null;
  billingInterval: "month" | "year" | null;
  subscriptionStatus: string | null;
  providerTrialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  paidThroughAt: Date | null;
  cancelAtPeriodEnd: boolean;
  pendingCheckout: boolean;
  pendingPlanChange: boolean;
  projectionVersion: number;
};

export type CreateBillingOptions = {
  database?: BillingStore;
  providers: BillingProviderAdapter[] | BillingProviderRegistry;
  clock: Clock;
  telemetry?: BillingTelemetry;
  hooks?: { audit?: BillingAuditHook; lifecycle?: BillingLifecycleHooks };
  authorization: BillingAuthorizationPort;
  sensitiveValues?: SensitiveValuePort;
  mode: "cloud" | "oss";
  checkoutProvider: string;
  requestedRevision: number | null;
  requiredOfferKeys: string[];
  offers?: BillingOffer[];
  webhookRetrieveCurrent?: boolean;
  /** Application-owned allowlist for checkout and portal return URLs. */
  returnUrlValidator?: (url: string) => boolean;
};

export type OperatorContext = {
  actorId: string;
  reason: string;
  ticket?: string;
};

const LEASE_MS = 5 * 60 * 1000;

export function createBilling(options: CreateBillingOptions) {
  if (options.mode === "cloud" && !options.hooks?.audit) {
    throw new BillingCompositionError("audit_hook_required");
  }
  if (options.webhookRetrieveCurrent === false) {
    throw new BillingCompositionError("webhook_current_retrieval_required");
  }
  if (options.mode === "cloud" && typeof options.returnUrlValidator !== "function") {
    throw new BillingCompositionError("return_url_validator_required");
  }
  const store = options.database ?? new MemoryBillingStore();
  const registry =
    options.providers instanceof BillingProviderRegistry
      ? options.providers
      : new BillingProviderRegistry(options.providers);
  if (
    options.mode === "oss" &&
    (registry.list().length > 0 ||
      Boolean(options.checkoutProvider) ||
      options.requestedRevision !== null ||
      Boolean(options.offers?.length) ||
      (Array.isArray(options.requiredOfferKeys) &&
        options.requiredOfferKeys.length > 0))
  ) {
    throw new BillingCompositionError("oss_billing_configuration_forbidden");
  }
  if (
    options.mode === "cloud" &&
    (!options.checkoutProvider ||
      options.requestedRevision === null ||
      !Number.isSafeInteger(options.requestedRevision) ||
      options.requestedRevision <= 0 ||
      !Array.isArray(options.requiredOfferKeys) ||
      options.requiredOfferKeys.length === 0 ||
      !Array.isArray(options.offers) ||
      new Set(options.requiredOfferKeys).size !== options.requiredOfferKeys.length ||
      options.requiredOfferKeys.some(
        (key) => !isBoundedOpaqueId(key) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(key),
      ) ||
      !registry.has(options.checkoutProvider))
  ) {
    throw new BillingCompositionError("cloud_billing_configuration_incomplete");
  }
  const requestedOffers =
    options.mode === "cloud"
      ? validateCatalog({
          offers: options.offers!,
          requiredOfferKeys: options.requiredOfferKeys,
          revision: options.requestedRevision!,
          checkoutProvider: options.checkoutProvider,
        })
      : [];
  const telemetry = safeTelemetry(options.telemetry ?? noopTelemetry);
  const audit = options.hooks?.audit;
  const lifecycle = options.hooks?.lifecycle;
  const clock = options.clock;

  function provider(name: string): BillingProviderAdapter {
    return registry.get(name);
  }

  async function callProvider<T>(fn: () => Promise<T>): Promise<T> {
    store.noteProviderCall();
    return fn();
  }

  async function publicCatalog(): Promise<PublicBillingCatalog | null> {
    if (options.mode === "oss") return null;
    return publicCatalogFor(options.checkoutProvider);
  }

  async function publicCatalogFor(
    providerName: string,
  ): Promise<PublicBillingCatalog | null> {
    if (options.mode === "oss") return null;
    const active = await store.getActiveCatalog(providerName);
    if (!active) return null;
    if (!catalogShapeIsComplete(active, options.requiredOfferKeys)) {
      return toPublicCatalog(active.revision.revision, [], false);
    }
    const offers: BillingOffer[] = active.items.map((item) => ({
      key: item.price.offerKey,
      revision: active.revision.revision,
      plan: item.price.plan,
      interval: item.price.interval,
      currency: item.price.currency,
      amountMinor: item.price.amountMinor,
      providerTrialDays: item.price.providerTrialDays,
      provider: item.price.provider,
      providerProductId: item.price.providerProductId,
    }));
    return toPublicCatalog(
      active.revision.revision,
      offers,
      checkoutIsAvailable({
        requestedRevision:
          providerName === options.checkoutProvider ? options.requestedRevision : null,
        activeRevision: active.revision.revision,
      }),
    );
  }

  /** Idempotently records configuration without contacting the provider. */
  async function recordRequestedCatalog() {
    if (options.mode === "oss") return null;
    try {
      return await store.withTransaction(async () => {
        const existing = await store.getCatalogRevision(
          options.checkoutProvider,
          options.requestedRevision!,
        );
        if (existing) {
          if (
            existing.items.length > 0 &&
            !catalogMatchesDeclaredOffers(existing, requestedOffers)
          ) {
            throw new BillingCompositionError(
              "catalog_revision_reused_with_different_offers",
            );
          }
          return existing.revision;
        }
        const revisions = await store.listRevisions();
        const newer = revisions.find(
          (revision) => revision.revision > options.requestedRevision!,
        );
        if (newer) {
          throw new BillingWorkflowError("catalog_changed", {
            details: { currentRevision: newer.revision },
          });
        }
        const requested = {
          id: newId(),
          revision: options.requestedRevision!,
          checkoutProvider: options.checkoutProvider,
          status: "pending_verification" as const,
          verifiedAt: null,
          activatedAt: null,
          retiredAt: null,
        };
        await store.insertCatalogRevision(requested);
        return requested;
      });
    } catch (error) {
      const raced = await store.getCatalogRevision(
        options.checkoutProvider,
        options.requestedRevision!,
      );
      if (
        raced &&
        !(error instanceof BillingCompositionError) &&
        !(error instanceof BillingWorkflowError)
      ) {
        if (
          raced.items.length > 0 &&
          !catalogMatchesDeclaredOffers(raced, requestedOffers)
        ) {
          throw new BillingCompositionError(
            "catalog_revision_reused_with_different_offers",
          );
        }
        return raced.revision;
      }
      throw error;
    }
  }

  /** Explicit maintenance check; ordinary reads never contact a provider. */
  async function verifyRequestedCatalog(): Promise<{
    verified: boolean;
    revision: number | null;
    mismatches: string[];
  }> {
    if (options.mode === "oss") {
      return { verified: true, revision: null, mismatches: [] };
    }
    const requested = await recordRequestedCatalog();
    if (!requested || requested.status === "abandoned") {
      return {
        verified: false,
        revision: requested?.revision ?? null,
        mismatches: ["revision_abandoned"],
      };
    }
    if (requested.status === "invalid") {
      return {
        verified: false,
        revision: requested.revision,
        mismatches: ["revision_invalid"],
      };
    }
    const mismatches: string[] = [];
    let providerUnavailable = false;
    const adapter = provider(options.checkoutProvider);
    for (const offer of requestedOffers) {
      try {
        const remote = await callProvider(() =>
          adapter.retrieveProduct(offer.providerProductId),
        );
        if (!catalogMatchesProviderSnapshot(offer, remote)) {
          mismatches.push(offer.key);
        }
      } catch {
        providerUnavailable = true;
        mismatches.push(offer.key);
      }
    }
    if (mismatches.length > 0) {
      if (!providerUnavailable) {
        await store.withTransaction(async () => {
          const latest = await store.getCatalogRevision(
            options.checkoutProvider,
            options.requestedRevision!,
          );
          if (latest?.revision.status === "pending_verification") {
            latest.revision.status = "invalid";
            await store.saveCatalogRevision(latest.revision);
          }
        });
      }
      return {
        verified: false,
        revision: requested.revision,
        mismatches,
      };
    }

    const activated = await activateVerifiedCatalog();
    return {
      verified: activated,
      revision: requested.revision,
      mismatches: activated ? [] : ["revision_superseded"],
    };
  }

  async function activateVerifiedCatalog(): Promise<boolean> {
    return store.withTransaction(async () => {
      const candidate = await store.getCatalogRevision(
        options.checkoutProvider,
        options.requestedRevision!,
      );
      if (!candidate) {
        throw new BillingWorkflowError("catalog_unavailable");
      }
      if (candidate.revision.status === "active") {
        if (!catalogMatchesDeclaredOffers(candidate, requestedOffers)) {
          throw new BillingCompositionError(
            "catalog_revision_reused_with_different_offers",
          );
        }
        return true;
      }
      const active = await store.getActiveCatalog(options.checkoutProvider);
      if (
        !canActivateRevision({
          requested: candidate.revision.revision,
          currentActive: active?.revision.revision ?? null,
          requestedStatus: candidate.revision.status,
        })
      ) {
        return false;
      }
      const now = clock.now();
      for (const offer of requestedOffers) {
        const existingItem = candidate.items.find(
          (item) => item.offerKey === offer.key,
        );
        if (existingItem) {
          if (!priceMatchesDeclaredOffer(existingItem.price, offer)) {
            candidate.revision.status = "invalid";
            await store.saveCatalogRevision(candidate.revision);
            throw new BillingCompositionError(
              "catalog_revision_reused_with_different_offers",
            );
          }
          continue;
        }
        let price = await store.findPriceByProviderProduct(
          offer.provider,
          offer.providerProductId,
        );
        if (price && !priceMatchesDeclaredOffer(price, offer)) {
          candidate.revision.status = "invalid";
          await store.saveCatalogRevision(candidate.revision);
          throw new BillingCompositionError(
            "provider_product_reused_with_different_price",
          );
        }
        if (!price) {
          price = {
            id: newId(),
            offerKey: offer.key,
            plan: offer.plan,
            interval: offer.interval,
            currency: offer.currency,
            amountMinor: offer.amountMinor,
            providerTrialDays: offer.providerTrialDays,
            provider: offer.provider,
            providerProductId: offer.providerProductId,
            verifiedAt: now,
          };
          await store.insertPriceEntry(price);
        }
        await store.insertCatalogRevisionItem({
          id: newId(),
          revisionId: candidate.revision.id,
          offerKey: offer.key,
          priceEntryId: price.id,
        });
        candidate.items.push({ offerKey: offer.key, price });
      }
      if (!catalogMatchesDeclaredOffers(candidate, requestedOffers)) {
        candidate.revision.status = "invalid";
        await store.saveCatalogRevision(candidate.revision);
        throw new BillingCompositionError(
          "catalog_revision_reused_with_different_offers",
        );
      }
      if (active && active.revision.id !== candidate.revision.id) {
        active.revision.status = "retired";
        active.revision.retiredAt = now;
        await store.saveCatalogRevision(active.revision);
      }
      candidate.revision.status = "active";
      candidate.revision.verifiedAt = now;
      candidate.revision.activatedAt = now;
      candidate.revision.retiredAt = null;
      await store.saveCatalogRevision(candidate.revision);
      await requireAudit({
        effectId: `catalog:${candidate.revision.revision}:activated`,
        actor: { kind: "system", id: "catalog_verifier" },
        previous: active
          ? { revision: active.revision.revision, status: "active" }
          : null,
        next: {
          revision: candidate.revision.revision,
          status: "active",
        },
        correlationIds: {
          catalogRevisionId: candidate.revision.id,
        },
      });
      return true;
    });
  }

  async function consumeGrant(
    grant: BillingActionGrant | undefined,
    action: BillingAction,
    target: { kind: string; id: string },
    payerId: string,
  ): Promise<void> {
    if (!grant) throw new BillingWorkflowError("grant_invalid");
    if (
      grant.actorId !== payerId ||
      grant.target.kind !== target.kind ||
      grant.target.id !== target.id
    ) {
      throw new BillingWorkflowError("grant_invalid");
    }
    await options.authorization.consume(grant, action, target, clock.now());
  }

  async function requireAudit(record: Parameters<BillingAuditHook["record"]>[0]) {
    if (!audit) return;
    await audit.record(record);
  }

  async function resolveCustomer(input: { payer: PayerRef; providerName: string }) {
    let customer: ProviderCustomer;
    try {
      customer = await store.withTransaction(async () => {
        const existing = await store.findCustomerByPayer(
          input.providerName,
          input.payer.id,
        );
        if (existing) {
          existing.payerEmail = input.payer.email;
          await store.saveCustomer(existing);
          return existing;
        }
        const created: ProviderCustomer = {
          id: newId(),
          provider: input.providerName,
          payerId: input.payer.id,
          payerEmail: input.payer.email,
          providerCustomerId: null,
          idempotencyKey: `customer:${input.providerName}:${input.payer.id}`,
          status: "creating",
          lastError: null,
        };
        await store.insertCustomer(created);
        return created;
      });
    } catch (error) {
      const raced = await store.findCustomerByPayer(input.providerName, input.payer.id);
      if (!raced) throw error;
      customer = raced;
    }
    if (customer.status === "active" && customer.providerCustomerId) {
      return customer;
    }
    if (
      customer.status === "conflicted" ||
      (customer.status === "active" && !customer.providerCustomerId)
    ) {
      throw new BillingWorkflowError("operation_conflicted");
    }
    try {
      const remote = await callProvider(() =>
        provider(input.providerName).createCustomer({
          email: input.payer.email,
          name: input.payer.name,
          idempotencyKey: customer.idempotencyKey,
        }),
      );
      return await store.withTransaction(async () => {
        const latest = (await store.findCustomerById(customer.id)) ?? customer;
        if (
          latest.provider !== customer.provider ||
          latest.payerId !== customer.payerId
        ) {
          throw new BillingWorkflowError("operation_quarantined");
        }
        const decision = decideCustomerTransition(latest.status, "active");
        if (!decision.allowed) {
          latest.status = "conflicted";
          await store.saveCustomer(latest);
          throw new BillingWorkflowError("operation_conflicted");
        }
        if (latest.payerId !== input.payer.id) {
          throw new BillingWorkflowError("payer_mismatch");
        }
        latest.providerCustomerId = remote.providerCustomerId;
        latest.status = "active";
        await store.saveCustomer(latest);
        await requireAudit({
          effectId: `customer:${latest.id}:active`,
          actor: { kind: "user", id: input.payer.id },
          previous: { status: customer.status },
          next: { status: "active" },
          correlationIds: { customerId: latest.id },
        });
        return latest;
      });
    } catch (error) {
      await enqueueJob({
        provider: input.providerName,
        providerCustomerId: customer.id,
      });
      if (error instanceof BillingWorkflowError) throw error;
      throw new BillingWorkflowError("provider_unavailable", {
        retryable: true,
      });
    }
  }

  async function enqueueJobInTransaction(subject: {
    provider: string;
    checkoutAttemptId?: string | null;
    planChangeAttemptId?: string | null;
    subscriptionId?: string | null;
    providerCustomerId?: string | null;
    operation?: ReconciliationJob["operation"];
  }) {
    const subjectCount = [
      subject.checkoutAttemptId,
      subject.planChangeAttemptId,
      subject.subscriptionId,
      subject.providerCustomerId,
    ].filter(Boolean).length;
    if (
      !isBoundedOpaqueId(subject.provider) ||
      subjectCount !== 1 ||
      (subject.operation !== undefined &&
        subject.operation !== "reconcile" &&
        subject.operation !== "cancellation") ||
      (subject.operation === "cancellation" && !subject.subscriptionId)
    ) {
      throw new BillingWorkflowError("operation_conflicted");
    }
    const live = await store.findLiveJob(subject);
    if (live) {
      if (subject.operation === "cancellation" && live.operation !== "cancellation") {
        live.operation = "cancellation";
        await store.saveJob(live);
      }
      return live;
    }
    const job: ReconciliationJob = {
      id: newId(),
      provider: subject.provider,
      checkoutAttemptId: subject.checkoutAttemptId ?? null,
      planChangeAttemptId: subject.planChangeAttemptId ?? null,
      subscriptionId: subject.subscriptionId ?? null,
      providerCustomerId: subject.providerCustomerId ?? null,
      status: "pending",
      attemptCount: 0,
      availableAt: clock.now(),
      lockedAt: null,
      leaseExpiresAt: null,
      workerId: null,
      lastError: null,
      operation: subject.operation ?? "reconcile",
    };
    await store.insertJob(job);
    return job;
  }

  async function enqueueJob(subject: {
    provider: string;
    checkoutAttemptId?: string | null;
    planChangeAttemptId?: string | null;
    subscriptionId?: string | null;
    providerCustomerId?: string | null;
    operation?: ReconciliationJob["operation"];
  }) {
    if (store.isInTransaction?.() ?? store.transactionDepth > 0) {
      return enqueueJobInTransaction(subject);
    }
    return store.withTransaction(() => enqueueJobInTransaction(subject));
  }

  async function startCheckout(input: {
    grant: BillingActionGrant;
    entity: BillableEntityRef;
    payer: PayerRef;
    offerKey: string;
    catalogRevision: number;
    returnUrl: string;
    trialDays?: number;
    applicationFields?: Record<string, unknown>;
  }) {
    if (options.mode === "oss") {
      throw new BillingWorkflowError("unsupported_operation");
    }
    validateReturnUrl(input.returnUrl, options.returnUrlValidator);
    await consumeGrant(
      input.grant,
      "checkout",
      {
        kind: input.entity.kind,
        id: input.entity.id,
      },
      input.payer.id,
    );
    const catalog = await store.getActiveCatalog(options.checkoutProvider);
    const pub = await publicCatalog();
    if (!catalog || !pub) {
      throw new BillingWorkflowError("catalog_unavailable");
    }
    if (!catalogShapeIsComplete(catalog, options.requiredOfferKeys)) {
      throw new BillingWorkflowError("catalog_unavailable");
    }
    if (
      input.catalogRevision !== catalog.revision.revision ||
      !checkoutIsAvailable({
        requestedRevision: options.requestedRevision,
        activeRevision: catalog.revision.revision,
      })
    ) {
      throw new BillingWorkflowError("catalog_changed", {
        details: { publicCatalog: pub },
      });
    }
    const item = catalog.items.find((row) => row.offerKey === input.offerKey);
    if (!item)
      throw new BillingWorkflowError("catalog_changed", {
        details: { publicCatalog: pub },
      });

    const existingSub = await store.findEntitlementSubscription(input.entity.id);
    if (existingSub && retainsPaidEntitlement(existingSub, clock.now())) {
      throw new BillingWorkflowError("active_subscription_exists");
    }
    const adapter = provider(options.checkoutProvider);
    const checkoutIdempotencyKey = `checkout:${input.entity.id}:${input.offerKey}:${catalog.revision.revision}`;
    const resumable = await store.findResumableCheckout(input.entity.id);
    if (resumable?.providerCheckoutSessionId && resumable.payerId === input.payer.id) {
      try {
        const session = await callProvider(() =>
          adapter.retrieveCheckoutSession(resumable.providerCheckoutSessionId!),
        );
        if (session.subscriptionId) {
          const snapshot = await callProvider(() =>
            adapter.retrieveSubscription(session.subscriptionId!),
          );
          if (retainsPaidEntitlement(snapshot, clock.now())) {
            await projectSnapshot(snapshot, {
              checkoutAttemptId: resumable.attemptId,
            });
            const latest = (await store.findCheckoutById(resumable.id)) ?? resumable;
            return {
              attempt: latest,
              checkoutUrl: latest.returnUrl,
            };
          }
        }
      } catch (error) {
        if (error instanceof BillingWorkflowError) throw error;
      }
    }

    const liveCheckout = await store.findLiveCheckout(input.entity.id);
    let resumeAttempt: CheckoutAttempt | undefined;
    if (liveCheckout && liveCheckout.expiresAt.getTime() <= clock.now().getTime()) {
      liveCheckout.status = "expired";
      liveCheckout.completedAt = clock.now();
      liveCheckout.checkoutUrlEncrypted = null;
      await store.saveCheckout(liveCheckout);
      resumeAttempt = liveCheckout;
    } else if (liveCheckout) {
      if (
        liveCheckout.payerId !== input.payer.id ||
        liveCheckout.offerKey !== input.offerKey ||
        liveCheckout.catalogRevision !== catalog.revision.revision
      ) {
        throw new BillingWorkflowError("checkout_pending");
      }
      if (
        liveCheckout.status === "open" &&
        liveCheckout.checkoutUrlEncrypted &&
        options.sensitiveValues
      ) {
        const checkoutUrl = await options.sensitiveValues.decrypt(
          liveCheckout.checkoutUrlEncrypted,
          {
            operatorActorId: input.payer.id,
            reason: "resume_checkout",
          },
        );
        return { attempt: liveCheckout, checkoutUrl };
      }
      resumeAttempt = liveCheckout;
    }

    if (!resumeAttempt) {
      const existing = await store.findCheckoutByIdempotencyKey(checkoutIdempotencyKey);
      if (
        existing &&
        existing.payerId === input.payer.id &&
        existing.offerKey === input.offerKey &&
        existing.catalogRevision === catalog.revision.revision
      ) {
        if (
          existing.status === "open" &&
          existing.checkoutUrlEncrypted &&
          existing.expiresAt.getTime() > clock.now().getTime() &&
          options.sensitiveValues
        ) {
          const checkoutUrl = await options.sensitiveValues.decrypt(
            existing.checkoutUrlEncrypted,
            {
              operatorActorId: input.payer.id,
              reason: "resume_checkout",
            },
          );
          return { attempt: existing, checkoutUrl };
        }
        if (
          existing.status === "completed" &&
          existing.checkoutUrlEncrypted &&
          existing.expiresAt.getTime() > clock.now().getTime() &&
          options.sensitiveValues
        ) {
          const checkoutUrl = await options.sensitiveValues.decrypt(
            existing.checkoutUrlEncrypted,
            {
              operatorActorId: input.payer.id,
              reason: "resume_checkout",
            },
          );
          return { attempt: existing, checkoutUrl };
        }
        resumeAttempt = existing;
      }
    }

    if (
      adapter.capabilities.mutationRecovery.createCustomer === "unsupported" ||
      adapter.capabilities.mutationRecovery.createCheckout === "unsupported"
    ) {
      throw new BillingWorkflowError("unsupported_operation");
    }
    let providerProduct: BillingProductSnapshot;
    try {
      providerProduct = await callProvider(() =>
        adapter.retrieveProduct(item.price.providerProductId),
      );
    } catch (error) {
      if (error instanceof BillingProviderError && error.code === "invalid") {
        throw new BillingWorkflowError("catalog_changed", {
          details: { publicCatalog: pub },
        });
      }
      throw new BillingWorkflowError("provider_unavailable", {
        retryable: true,
      });
    }
    if (!catalogMatchesProviderSnapshot(item.price, providerProduct)) {
      throw new BillingWorkflowError("catalog_changed", {
        details: { publicCatalog: pub },
      });
    }
    if (liveCheckout?.status === "open" && !liveCheckout.checkoutUrlEncrypted) {
      let customer: ProviderCustomer;
      try {
        customer = await resolveCustomer({
          payer: input.payer,
          providerName: options.checkoutProvider,
        });
      } catch (error) {
        await enqueueJob({
          provider: options.checkoutProvider,
          checkoutAttemptId: liveCheckout.id,
        });
        throw error;
      }
      try {
        const remote = await callProvider(() =>
          adapter.createCheckout({
            productId: item.price.providerProductId,
            currency: item.price.currency,
            customerId: customer.providerCustomerId!,
            payerEmail: input.payer.email,
            returnUrl: liveCheckout.returnUrl,
            attemptId: liveCheckout.attemptId,
            catalogKey: liveCheckout.offerKey,
            trialDays: input.trialDays ?? 0,
            idempotencyKey: liveCheckout.idempotencyKey,
          }),
        );
        if (options.sensitiveValues) {
          const encrypted = await options.sensitiveValues.encrypt(remote.checkoutUrl);
          liveCheckout.checkoutUrlEncrypted = encrypted.ciphertext;
          liveCheckout.providerCheckoutSessionId = remote.providerCheckoutSessionId;
          liveCheckout.providerCustomerRowId = customer.id;
          await store.saveCheckout(liveCheckout);
        }
        return {
          attempt: liveCheckout,
          checkoutUrl: remote.checkoutUrl,
        };
      } catch (error) {
        await enqueueJob({
          provider: options.checkoutProvider,
          checkoutAttemptId: liveCheckout.id,
        });
        if (error instanceof BillingWorkflowError) throw error;
        throw new BillingWorkflowError("provider_unavailable", {
          retryable: true,
        });
      }
    }
    let attempt: CheckoutAttempt;
    if (resumeAttempt) {
      attempt = resumeAttempt;
    } else {
      try {
        attempt = await store.withTransaction(async () => {
          const row: CheckoutAttempt = {
            id: newId(),
            attemptId: store.newAttemptId(),
            billableEntityId: input.entity.id,
            payerId: input.payer.id,
            payerEmail: input.payer.email,
            returnUrl: input.returnUrl,
            provider: options.checkoutProvider,
            catalogRevision: catalog.revision.revision,
            offerKey: item.offerKey,
            plan: item.price.plan,
            interval: item.price.interval,
            priceEntryId: item.price.id,
            quotedAmountMinor: item.price.amountMinor,
            quotedCurrency: item.price.currency,
            providerCustomerRowId: null,
            providerCheckoutSessionId: null,
            checkoutUrlEncrypted: null,
            idempotencyKey: checkoutIdempotencyKey,
            status: "creating",
            expiresAt: new Date(clock.now().getTime() + 60 * 60 * 1000),
            lastError: null,
            completedAt: null,
            applicationFields: input.applicationFields,
          };
          await store.insertCheckout(row);
          await store.ensurePlanState(input.entity.id);
          return row;
        });
      } catch (error) {
        const raced =
          (await store.findLiveCheckout(input.entity.id)) ??
          (await store.findCheckoutByIdempotencyKey(checkoutIdempotencyKey));
        if (
          !raced ||
          raced.payerId !== input.payer.id ||
          raced.offerKey !== input.offerKey ||
          raced.catalogRevision !== catalog.revision.revision
        ) {
          throw error;
        }
        attempt = raced;
      }
    }

    const reopenExpiredOrUnpaidCompleted =
      attempt.status === "expired" || attempt.status === "completed";
    if (reopenExpiredOrUnpaidCompleted) {
      attempt.status = "creating";
      attempt.completedAt = null;
      attempt.checkoutUrlEncrypted = null;
      attempt.lastError = null;
      attempt.expiresAt = new Date(clock.now().getTime() + 60 * 60 * 1000);
      await store.saveCheckout(attempt);
    }
    const providerCheckoutKey = reopenExpiredOrUnpaidCompleted
      ? `${attempt.idempotencyKey}:reopen:${attempt.id}`
      : attempt.idempotencyKey;

    let customer: ProviderCustomer;
    try {
      customer = await resolveCustomer({
        payer: input.payer,
        providerName: options.checkoutProvider,
      });
    } catch (error) {
      await enqueueJob({
        provider: options.checkoutProvider,
        checkoutAttemptId: attempt.id,
      });
      throw error;
    }

    try {
      const remote = await callProvider(() =>
        adapter.createCheckout({
          productId: item.price.providerProductId,
          currency: item.price.currency,
          customerId: customer.providerCustomerId!,
          payerEmail: input.payer.email,
          returnUrl: input.returnUrl,
          attemptId: attempt.attemptId,
          catalogKey: item.offerKey,
          trialDays: input.trialDays ?? 0,
          idempotencyKey: providerCheckoutKey,
        }),
      );
      const encrypted = options.sensitiveValues
        ? await options.sensitiveValues.encrypt(remote.checkoutUrl)
        : null;
      const opened = await store.withTransaction(async () => {
        const latest = (await store.findCheckoutById(attempt.id)) ?? attempt;
        if (latest.payerId !== input.payer.id) {
          throw new BillingWorkflowError("payer_mismatch");
        }
        const decision = decideCheckoutTransition(latest.status, "open", {
          now: clock.now(),
          expiresAt: latest.expiresAt,
        });
        if (!decision.allowed) {
          throw new BillingWorkflowError("operation_conflicted");
        }
        latest.status = "open";
        latest.providerCustomerRowId = customer.id;
        latest.providerCheckoutSessionId = remote.providerCheckoutSessionId;
        latest.checkoutUrlEncrypted = encrypted?.ciphertext ?? null;
        await store.saveCheckout(latest);
        await requireAudit({
          effectId: `checkout:${latest.id}:open`,
          actor: { kind: "user", id: input.payer.id },
          previous: { status: "creating" },
          next: { status: "open" },
          correlationIds: { attemptId: latest.attemptId },
        });
        telemetry.event("checkout.open", {
          attemptId: latest.attemptId,
        });
        const opened = {
          attempt: latest,
          checkoutUrl: remote.checkoutUrl,
        };
        await lifecycle?.afterCheckoutOpen?.(opened);
        return opened;
      });
      return opened;
    } catch (error) {
      await enqueueJob({
        provider: options.checkoutProvider,
        checkoutAttemptId: attempt.id,
      });
      if (error instanceof BillingWorkflowError) throw error;
      throw new BillingWorkflowError("provider_unavailable", {
        retryable: true,
      });
    }
  }

  async function startPortal(input: {
    grant: BillingActionGrant;
    entity: BillableEntityRef;
    payer: PayerRef;
    returnUrl: string;
  }) {
    if (options.mode === "oss") {
      throw new BillingWorkflowError("unsupported_operation");
    }
    validateReturnUrl(input.returnUrl, options.returnUrlValidator);
    await consumeGrant(
      input.grant,
      "portal",
      {
        kind: input.entity.kind,
        id: input.entity.id,
      },
      input.payer.id,
    );
    const sub = await store.findEntitlementSubscription(input.entity.id);
    if (!sub) throw new BillingWorkflowError("subscription_required");
    if (sub.payerId !== input.payer.id) {
      throw new BillingWorkflowError("payer_mismatch");
    }
    const customer =
      (await store.findCustomerById(sub.providerCustomerId)) ??
      (await store.findCustomerByPayer(sub.provider, sub.payerId));
    if (
      !customer ||
      customer.provider !== sub.provider ||
      customer.payerId !== sub.payerId ||
      !customer.providerCustomerId
    ) {
      throw new BillingWorkflowError("subscription_required");
    }
    const session = await callProvider(() =>
      provider(sub.provider).createPortalSession({
        customerId: customer.providerCustomerId!,
        returnUrl: input.returnUrl,
      }),
    ).catch((error) => {
      if (error instanceof BillingWorkflowError) throw error;
      throw new BillingWorkflowError("provider_unavailable", {
        retryable: true,
      });
    });
    return session;
  }

  async function startPlanChange(input: {
    grant: BillingActionGrant;
    entity: BillableEntityRef;
    payer: PayerRef;
    offerKey: string;
    catalogRevision: number;
    effectiveAt: "immediately" | "next_billing_date";
    prorationMode: "prorated_immediately" | "do_not_bill";
  }) {
    if (options.mode === "oss") {
      throw new BillingWorkflowError("unsupported_operation");
    }
    await consumeGrant(
      input.grant,
      "plan_change",
      {
        kind: input.entity.kind,
        id: input.entity.id,
      },
      input.payer.id,
    );
    const sub = await store.findEntitlementSubscription(input.entity.id);
    if (!sub) throw new BillingWorkflowError("subscription_required");
    if (sub.payerId !== input.payer.id) {
      throw new BillingWorkflowError("payer_mismatch");
    }
    if (["cancelled", "expired"].includes(sub.status)) {
      throw new BillingWorkflowError("subscription_not_changeable");
    }
    const catalog = await store.getActiveCatalog(sub.provider);
    if (
      !catalog ||
      !catalogShapeIsComplete(catalog, options.requiredOfferKeys) ||
      input.catalogRevision !== catalog.revision.revision
    ) {
      throw new BillingWorkflowError("catalog_changed", {
        details: {
          publicCatalog: await publicCatalogFor(sub.provider),
        },
      });
    }
    const target = catalog.items.find((row) => row.offerKey === input.offerKey);
    if (!target) throw new BillingWorkflowError("catalog_changed");
    if (sub.offerKey === input.offerKey) {
      throw new BillingWorkflowError("same_offer");
    }
    const adapter = provider(sub.provider);
    if (!adapter.capabilities.planChanges) {
      throw new BillingWorkflowError("plan_change_not_supported");
    }
    if (adapter.capabilities.mutationRecovery.planChange === "unsupported") {
      throw new BillingWorkflowError("plan_change_not_supported");
    }
    if (
      target.price.interval !== sub.interval &&
      !adapter.capabilities.intervalChanges
    ) {
      throw new BillingWorkflowError("plan_change_not_supported");
    }
    if (
      input.prorationMode === "prorated_immediately" &&
      !adapter.capabilities.proratedPlanChanges
    ) {
      throw new BillingWorkflowError("plan_change_not_supported");
    }
    let providerProduct: BillingProductSnapshot;
    try {
      providerProduct = await callProvider(() =>
        adapter.retrieveProduct(target.price.providerProductId),
      );
    } catch (error) {
      if (error instanceof BillingProviderError && error.code === "invalid") {
        throw new BillingWorkflowError("catalog_changed", {
          details: {
            publicCatalog: await publicCatalogFor(sub.provider),
          },
        });
      }
      throw new BillingWorkflowError("provider_unavailable", {
        retryable: true,
      });
    }
    if (!catalogMatchesProviderSnapshot(target.price, providerProduct)) {
      throw new BillingWorkflowError("catalog_changed", {
        details: {
          publicCatalog: await publicCatalogFor(sub.provider),
        },
      });
    }
    const livePlanChange = await store.findLivePlanChange(input.entity.id);
    if (livePlanChange) {
      if (
        livePlanChange.subscriptionId === sub.id &&
        livePlanChange.payerId === input.payer.id &&
        livePlanChange.targetOfferKey === input.offerKey &&
        livePlanChange.targetCatalogRevision === catalog.revision.revision &&
        livePlanChange.effectiveAt === input.effectiveAt &&
        livePlanChange.prorationMode === input.prorationMode
      ) {
        return livePlanChange;
      }
      throw new BillingWorkflowError("plan_change_pending");
    }
    let attempt: PlanChangeAttempt;
    try {
      attempt = await store.withTransaction(async () => {
        const row: PlanChangeAttempt = {
          id: newId(),
          changeId: store.newChangeId(),
          billableEntityId: input.entity.id,
          subscriptionId: sub.id,
          actorId: input.payer.id,
          payerId: input.payer.id,
          provider: sub.provider,
          idempotencyKey: `plan-change:${sub.id}:${input.offerKey}:${catalog.revision.revision}`,
          currentCatalogRevision: sub.catalogRevision,
          currentPriceEntryId: sub.priceEntryId,
          currentPlan: sub.plan,
          currentInterval: sub.interval,
          targetCatalogRevision: catalog.revision.revision,
          targetPriceEntryId: target.price.id,
          targetPlan: target.price.plan,
          targetInterval: target.price.interval,
          targetOfferKey: target.offerKey,
          effectiveAt: input.effectiveAt,
          prorationMode: input.prorationMode,
          status: "creating",
          lastError: null,
        };
        await store.insertPlanChange(row);
        return row;
      });
    } catch (error) {
      const raced = await store.findLivePlanChange(input.entity.id);
      if (
        !raced ||
        raced.subscriptionId !== sub.id ||
        raced.payerId !== input.payer.id ||
        raced.targetOfferKey !== input.offerKey
      ) {
        throw error;
      }
      attempt = raced;
    }
    try {
      const remote = await callProvider(() =>
        adapter.changeSubscriptionPlan({
          providerSubscriptionId: sub.providerSubscriptionId,
          targetProviderProductId: target.price.providerProductId,
          effectiveAt: input.effectiveAt,
          prorationMode: input.prorationMode,
          idempotencyKey: attempt.idempotencyKey,
        }),
      );
      const paymentUrl =
        remote.paymentUrl && options.sensitiveValues
          ? await options.sensitiveValues.encrypt(remote.paymentUrl)
          : null;
      return await store.withTransaction(async () => {
        const latest = (await store.findPlanChangeById(attempt.id)) ?? attempt;
        const decision = decidePlanChangeTransition(latest.status, "pending");
        if (!decision.allowed) throw new BillingWorkflowError("operation_conflicted");
        latest.status = "pending";
        latest.providerPaymentId = remote.providerPaymentId;
        latest.paymentUrlEncrypted = paymentUrl?.ciphertext ?? null;
        await store.savePlanChange(latest);
        await requireAudit({
          effectId: `plan_change:${latest.id}:pending`,
          actor: { kind: "user", id: input.payer.id },
          previous: { status: "creating" },
          next: { status: "pending" },
          correlationIds: { changeId: latest.changeId },
        });
        return latest;
      });
    } catch (error) {
      await enqueueJob({
        provider: sub.provider,
        planChangeAttemptId: attempt.id,
      });
      if (error instanceof BillingWorkflowError) throw error;
      throw new BillingWorkflowError("provider_unavailable", {
        retryable: true,
      });
    }
  }

  async function cancel(input: {
    grant: BillingActionGrant;
    entity: BillableEntityRef;
    payer: PayerRef;
  }) {
    if (options.mode === "oss") {
      throw new BillingWorkflowError("unsupported_operation");
    }
    await consumeGrant(
      input.grant,
      "cancellation",
      {
        kind: input.entity.kind,
        id: input.entity.id,
      },
      input.payer.id,
    );
    const source = await store.findEntitlementSubscription(input.entity.id);
    const sub =
      source ??
      (await store.listSubscriptionsByEntity(input.entity.id)).find(
        (row) => row.payerId === input.payer.id && row.status === "cancelled",
      );
    if (!sub) throw new BillingWorkflowError("subscription_required");
    if (sub.payerId !== input.payer.id) {
      throw new BillingWorkflowError("payer_mismatch");
    }
    if (sub.status === "cancelled") {
      return { accepted: true as const, subscriptionId: sub.id };
    }
    if (
      provider(sub.provider).capabilities.mutationRecovery.cancellation ===
      "unsupported"
    ) {
      throw new BillingWorkflowError("unsupported_operation");
    }
    await store.withTransaction(async () => {
      await requireAudit({
        effectId: `cancellation:${sub.id}:requested`,
        actor: { kind: "user", id: input.payer.id },
        previous: { status: sub.status },
        next: { requested: "provider_cancel" },
        correlationIds: { subscriptionId: sub.id },
      });
      await enqueueJobInTransaction({
        provider: sub.provider,
        subscriptionId: sub.id,
        operation: "cancellation",
      });
    });
    try {
      await callProvider(() =>
        provider(sub.provider).cancelSubscription(
          sub.providerSubscriptionId,
          `cancel:${sub.id}`,
        ),
      );
    } catch (error) {
      if (error instanceof BillingWorkflowError) throw error;
      throw new BillingWorkflowError("provider_unavailable", {
        retryable: true,
      });
    }
    return { accepted: true as const, subscriptionId: sub.id };
  }

  async function ingestWebhook(input: {
    provider: string;
    raw: { body: string; headers: Record<string, string> };
  }): Promise<{ duplicate: boolean; envelope: VerifiedWebhookEnvelope }> {
    if (
      !isBoundedOpaqueId(input.provider) ||
      typeof input.raw?.body !== "string" ||
      input.raw.body.length > 1_000_000 ||
      !input.raw.headers ||
      typeof input.raw.headers !== "object"
    ) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    const envelope = await provider(input.provider).parseWebhook(input.raw);
    if (
      envelope.provider !== input.provider ||
      !isBoundedOpaqueId(envelope.providerEventId) ||
      !isBoundedOpaqueId(envelope.eventType) ||
      (envelope.subscriptionId !== null &&
        !isBoundedOpaqueId(envelope.subscriptionId)) ||
      (envelope.verifiedKeyVersion !== null &&
        !isBoundedOpaqueId(envelope.verifiedKeyVersion)) ||
      (envelope.correlationMetadata.checkoutAttemptId !== undefined &&
        !isBoundedOpaqueId(envelope.correlationMetadata.checkoutAttemptId))
    ) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    const existing = await store.findWebhook(
      envelope.provider,
      envelope.providerEventId,
    );
    if (existing) {
      telemetry.event("webhook.duplicate", {
        providerEventId: envelope.providerEventId,
      });
      return { duplicate: true, envelope };
    }
    let encryptedPayload: {
      ciphertext: string;
      keyVersion: string;
    } | null = null;
    if (options.sensitiveValues) {
      try {
        encryptedPayload = await options.sensitiveValues.encrypt(input.raw.body);
      } catch {
        throw new BillingWorkflowError("composition_invalid");
      }
    }
    const record: WebhookInboxRecord = {
      id: newId(),
      provider: envelope.provider,
      providerEventId: envelope.providerEventId,
      eventType: envelope.eventType,
      occurredAt: envelope.occurredAt,
      subscriptionId: envelope.subscriptionId,
      checkoutAttemptId: envelope.correlationMetadata.checkoutAttemptId ?? null,
      payloadEncrypted: encryptedPayload?.ciphertext ?? null,
      payloadKeyVersion: encryptedPayload?.keyVersion ?? null,
      verifiedKeyVersion: envelope.verifiedKeyVersion,
      status: "pending",
      processingAttempts: 0,
      lastError: null,
      availableAt: clock.now(),
      lockedAt: null,
      leaseExpiresAt: null,
      workerId: null,
    };
    try {
      await store.withTransaction(async () => store.insertWebhook(record));
      return { duplicate: false, envelope };
    } catch (error) {
      const raced = await store.findWebhook(
        envelope.provider,
        envelope.providerEventId,
      );
      if (raced) {
        telemetry.event("webhook.duplicate", {
          providerEventId: envelope.providerEventId,
        });
        return { duplicate: true, envelope };
      }
      throw error;
    }
  }

  async function projectSnapshot(
    snapshot: SubscriptionSnapshot,
    correlation: { checkoutAttemptId?: string },
    reconcile = false,
  ) {
    return store.withTransaction(() =>
      projectSnapshotInTransaction(snapshot, correlation, reconcile),
    );
  }

  async function projectSnapshotInTransaction(
    snapshot: SubscriptionSnapshot,
    correlation: { checkoutAttemptId?: string },
    reconcile = false,
  ) {
    if (
      !isBoundedOpaqueId(snapshot.provider) ||
      !isBoundedOpaqueId(snapshot.providerSubscriptionId) ||
      !isBoundedOpaqueId(snapshot.providerCustomerId) ||
      !isBoundedOpaqueId(snapshot.providerProductId) ||
      !(snapshot.observedAt instanceof Date) ||
      Number.isNaN(snapshot.observedAt.getTime()) ||
      !isCanonicalSubscriptionStatus(snapshot.status) ||
      typeof snapshot.cancelAtPeriodEnd !== "boolean" ||
      !isOptionalDate(snapshot.currentPeriodStartsAt) ||
      !isOptionalDate(snapshot.currentPeriodEndsAt) ||
      !isOptionalDate(snapshot.paidThroughAt) ||
      !isOptionalDate(snapshot.trialEndsAt) ||
      !isOptionalDate(snapshot.providerOccurredAt) ||
      (snapshot.providerVersion !== null &&
        !isBoundedOpaqueId(snapshot.providerVersion)) ||
      (correlation.checkoutAttemptId !== undefined &&
        !isBoundedOpaqueId(correlation.checkoutAttemptId))
    ) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    const price = await store.findPriceByProviderProduct(
      snapshot.provider,
      snapshot.providerProductId,
    );
    if (!price) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    const existing = await store.findSubscriptionByProviderIds(
      snapshot.provider,
      snapshot.providerSubscriptionId,
    );
    const correlatedAttempt = correlation.checkoutAttemptId
      ? await store.findCheckoutByAttemptId(correlation.checkoutAttemptId)
      : undefined;
    const originAttempt =
      !correlatedAttempt && existing?.originCheckoutAttemptId
        ? await store.findCheckoutById(existing.originCheckoutAttemptId)
        : undefined;
    const attempt = correlatedAttempt ?? originAttempt;
    const billableEntityId = existing?.billableEntityId ?? attempt?.billableEntityId;
    const payerId = existing?.payerId ?? attempt?.payerId;
    const customer = await store.findCustomerByProviderCustomerId(
      snapshot.provider,
      snapshot.providerCustomerId,
    );
    if (!billableEntityId || !payerId || !customer) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    if (existing && existing.providerCustomerId !== customer.id) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    if (
      correlatedAttempt &&
      (correlatedAttempt.billableEntityId !== billableEntityId ||
        correlatedAttempt.payerId !== payerId)
    ) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    if (customer.payerId !== payerId) {
      throw new BillingWorkflowError("payer_mismatch");
    }
    if (
      correlatedAttempt &&
      (correlatedAttempt.provider !== snapshot.provider ||
        (correlatedAttempt.providerCustomerRowId !== null &&
          correlatedAttempt.providerCustomerRowId !== customer.id) ||
        // Origin checkout price applies to first activation only.
        // Later snapshots keep that checkout id in provider metadata
        // (and webhook correlation) even after a plan change.
        (!existing && correlatedAttempt.priceEntryId !== price.id))
    ) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    if (existing && isOlderProviderSnapshot(existing, snapshot)) {
      telemetry.event("projection.stale", {
        subscriptionId: existing.id,
      });
      return {
        subscription: existing,
        planState: await store.ensurePlanState(existing.billableEntityId),
        material: false,
        effectId: null,
      };
    }
    if (existing) {
      const allowed = decideSubscriptionTransition(existing.status, snapshot.status);
      if (!allowed.allowed) {
        throw new BillingWorkflowError("operation_quarantined");
      }
    }
    const pendingChange = existing
      ? await store.findPlanChangeBySubscriptionOffer(existing.id, price.offerKey)
      : undefined;
    if (
      existing &&
      snapshot.providerProductId !== existing.providerProductId &&
      !pendingChange
    ) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    if (pendingChange && pendingChange.targetPriceEntryId !== price.id) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    const lineageRevision = pendingChange
      ? pendingChange.targetCatalogRevision
      : (existing?.catalogRevision ?? attempt?.catalogRevision ?? 0);
    const lineageOffer = pendingChange
      ? pendingChange.targetOfferKey
      : (existing?.offerKey ?? attempt?.offerKey ?? price.offerKey);
    const now = clock.now();
    const paid = retainsPaidEntitlement(snapshot, now);
    const currentSource = await store.findEntitlementSubscription(billableEntityId);
    if (paid && currentSource && currentSource.id !== existing?.id) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    const next = {
      id: existing?.id ?? newId(),
      billableEntityId,
      payerId,
      provider: snapshot.provider,
      providerCustomerId: customer.id,
      providerSubscriptionId: snapshot.providerSubscriptionId,
      providerProductId: snapshot.providerProductId,
      catalogRevision: lineageRevision,
      offerKey: lineageOffer,
      plan: pendingChange?.targetPlan ?? existing?.plan ?? attempt?.plan ?? price.plan,
      interval:
        pendingChange?.targetInterval ??
        existing?.interval ??
        attempt?.interval ??
        price.interval,
      priceEntryId: pendingChange?.targetPriceEntryId ?? price.id,
      status: snapshot.status,
      currentPeriodStartsAt: snapshot.currentPeriodStartsAt,
      currentPeriodEndsAt: snapshot.currentPeriodEndsAt,
      paidThroughAt: snapshot.paidThroughAt,
      trialEndsAt: snapshot.trialEndsAt,
      cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
      isEntitlementSource: paid,
      originCheckoutAttemptId: existing?.originCheckoutAttemptId ?? attempt?.id ?? null,
      providerOccurredAt: snapshot.providerOccurredAt,
      providerVersion: snapshot.providerVersion,
      lastObservedAt: now,
      lastReconciledAt: reconcile ? now : (existing?.lastReconciledAt ?? null),
    };
    const write = await applySubscriptionProjection(store, next, now, {
      reconcile,
    });
    if (write.material && write.effectId) {
      await requireAudit({
        effectId: write.effectId,
        actor: { kind: "system", id: "billing" },
        previous: existing ?? null,
        next: write.subscription,
        correlationIds: {
          subscriptionId: write.subscription.id,
          providerSubscriptionId: snapshot.providerSubscriptionId,
        },
      });
      telemetry.event("projection.material", {
        subscriptionId: write.subscription.id,
        projectionVersion: write.planState.projectionVersion,
      });
    } else {
      telemetry.event("projection.equivalent", {
        subscriptionId: write.subscription.id,
      });
    }
    if (attempt) {
      if (attempt.status === "abandoned") {
        attempt.status = "conflicted";
      } else if (
        attempt.status === "creating" ||
        attempt.status === "open" ||
        attempt.status === "expired"
      ) {
        const decision = decideCheckoutTransition(attempt.status, "completed", {
          now,
          expiresAt: attempt.expiresAt,
          subscriptionObservedAt: snapshot.observedAt,
          entityUnchanged: attempt.billableEntityId === billableEntityId,
          payerUnchanged: attempt.payerId === payerId,
        });
        if (decision.allowed && paid) {
          attempt.status = "completed";
          attempt.completedAt = now;
        }
      }
      await store.saveCheckout(attempt);
    }
    if (pendingChange) {
      const decision = decidePlanChangeTransition(pendingChange.status, "succeeded");
      if (decision.allowed) {
        pendingChange.status = "succeeded";
        pendingChange.completedAt = now;
        await store.savePlanChange(pendingChange);
      }
    }
    await lifecycle?.afterProjection?.({
      material: write.material,
      previous: existing ?? null,
      next: write.subscription,
      planState: write.planState,
    });
    return write;
  }

  async function processWebhookRecord(record: WebhookInboxRecord, workerId: string) {
    const now = clock.now();
    const alreadyClaimed =
      record.status === "processing" && record.workerId === workerId;
    if (!alreadyClaimed) {
      if (!decideWebhookInboxTransition(record.status, "processing").allowed) {
        return;
      }
      record.status = "processing";
      record.workerId = workerId;
      record.lockedAt = now;
      record.leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
      record.processingAttempts += 1;
      await store.saveWebhook(record);
    }
    try {
      if (!record.subscriptionId) {
        record.status = "ignored";
        record.processedAt = clock.now();
        if (!(await store.saveWebhookIfOwned(record, workerId))) return;
        return;
      }
      const adapter = provider(record.provider);
      const snapshot = await callProvider(() =>
        adapter.retrieveSubscription(record.subscriptionId!),
      );
      await projectSnapshot(snapshot, {
        checkoutAttemptId:
          record.checkoutAttemptId ?? snapshot.metadata.checkoutAttemptId ?? undefined,
      });
      record.status = "processed";
      record.processedAt = clock.now();
      await store.saveWebhookIfOwned(record, workerId);
    } catch (error) {
      const retry = billingWebhookRetry(record.processingAttempts);
      record.lastError =
        error instanceof BillingWorkflowError
          ? error.code
          : providerErrorSummary(error);
      if (
        error instanceof BillingWorkflowError &&
        error.code === "operation_quarantined"
      ) {
        record.status = "quarantined";
      } else if (error instanceof BillingCompositionError) {
        record.lastError = "billing_configuration_error";
        record.status = "quarantined";
      } else if (
        error instanceof BillingProviderError &&
        ["invalid", "unauthorized", "misconfigured"].includes(error.code)
      ) {
        record.status = "quarantined";
      } else if (retry.status === "quarantined") {
        record.status = "quarantined";
      } else {
        record.status = "failed";
        record.availableAt = new Date(clock.now().getTime() + retry.delayMs);
      }
      await store.saveWebhookIfOwned(record, workerId);
    }
  }

  async function processWebhookByEventId(
    providerName: string,
    providerEventId: string,
    subscriptionId: string,
    _checkoutAttemptId?: string,
  ) {
    if (
      !isBoundedOpaqueId(providerName) ||
      !isBoundedOpaqueId(providerEventId) ||
      !isBoundedOpaqueId(subscriptionId)
    ) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    const record = await store.findWebhook(providerName, providerEventId);
    if (!record) return;
    if (record.status === "processed" || record.status === "ignored") return;
    if (record.subscriptionId !== subscriptionId) {
      record.status = "quarantined";
      record.lastError = "subscription_correlation_mismatch";
      await store.saveWebhook(record);
      throw new BillingWorkflowError("operation_quarantined");
    }
    const workerId = `event:${providerName}:${providerEventId}`;
    const claimed = await store.claimDueWebhooks(clock.now(), 1, workerId);
    const claimedRecord = claimed.find((row) => row.id === record.id);
    if (!claimedRecord) return;
    await processWebhookRecord(claimedRecord, workerId);
  }

  async function runWebhookInboxBatch(input: { workerId: string; limit?: number }) {
    if (!isBoundedOpaqueId(input.workerId)) {
      throw new BillingWorkflowError("operation_conflicted");
    }
    const limit = workLimit(input.limit);
    const due = await store.claimDueWebhooks(clock.now(), limit, input.workerId);
    for (const row of due) {
      await processWebhookRecord(row, input.workerId);
    }
    return due.length;
  }

  async function claimReconciliationJobs(input: { workerId: string; limit?: number }) {
    if (!isBoundedOpaqueId(input.workerId)) {
      throw new BillingWorkflowError("operation_conflicted");
    }
    const limit = workLimit(input.limit);
    return store.claimClaimableJobs(clock.now(), limit, input.workerId);
  }

  async function runReconciliationBatch(input: { workerId: string; limit?: number }) {
    const limit = workLimit(input.limit);
    const claimed = await claimReconciliationJobs({
      ...input,
      limit,
    });
    for (const job of claimed) {
      try {
        await reconcileJob(job);
        job.status = "completed";
      } catch (error) {
        job.lastError =
          error instanceof BillingWorkflowError
            ? error.code
            : providerErrorSummary(error);
        if (
          error instanceof BillingWorkflowError &&
          error.code === "operation_quarantined"
        ) {
          job.status = "quarantined";
        } else if (error instanceof BillingCompositionError) {
          job.lastError = "billing_configuration_error";
          job.status = "quarantined";
        } else if (
          error instanceof BillingProviderError &&
          ["invalid", "unauthorized", "misconfigured"].includes(error.code)
        ) {
          job.status = "quarantined";
        } else if (job.attemptCount >= DEFAULT_WEBHOOK_MAX_ATTEMPTS) {
          job.status = "quarantined";
        } else {
          job.status = "failed";
          job.availableAt = new Date(clock.now().getTime() + 60_000);
        }
      }
      await store.saveJobIfOwned(job, input.workerId);
    }
    return claimed.length;
  }

  async function runDeadlineBatch(input: { limit?: number } = {}) {
    const limit = workLimit(input.limit);
    const now = clock.now();
    return store.withTransaction(async () => {
      let processed = 0;
      const checkouts = await store.listExpiredCheckouts(now, limit);
      for (const attempt of checkouts) {
        const previousStatus = attempt.status;
        attempt.status = "expired";
        attempt.completedAt = now;
        attempt.checkoutUrlEncrypted = null;
        await store.saveCheckout(attempt);
        await requireAudit({
          effectId: `checkout:${attempt.id}:expired`,
          actor: { kind: "system", id: "deadline_worker" },
          previous: { status: previousStatus },
          next: { status: "expired" },
          correlationIds: { checkoutAttemptId: attempt.id },
        });
        processed += 1;
      }
      const remaining = limit - processed;
      if (remaining <= 0) return processed;
      const subscriptions = await store.listDueSubscriptionDeadlines(now, remaining);
      for (const subscription of subscriptions) {
        const state = await store.ensurePlanState(subscription.billableEntityId);
        if (state.activeSubscriptionId !== subscription.id) {
          throw new BillingWorkflowError("operation_conflicted");
        }
        const previous = { ...subscription };
        subscription.isEntitlementSource = false;
        state.activeSubscriptionId = null;
        state.projectionVersion += 1;
        await store.upsertSubscription(subscription);
        await store.savePlanState(state);
        const effectId = `projection:${subscription.id}:${state.projectionVersion}`;
        await requireAudit({
          effectId,
          actor: { kind: "system", id: "deadline_worker" },
          previous,
          next: subscription,
          correlationIds: { subscriptionId: subscription.id },
        });
        await lifecycle?.afterProjection?.({
          material: true,
          previous,
          next: subscription,
          planState: state,
        });
        processed += 1;
      }
      return processed;
    });
  }

  async function purgeExpiredSensitiveValues(input: { before: Date; limit?: number }) {
    if (
      !(input.before instanceof Date) ||
      Number.isNaN(input.before.getTime()) ||
      input.before.getTime() > clock.now().getTime()
    ) {
      throw new BillingWorkflowError("operation_conflicted");
    }
    const limit = workLimit(input.limit);
    return store.withTransaction(async () => {
      const purged = {
        checkoutUrls: 0,
        planChangeUrls: 0,
        webhookPayloads: 0,
      };
      const checkouts = await store.listPurgeableCheckouts(input.before, limit);
      for (const attempt of checkouts) {
        attempt.checkoutUrlEncrypted = null;
        await store.saveCheckout(attempt);
        await requireAudit({
          effectId: `purge:checkout-url:${attempt.id}`,
          actor: { kind: "system", id: "retention_worker" },
          previous: { retained: true },
          next: { retained: false },
          correlationIds: { checkoutAttemptId: attempt.id },
        });
        purged.checkoutUrls += 1;
      }
      let remaining = limit - purged.checkoutUrls;
      if (remaining > 0) {
        const changes = await store.listPurgeablePlanChanges(input.before, remaining);
        for (const attempt of changes) {
          attempt.paymentUrlEncrypted = null;
          await store.savePlanChange(attempt);
          await requireAudit({
            effectId: `purge:plan-change-url:${attempt.id}`,
            actor: { kind: "system", id: "retention_worker" },
            previous: { retained: true },
            next: { retained: false },
            correlationIds: { planChangeAttemptId: attempt.id },
          });
          purged.planChangeUrls += 1;
        }
        remaining -= changes.length;
      }
      if (remaining > 0) {
        const webhooks = await store.listPurgeableWebhooks(input.before, remaining);
        for (const record of webhooks) {
          record.payloadEncrypted = null;
          record.payloadKeyVersion = null;
          await store.saveWebhook(record);
          await requireAudit({
            effectId: `purge:webhook-payload:${record.id}`,
            actor: { kind: "system", id: "retention_worker" },
            previous: { retained: true },
            next: { retained: false },
            correlationIds: {
              providerEventId: record.providerEventId,
            },
          });
          purged.webhookPayloads += 1;
        }
      }
      return purged;
    });
  }

  async function reconcileJob(job: ReconciliationJob) {
    const adapter = provider(job.provider);
    if (job.checkoutAttemptId) {
      const attempt = await store.findCheckoutById(job.checkoutAttemptId);
      if (!attempt) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      if (attempt.provider !== job.provider) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      if (
        adapter.capabilities.mutationRecovery.createCustomer === "unsupported" ||
        adapter.capabilities.mutationRecovery.createCheckout === "unsupported"
      ) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      if (attempt.providerCheckoutSessionId) {
        return;
      }
      if (
        attempt.status === "completed" ||
        attempt.status === "conflicted" ||
        attempt.status === "expired" ||
        attempt.status === "abandoned"
      ) {
        return;
      }
      let customer = await store.findCustomerByPayer(attempt.provider, attempt.payerId);
      if (!customer) {
        customer = {
          id: newId(),
          provider: attempt.provider,
          payerId: attempt.payerId,
          payerEmail: attempt.payerEmail,
          providerCustomerId: null,
          idempotencyKey: `customer:${attempt.provider}:${attempt.payerId}`,
          status: "creating",
          lastError: null,
        };
        await store.withTransaction(async () => {
          await store.insertCustomer(customer!);
        });
      }
      const payerEmail = customer.payerEmail || attempt.payerEmail;
      if (!customer.providerCustomerId) {
        const remote = await callProvider(() =>
          adapter.createCustomer({
            email: payerEmail,
            idempotencyKey: customer!.idempotencyKey,
          }),
        );
        await store.withTransaction(async () => {
          const latest = (await store.findCustomerById(customer!.id)) ?? customer!;
          const decision = decideCustomerTransition(latest.status, "active");
          if (!decision.allowed) {
            throw new BillingWorkflowError("operation_quarantined");
          }
          latest.providerCustomerId = remote.providerCustomerId;
          latest.status = "active";
          await store.saveCustomer(latest);
          await requireAudit({
            effectId: `customer:${latest.id}:active`,
            actor: { kind: "system", id: "billing" },
            previous: { status: customer!.status },
            next: { status: "active" },
            correlationIds: { customerId: latest.id },
          });
        });
      }
      const price = await store.findPriceById(attempt.priceEntryId);
      if (!price) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      const ready = await store.findCustomerByPayer(attempt.provider, attempt.payerId);
      const providerCustomerId = ready?.providerCustomerId;
      if (!providerCustomerId) {
        throw new BillingWorkflowError("operation_conflicted");
      }
      const remote = await callProvider(() =>
        adapter.createCheckout({
          productId: price.providerProductId,
          currency: price.currency,
          customerId: providerCustomerId,
          payerEmail,
          returnUrl: attempt.returnUrl,
          attemptId: attempt.attemptId,
          catalogKey: attempt.offerKey,
          trialDays: 0,
          idempotencyKey: attempt.idempotencyKey,
        }),
      );
      await store.withTransaction(async () => {
        const latest = (await store.findCheckoutById(attempt.id)) ?? attempt;
        if (
          latest.provider !== attempt.provider ||
          latest.payerId !== attempt.payerId ||
          latest.billableEntityId !== attempt.billableEntityId
        ) {
          throw new BillingWorkflowError("operation_quarantined");
        }
        if (
          latest.status === "completed" ||
          latest.status === "conflicted" ||
          latest.status === "expired" ||
          latest.status === "abandoned"
        ) {
          return;
        }
        const wasCreating = latest.status === "creating";
        latest.providerCheckoutSessionId = remote.providerCheckoutSessionId;
        if (wasCreating) latest.status = "open";
        await store.saveCheckout(latest);
        if (wasCreating) {
          await requireAudit({
            effectId: `checkout:${latest.id}:open`,
            actor: { kind: "system", id: "billing" },
            previous: { status: "creating" },
            next: { status: "open" },
            correlationIds: { attemptId: latest.attemptId },
          });
          await lifecycle?.afterCheckoutOpen?.({
            attempt: latest,
            checkoutUrl: remote.checkoutUrl,
          });
        }
      });
      return;
    }
    if (job.subscriptionId) {
      const sub = await store.findSubscriptionById(job.subscriptionId);
      if (!sub) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      if (sub.provider !== job.provider) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      if (job.operation === "cancellation") {
        if (adapter.capabilities.mutationRecovery.cancellation === "unsupported") {
          throw new BillingWorkflowError("operation_quarantined");
        }
        await callProvider(() =>
          adapter.cancelSubscription(sub.providerSubscriptionId, `cancel:${sub.id}`),
        );
      }
      const snapshot = await callProvider(() =>
        adapter.retrieveSubscription(sub.providerSubscriptionId),
      );
      await projectSnapshot(snapshot, {}, true);
    }
    if (job.providerCustomerId) {
      const customer = await store.findCustomerById(job.providerCustomerId);
      if (!customer) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      if (customer.provider !== job.provider) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      if (customer.status === "active" && customer.providerCustomerId) {
        return;
      }
      if (
        customer.status === "conflicted" ||
        (customer.status === "active" && !customer.providerCustomerId)
      ) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      if (adapter.capabilities.mutationRecovery.createCustomer === "unsupported") {
        throw new BillingWorkflowError("operation_quarantined");
      }
      const remote = await callProvider(() =>
        adapter.createCustomer({
          email: customer.payerEmail,
          idempotencyKey: customer.idempotencyKey,
        }),
      );
      await store.withTransaction(async () => {
        const latest = (await store.findCustomerById(customer.id)) ?? customer;
        if (
          latest.provider !== customer.provider ||
          latest.payerId !== customer.payerId
        ) {
          throw new BillingWorkflowError("operation_quarantined");
        }
        const decision = decideCustomerTransition(latest.status, "active");
        if (!decision.allowed) {
          throw new BillingWorkflowError("operation_quarantined");
        }
        latest.providerCustomerId = remote.providerCustomerId;
        latest.status = "active";
        await store.saveCustomer(latest);
        await requireAudit({
          effectId: `customer:${latest.id}:active`,
          actor: { kind: "system", id: "billing" },
          previous: { status: customer.status },
          next: { status: "active" },
          correlationIds: { customerId: latest.id },
        });
      });
    }
    if (job.planChangeAttemptId) {
      const attempt = await store.findPlanChangeById(job.planChangeAttemptId);
      if (!attempt) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      const sub = await store.findSubscriptionById(attempt.subscriptionId);
      if (!sub) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      if (sub.provider !== attempt.provider) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      if (
        attempt.status === "succeeded" ||
        attempt.status === "failed" ||
        attempt.status === "conflicted"
      ) {
        return;
      }
      const target = await store.findPriceById(attempt.targetPriceEntryId);
      if (!target) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      if (target.provider !== attempt.provider) {
        throw new BillingWorkflowError("operation_quarantined");
      }
      if (adapter.capabilities.mutationRecovery.planChange === "unsupported") {
        throw new BillingWorkflowError("operation_quarantined");
      }
      const remote = await callProvider(() =>
        adapter.changeSubscriptionPlan({
          providerSubscriptionId: sub.providerSubscriptionId,
          targetProviderProductId: target.providerProductId,
          effectiveAt: attempt.effectiveAt,
          prorationMode: attempt.prorationMode,
          idempotencyKey: attempt.idempotencyKey,
        }),
      );
      const encryptedPaymentUrl =
        remote.paymentUrl && options.sensitiveValues
          ? await options.sensitiveValues.encrypt(remote.paymentUrl)
          : null;
      await store.withTransaction(async () => {
        const latest = (await store.findPlanChangeById(attempt.id)) ?? attempt;
        if (
          latest.provider !== attempt.provider ||
          latest.subscriptionId !== attempt.subscriptionId ||
          latest.payerId !== attempt.payerId
        ) {
          throw new BillingWorkflowError("operation_quarantined");
        }
        const wasCreating = latest.status === "creating";
        if (
          latest.status === "succeeded" ||
          latest.status === "failed" ||
          latest.status === "conflicted"
        ) {
          return;
        }
        if (wasCreating) latest.status = "pending";
        latest.providerPaymentId = remote.providerPaymentId;
        latest.paymentUrlEncrypted = encryptedPaymentUrl
          ? encryptedPaymentUrl.ciphertext
          : latest.paymentUrlEncrypted;
        await store.savePlanChange(latest);
        if (wasCreating) {
          await requireAudit({
            effectId: `plan_change:${latest.id}:pending`,
            actor: { kind: "system", id: "billing" },
            previous: { status: "creating" },
            next: { status: "pending" },
            correlationIds: { changeId: latest.changeId },
          });
        }
      });
    }
  }

  async function getBillableEntityBillingBlockers(
    entity: BillableEntityRef,
    now: Date,
  ): Promise<BillingBlocker[]> {
    const blockers: BillingBlocker[] = [];
    const subscriptions = await store.listSubscriptionsByEntity(entity.id);
    if (subscriptions.some((sub) => !["cancelled", "expired"].includes(sub.status))) {
      blockers.push("nonterminal_subscription");
    }
    if (subscriptions.some((sub) => retainsPaidEntitlement(sub, now))) {
      blockers.push("future_paid_entitlement");
    }
    if (await store.findLiveCheckout(entity.id)) {
      blockers.push("live_checkout");
    }
    if (await store.findLivePlanChange(entity.id)) {
      blockers.push("pending_plan_change");
    }
    return blockers;
  }

  async function getPayerBillingResponsibilities(
    payer: PayerRef,
    now: Date,
  ): Promise<PayerResponsibility[]> {
    const customers = await store.listCustomersByPayer(payer.id);
    const subscriptions = await store.listSubscriptionsByPayer(payer.id);
    return customers.map((customer) => ({
      provider: customer.provider,
      providerCustomerId: customer.providerCustomerId,
      subscriptionIds: subscriptions
        .filter((row) => {
          if (row.provider !== customer.provider) return false;
          return (
            !["cancelled", "expired"].includes(row.status) ||
            retainsPaidEntitlement(row, now)
          );
        })
        .map((row) => row.id),
    }));
  }

  async function recordOperatorAudit(
    context: OperatorContext,
    effectId: string,
    previous: unknown,
    next: unknown,
    correlationIds: Record<string, string> = {},
  ): Promise<void> {
    assertOperatorContext(context);
    await requireAudit({
      effectId,
      actor: { kind: "operator", id: context.actorId },
      reason: context.reason,
      previous,
      next,
      correlationIds: {
        ...correlationIds,
        ...(context.ticket ? { ticket: context.ticket } : {}),
      },
    });
  }

  async function commercialState(entityId: string): Promise<CommercialBillingState> {
    const state = (await store.findPlanState(entityId)) ?? {
      billableEntityId: entityId,
      activeSubscriptionId: null,
      projectionVersion: 0,
    };
    const pointed = state.activeSubscriptionId
      ? await store.findSubscriptionById(state.activeSubscriptionId)
      : undefined;
    const sub = pointed?.isEntitlementSource ? pointed : undefined;
    return {
      activePaidPlan: sub?.plan ?? null,
      billingInterval: sub?.interval ?? null,
      subscriptionStatus: sub?.status ?? null,
      providerTrialEndsAt: sub?.trialEndsAt ?? null,
      currentPeriodEndsAt: sub?.currentPeriodEndsAt ?? null,
      paidThroughAt: sub?.paidThroughAt ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      pendingCheckout: Boolean(await store.findLiveCheckout(entityId)),
      pendingPlanChange: Boolean(await store.findLivePlanChange(entityId)),
      projectionVersion: state.projectionVersion,
    };
  }

  async function operatorCancel(context: OperatorContext, subscriptionId: string) {
    if (options.mode === "oss") {
      throw new BillingWorkflowError("unsupported_operation");
    }
    assertOperatorContext(context);
    const sub = await store.findSubscriptionById(subscriptionId);
    if (!sub) throw new BillingWorkflowError("subscription_required");
    if (sub.status === "cancelled" || sub.status === "expired") return;
    if (
      provider(sub.provider).capabilities.mutationRecovery.cancellation ===
      "unsupported"
    ) {
      throw new BillingWorkflowError("unsupported_operation");
    }
    await store.withTransaction(async () => {
      await recordOperatorAudit(
        context,
        `operator:cancel:${sub.id}:${context.actorId}`,
        { status: sub.status },
        { requested: "provider_cancel" },
        { subscriptionId: sub.id },
      );
      await enqueueJobInTransaction({
        provider: sub.provider,
        subscriptionId: sub.id,
        operation: "cancellation",
      });
    });
    try {
      await callProvider(() =>
        provider(sub.provider).cancelSubscription(
          sub.providerSubscriptionId,
          `operator-cancel:${sub.id}`,
        ),
      );
    } catch (error) {
      if (error instanceof BillingWorkflowError) throw error;
      throw new BillingWorkflowError("provider_unavailable", {
        retryable: true,
      });
    }
  }

  async function abandonRequestedCatalog(context: OperatorContext) {
    if (options.mode === "oss") {
      throw new BillingWorkflowError("unsupported_operation");
    }
    assertOperatorContext(context);
    return store.withTransaction(async () => {
      const catalog = await store.getCatalogRevision(
        options.checkoutProvider,
        options.requestedRevision!,
      );
      if (!catalog) {
        throw new BillingWorkflowError("catalog_unavailable");
      }
      if (catalog.revision.status === "abandoned") {
        return catalog.revision;
      }
      if (
        catalog.revision.status !== "pending_verification" &&
        catalog.revision.status !== "invalid"
      ) {
        throw new BillingWorkflowError("operation_conflicted");
      }
      const previous = { ...catalog.revision };
      catalog.revision.status = "abandoned";
      await store.saveCatalogRevision(catalog.revision);
      await recordOperatorAudit(
        context,
        `operator:abandon-catalog:${catalog.revision.id}`,
        previous,
        catalog.revision,
        { catalogRevisionId: catalog.revision.id },
      );
      return catalog.revision;
    });
  }

  async function projectFromProvider(input: {
    providerSubscriptionId: string;
    checkoutAttemptId?: string;
  }) {
    if (options.mode === "oss" || !options.checkoutProvider) {
      throw new BillingWorkflowError("unsupported_operation");
    }
    if (!isBoundedOpaqueId(input.providerSubscriptionId)) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    if (
      input.checkoutAttemptId !== undefined &&
      !isBoundedOpaqueId(input.checkoutAttemptId)
    ) {
      throw new BillingWorkflowError("operation_quarantined");
    }
    const adapter = provider(options.checkoutProvider);
    const snapshot = await callProvider(() =>
      adapter.retrieveSubscription(input.providerSubscriptionId),
    );
    return projectSnapshot(snapshot, {
      checkoutAttemptId: input.checkoutAttemptId ?? snapshot.metadata.checkoutAttemptId,
    });
  }

  return {
    store,
    startCheckout,
    startPortal,
    startPlanChange,
    cancel,
    ingestWebhook,
    processWebhookByEventId,
    runWebhookInboxBatch,
    runReconciliationBatch,
    runDeadlineBatch,
    purgeExpiredSensitiveValues,
    claimReconciliationJobs,
    projectSnapshot,
    projectFromProvider,
    getBillableEntityBillingBlockers,
    getPayerBillingResponsibilities,
    commercialState,
    publicCatalog,
    recordRequestedCatalog,
    verifyRequestedCatalog,
    abandonRequestedCatalog,
    operatorCancel,
    recordOperatorAudit,
    enqueueJob,
    resolveCustomer,
  };
}

export type BillingEngine = ReturnType<typeof createBilling>;

function catalogShapeIsComplete(
  catalog: Awaited<ReturnType<BillingStore["getActiveCatalog"]>>,
  requiredOfferKeys: readonly string[],
): boolean {
  if (!catalog) return false;
  const keys = catalog.items.map((item) => item.offerKey);
  if (new Set(keys).size !== keys.length) return false;
  if (
    keys.length !== requiredOfferKeys.length ||
    new Set(requiredOfferKeys).size !== requiredOfferKeys.length
  ) {
    return false;
  }
  const required = new Set(requiredOfferKeys);
  return catalog.items.every(
    (item) =>
      required.has(item.offerKey) &&
      item.price.provider === catalog.revision.checkoutProvider &&
      isBoundedOpaqueId(item.offerKey) &&
      isBoundedOpaqueId(item.price.id) &&
      isBoundedOpaqueId(item.price.providerProductId) &&
      Number.isSafeInteger(item.price.amountMinor) &&
      item.price.amountMinor > 0 &&
      Number.isSafeInteger(item.price.providerTrialDays) &&
      item.price.providerTrialDays >= 0 &&
      /^[A-Z]{3}$/.test(item.price.currency) &&
      (item.price.interval === "month" || item.price.interval === "year"),
  );
}

function priceMatchesDeclaredOffer(price: PriceEntryRow, offer: BillingOffer): boolean {
  return (
    price.offerKey === offer.key &&
    price.plan === offer.plan &&
    price.interval === offer.interval &&
    price.currency === offer.currency &&
    price.amountMinor === offer.amountMinor &&
    price.providerTrialDays === offer.providerTrialDays &&
    price.provider === offer.provider &&
    price.providerProductId === offer.providerProductId
  );
}

function catalogMatchesDeclaredOffers(
  catalog: MemoryCatalog,
  offers: readonly BillingOffer[],
): boolean {
  if (catalog.items.length !== offers.length) return false;
  return offers.every((offer) => {
    const item = catalog.items.find((candidate) => candidate.offerKey === offer.key);
    return Boolean(item && priceMatchesDeclaredOffer(item.price, offer));
  });
}

function validateReturnUrl(value: string, validator?: (url: string) => boolean): void {
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (
      (url.protocol !== "https:" && !localHttp) ||
      !url.hostname ||
      url.username ||
      url.password ||
      (validator && !validator(value))
    ) {
      throw new Error("return_url_not_allowed");
    }
  } catch {
    throw new BillingWorkflowError("invalid_return_url");
  }
}

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

function isBoundedOpaqueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value === value.trim() &&
    !/\s/.test(value)
  );
}

function workLimit(value: number | undefined): number {
  if (value === undefined) return 10;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new BillingWorkflowError("operation_conflicted");
  }
  return Math.min(value, 1_000);
}

function isOptionalDate(value: unknown): value is Date | null {
  return value === null || (value instanceof Date && !Number.isNaN(value.getTime()));
}

function isCanonicalSubscriptionStatus(
  value: unknown,
): value is CanonicalSubscription["status"] {
  return (
    value === "pending" ||
    value === "trialing" ||
    value === "active" ||
    value === "past_due" ||
    value === "cancelled" ||
    value === "expired"
  );
}

function isOlderProviderSnapshot(
  existing: CanonicalSubscription,
  incoming: SubscriptionSnapshot,
): boolean {
  if (existing.providerVersion && incoming.providerVersion) {
    const existingNumber = Number(existing.providerVersion);
    const incomingNumber = Number(incoming.providerVersion);
    if (Number.isSafeInteger(existingNumber) && Number.isSafeInteger(incomingNumber)) {
      if (incomingNumber < existingNumber) return true;
      if (incomingNumber > existingNumber) return false;
    }
  }
  if (existing.providerOccurredAt && incoming.providerOccurredAt) {
    return (
      incoming.providerOccurredAt.getTime() < existing.providerOccurredAt.getTime()
    );
  }
  return false;
}
