import { describe, expect, it } from "bun:test";
import { retainsPaidEntitlement } from "./subscription.js";

const now = new Date("2026-06-01T00:00:00.000Z");
const future = new Date("2026-07-01T00:00:00.000Z");
const past = new Date("2026-05-01T00:00:00.000Z");

describe("retainsPaidEntitlement", () => {
  it("keeps paid statuses", () => {
    expect(
      retainsPaidEntitlement(
        { status: "active", cancelAtPeriodEnd: false, paidThroughAt: past },
        now,
      ),
    ).toBe(true);
  });

  it("keeps a scheduled cancellation until the period ends", () => {
    for (const status of ["active", "cancelled"] as const) {
      expect(
        retainsPaidEntitlement(
          { status, cancelAtPeriodEnd: true, paidThroughAt: future },
          now,
        ),
      ).toBe(true);
      expect(
        retainsPaidEntitlement(
          { status, cancelAtPeriodEnd: true, paidThroughAt: past },
          now,
        ),
      ).toBe(false);
    }
  });

  it("drops an immediate cancellation", () => {
    expect(
      retainsPaidEntitlement(
        { status: "cancelled", cancelAtPeriodEnd: false, paidThroughAt: future },
        now,
      ),
    ).toBe(false);
  });
});
