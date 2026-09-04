import { describe, expect, it } from "bun:test";
import { frozenClock } from "./clock.js";
import { money } from "./money.js";

describe("money", () => {
  it("accepts integer minor units and uppercase ISO 4217", () => {
    expect(money(4900, "usd")).toEqual({
      amountMinor: 4900,
      currency: "USD",
    });
  });

  it("rejects fractional, zero, and lowercase-invalid currencies", () => {
    expect(() => money(49.5, "USD")).toThrow(/amount_minor_invalid/);
    expect(() => money(0, "USD")).toThrow(/amount_minor_invalid/);
    expect(() => money(100, "US")).toThrow(/currency_invalid/);
    expect(() => money(100, "usd1")).toThrow(/currency_invalid/);
  });
});

describe("clock", () => {
  it("frozen clock never reads wall time", () => {
    const at = new Date("2020-01-01T00:00:00.000Z");
    const clock = frozenClock(at);
    const before = Date.now();
    expect(clock.now().toISOString()).toBe(at.toISOString());
    expect(clock.now().getTime()).toBe(at.getTime());
    expect(Date.now()).toBeGreaterThanOrEqual(before);
  });
});
