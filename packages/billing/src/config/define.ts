import { type BillingConfig, validateBillingConfig } from "./validate.js";

export function defineBillingConfig(config: BillingConfig): BillingConfig {
  return validateBillingConfig(config);
}
