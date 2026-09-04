import { describe, expect, it } from "bun:test";
import courselitConfig from "../../examples/consumers/courselit/billing.config.js";
import sendlitConfig from "../../examples/consumers/sendlit/billing.config.js";
import {
  courselitShapedCatalog,
  sendlitShapedCatalog,
} from "../testing/consumer-conformance.js";
import { COURSELIT_OFFER_KEYS } from "../testing/fixtures.js";
import { renderGeneratedSchema } from "./generator.js";

describe("consumer schema mappings", () => {
  it("maps SendLit onto organizations and existing billing_* tables", () => {
    const source = renderGeneratedSchema(sendlitConfig);
    expect(source).toContain('from "./organizations"');
    expect(source).toContain("organizations.id");
    expect(source).toContain('"billing_price_entries"');
    expect(source).toContain('"billing_subscriptions"');
    expect(source).toContain('"billing_plan_states"');
    expect(source).not.toContain("organization_subscriptions");
    expect(source).not.toContain("organization_plan_states");
    expect(source).toContain("rampStage");
    expect(source).toContain("pendingTeamName");
    expect(source).toContain("teamLimitOverride");
    expect(source).toContain("contactLimitOverride");
    expect(source).toMatch(/billingPlanStates[\s\S]*plan: text\("plan"\)/);
    expect(sendlitConfig.planIds).toEqual(["pro", "business"]);
    expect(sendlitConfig.planIds).not.toContain("free");
    expect(sendlitShapedCatalog().applicationFreePlan).toBe("free");
    expect(sendlitConfig.requiredOfferKeys).toEqual([...COURSELIT_OFFER_KEYS]);
  });

  it("maps CourseLit onto schools with no Free plan column", () => {
    const source = renderGeneratedSchema(courselitConfig);
    expect(source).toContain('from "./schools"');
    expect(source).toContain('"billing_subscriptions"');
    expect(source).toContain("schools.id");
    expect(source).toContain("accounts.id");
    expect(source).not.toContain("school_subscriptions");
    expect(source).not.toMatch(/\bfree\b/);
    expect(source).not.toContain("rampStage");
    expect(source).not.toContain("pendingTeamName");
    expect(courselitConfig.planIds).toEqual(["pro", "business"]);
    expect(courselitShapedCatalog().applicationFreePlan).toBeNull();
    expect(courselitShapedCatalog().entitiesPerPayer).toBe(2);
  });
});
