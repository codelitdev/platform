import { BillingCompositionError } from "../core/errors.js";
import type { BillingProviderAdapter } from "./contract.js";

export class BillingProviderRegistry {
    private readonly adapters = new Map<string, BillingProviderAdapter>();

    constructor(adapters: BillingProviderAdapter[] = []) {
        for (const adapter of adapters) this.register(adapter);
    }

    register(adapter: BillingProviderAdapter): void {
        if (
            typeof adapter.provider !== "string" ||
            !/^[a-z][a-z0-9_-]{1,31}$/.test(adapter.provider)
        ) {
            throw new BillingCompositionError("provider_name_invalid");
        }
        if (this.adapters.has(adapter.provider)) {
            throw new BillingCompositionError(
                `provider_already_registered:${adapter.provider}`,
            );
        }
        this.adapters.set(adapter.provider, adapter);
    }

    get(provider: string): BillingProviderAdapter {
        const adapter = this.adapters.get(provider);
        if (!adapter) {
            throw new BillingCompositionError(
                `provider_not_registered:${provider}`,
            );
        }
        return adapter;
    }

    has(provider: string): boolean {
        return this.adapters.has(provider);
    }

    list(): BillingProviderAdapter[] {
        return [...this.adapters.values()];
    }
}
