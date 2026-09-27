import { describe, expect, it } from "vitest";
import { signedDelta } from "../warehouseMovementSign";

describe("signedDelta", () => {
  it("uses stock_after − stock_before when both snapshots exist", () => {
    expect(signedDelta("adjustment", 40, { effect_mode: "set", stock_before: 10, stock_after: 40 })).toBe(30);
    expect(signedDelta("adjustment", -5, { effect_mode: "delta", stock_before: 12, stock_after: 7 })).toBe(-5);
    expect(signedDelta("in", 4, { stock_before: 10, stock_after: 14 })).toBe(4);
  });

  it("treats a delta adjustment as the signed quantity", () => {
    expect(signedDelta("adjustment", -3, { effect_mode: "delta" })).toBe(-3);
    expect(signedDelta("reconciliation", 2.5, { effect_mode: "delta" })).toBe(2.5);
  });

  it("does not treat an absolute adjustment target as a movement", () => {
    expect(signedDelta("adjustment", 40)).toBe(0);
    expect(signedDelta("adjustment", 40, { effect_mode: "set" })).toBe(0);
    expect(signedDelta("reconciliation", 8, { effect_mode: null })).toBe(0);
  });

  it("keeps inbound and outbound signs", () => {
    expect(signedDelta("in", 5)).toBe(5);
    expect(signedDelta("sales_return", 2)).toBe(2);
    expect(signedDelta("out", 3)).toBe(-3);
    expect(signedDelta("sales_dispatch", 4)).toBe(-4);
    expect(signedDelta("opening_balance", 9)).toBe(9);
    expect(signedDelta("opening_balance", 9, { effect_mode: "set" })).toBe(0);
  });
});
