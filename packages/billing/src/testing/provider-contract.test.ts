import { describe, expect, it } from "vitest";
import { BillingProviderError } from "../core/errors.js";
import { FakeBillingProvider } from "../providers/fake/index.js";
import {
    createContractFake,
    runBillingProviderContract,
} from "./provider-contract.js";

describe("provider contract", () => {
    it("fake satisfies the exported contract including timeout recovery", async () => {
        const { adapter, helpers } = createContractFake();
        await runBillingProviderContract(adapter, helpers);
    });

    it("outage fails all remote calls with unavailable", async () => {
        const adapter = new FakeBillingProvider();
        adapter.seedDefaultCatalog();
        adapter.controls.outage = true;
        await expect(
            adapter.retrieveProduct("pdt_pro_month"),
        ).rejects.toBeInstanceOf(BillingProviderError);
    });

    it("capabilities match implemented recovery", () => {
        const adapter = new FakeBillingProvider();
        expect(adapter.capabilities.mutationRecovery).toEqual({
            createCustomer: "idempotency_key",
            createCheckout: "idempotency_key",
            planChange: "idempotency_key",
            cancellation: "idempotency_key",
        });
    });
});
