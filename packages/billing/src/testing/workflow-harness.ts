import { frozenClock } from "../core/clock.js";
import { MemoryAuditHook } from "../ports/audit.js";
import { MemoryAuthorizationPort } from "../ports/authorization.js";
import { MemoryTelemetry } from "../ports/telemetry.js";
import { MemoryBillingStore } from "../persistence/memory.js";
import { FakeBillingProvider } from "../providers/fake/index.js";
import { createBilling } from "../workflows/engine.js";
import { COURSELIT_OFFER_KEYS, REFERENCE_OFFERS } from "./fixtures.js";
import type { BillingOffer } from "../catalog/types.js";

export function createBillingFrom(
    store: MemoryBillingStore,
    fake: FakeBillingProvider,
    now: Date,
    offers: BillingOffer[],
    extras: {
        authorization?: MemoryAuthorizationPort;
        audit?: MemoryAuditHook;
    } = {},
) {
    return createBilling({
        database: store,
        providers: [fake],
        clock: frozenClock(now),
        authorization: extras.authorization ?? new MemoryAuthorizationPort(),
        hooks: { audit: extras.audit ?? new MemoryAuditHook() },
        mode: "cloud",
        checkoutProvider: "fake",
        requestedRevision: offers[0]!.revision,
        requiredOfferKeys: [...COURSELIT_OFFER_KEYS],
        offers,
        returnUrlValidator: (url) => url.startsWith("https://app.test/"),
    });
}

export function createWorkflowHarness(
    now = new Date("2026-01-01T00:00:00.000Z"),
    options: {
        seedLocalCatalog?: boolean;
        offers?: BillingOffer[];
    } = {},
) {
    const clock = frozenClock(now);
    const fake = new FakeBillingProvider({ clock });
    fake.seedDefaultCatalog();
    const store = new MemoryBillingStore();
    const offers = options.offers ?? REFERENCE_OFFERS;
    if (options.seedLocalCatalog !== false) {
        store.seedCatalog({
            revision: offers[0]!.revision,
            provider: "fake",
            offers,
        });
    }
    const authorization = new MemoryAuthorizationPort();
    const audit = new MemoryAuditHook();
    const telemetry = new MemoryTelemetry();
    const billing = createBilling({
        database: store,
        providers: [fake],
        clock,
        authorization,
        hooks: { audit },
        telemetry,
        mode: "cloud",
        checkoutProvider: "fake",
        requestedRevision: offers[0]!.revision,
        requiredOfferKeys: [...COURSELIT_OFFER_KEYS],
        offers,
        returnUrlValidator: (url) => url.startsWith("https://app.test/"),
    });
    return {
        billing,
        fake,
        store,
        authorization,
        audit,
        telemetry,
        clock,
        now,
    };
}
