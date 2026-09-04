/** Experimental until CourseLit consumes the same workflow/hook contract. */

export type { PlanStateRow } from "../persistence/store.js";
export type { AuditRecord, BillingAuditHook } from "../ports/audit.js";
export { MemoryAuditHook } from "../ports/audit.js";
export type {
  BillingAction,
  BillingActionGrant,
  BillingAuthorizationPort,
} from "../ports/authorization.js";
export { MemoryAuthorizationPort } from "../ports/authorization.js";
export type { BillingLifecycleHooks } from "../ports/lifecycle.js";
export {
  type BillingEngine,
  type CommercialBillingState,
  type CreateBillingOptions,
  createBilling,
  type OperatorContext,
} from "./engine.js";
export {
  getBillableEntityBillingBlockers,
  getPayerBillingResponsibilities,
} from "./lifecycle.js";
