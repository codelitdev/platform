import { validateBillingConfig, type BillingConfig } from "./validate.js";

export function defineBillingConfig(config: BillingConfig): BillingConfig {
    return validateBillingConfig(config);
}
