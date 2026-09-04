import { describe, expect, it } from "bun:test";
import {
  diffProjection,
  type MaterialSnapshotFields,
  nextProjectionVersion,
} from "./projection-diff.js";

const base: MaterialSnapshotFields = {
  status: "active",
  providerProductId: "pdt_pro_month",
  priceEntryId: "pe_1",
  catalogRevision: 1,
  offerKey: "pro_month",
  plan: "pro",
  interval: "month",
  currentPeriodStartsAt: new Date("2026-01-01T00:00:00.000Z"),
  currentPeriodEndsAt: new Date("2026-02-01T00:00:00.000Z"),
  paidThroughAt: new Date("2026-02-01T00:00:00.000Z"),
  trialEndsAt: null,
  cancelAtPeriodEnd: false,
  activeSubscriptionId: "sub_1",
};

describe("projection diff", () => {
  it("equivalent snapshot is freshness-only and does not bump version", () => {
    const observed = new Date("2026-01-02T00:00:00.000Z");
    const diff = diffProjection(
      base,
      { ...base },
      {
        lastObservedAt: observed,
        lastReconciledAt: observed,
      },
    );
    expect(diff.kind).toBe("equivalent");
    expect(nextProjectionVersion(4, diff)).toBe(4);
  });

  it("material commercial change increments version once", () => {
    const next = { ...base, status: "past_due" as const };
    const observed = new Date("2026-01-03T00:00:00.000Z");
    const diff = diffProjection(base, next, {
      lastObservedAt: observed,
      lastReconciledAt: observed,
    });
    expect(diff.kind).toBe("material");
    expect(nextProjectionVersion(4, diff)).toBe(5);
    expect(nextProjectionVersion(5, diff)).toBe(6);
  });

  it("cancelAtPeriodEnd is material even when status is unchanged", () => {
    const next = { ...base, cancelAtPeriodEnd: true };
    const diff = diffProjection(base, next, {
      lastObservedAt: new Date(),
      lastReconciledAt: null,
    });
    expect(diff.kind).toBe("material");
  });
});
