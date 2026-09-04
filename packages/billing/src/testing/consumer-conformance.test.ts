import { describe, expect, it } from "bun:test";
import courselitConfig from "../../examples/consumers/courselit/billing.config.js";
import sendlitConfig from "../../examples/consumers/sendlit/billing.config.js";
import { renderGeneratedSchema } from "../schema/generator.js";
import {
  courselitShapedCatalog,
  sendlitShapedCatalog,
} from "./consumer-conformance.js";

describe("consumer conformance shapes", () => {
  it("keeps SendLit Free in the application catalog, not generated planIds", () => {
    expect(sendlitShapedCatalog().applicationFreePlan).toBe("free");
    expect(sendlitConfig.planIds).not.toContain("free");
    expect(renderGeneratedSchema(sendlitConfig)).not.toMatch(
      /IN \('pro', 'business', 'free'\)/,
    );
  });

  it("keeps CourseLit Cloud without Free state", () => {
    expect(courselitShapedCatalog().applicationFreePlan).toBeNull();
    expect(courselitConfig.planIds).not.toContain("free");
    expect(renderGeneratedSchema(courselitConfig)).not.toMatch(/\bfree\b/);
  });
});
