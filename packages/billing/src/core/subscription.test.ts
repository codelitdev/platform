import { describe, expect, it } from "bun:test";
import { retainsPaidEntitlement } from "./subscription.js";

const now = new Date("2026-06-01T00:00:00.000Z");
const future = new Date("2026-07-01T00:00:00.000Z");
const past = new Date("2026-05-01T00:00:00.000Z");

describe("retainsPaidEntitlement", () => {
  it("keeps paid statuses inside the paid period and the grace after it", () => {
    for (const status of ["active", "trialing", "past_due"] as const) {
      expect(
        retainsPaidEntitlement(
          { status, cancelAtPeriodEnd: false, paidThroughAt: future },
          now,
        ),
      ).toBe(true);
      // Six days past the paid-through date: still inside the default seven-day grace.
      const sixDaysAgo = new Date(now.getTime() - 6 * 86_400_000);
      expect(
        retainsPaidEntitlement(
          { status, cancelAtPeriodEnd: false, paidThroughAt: sixDaysAgo },
          now,
        ),
      ).toBe(true);
    }
  });

  it("ends every paid status once the grace after paidThroughAt has passed", () => {
    // A lost renewal, failure or cancellation webhook can't keep access forever.
    for (const status of ["active", "trialing", "past_due"] as const) {
      expect(
        retainsPaidEntitlement(
          { status, cancelAtPeriodEnd: false, paidThroughAt: past },
          now,
        ),
      ).toBe(false);
    }
    const eightDaysAgo = new Date(now.getTime() - 8 * 86_400_000);
    expect(
      retainsPaidEntitlement(
        { status: "active", cancelAtPeriodEnd: false, paidThroughAt: eightDaysAgo },
        now,
      ),
    ).toBe(false);
  });

  it("uses the grace it is given", () => {
    const anHourAgo = new Date(now.getTime() - 3_600_000);
    const paid = {
      status: "past_due" as const,
      cancelAtPeriodEnd: false,
      paidThroughAt: anHourAgo,
    };
    expect(retainsPaidEntitlement(paid, now, 0)).toBe(false);
    expect(retainsPaidEntitlement(paid, now, 2 * 3_600_000)).toBe(true);
  });

  it("keeps a paid status the provider gave no paid-through date", () => {
    expect(
      retainsPaidEntitlement(
        { status: "active", cancelAtPeriodEnd: false, paidThroughAt: null },
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
