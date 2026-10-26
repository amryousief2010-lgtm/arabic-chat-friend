import { describe, it, expect } from "vitest";
import { canEditPayDay, payDayPatch } from "./payDay";

describe("pay day editing", () => {
  it("only GM and executive director may edit", () => {
    expect(canEditPayDay({ isGeneralManager: true, isExecutiveManager: false })).toBe(true);
    expect(canEditPayDay({ isGeneralManager: false, isExecutiveManager: true })).toBe(true);
    expect(canEditPayDay({ isGeneralManager: false, isExecutiveManager: false })).toBe(false);
  });
  it("read-only roles send nothing", () => {
    expect(payDayPatch(false, 5)).toEqual({});
  });
  it("manual value is flagged so the auto rule keeps it", () => {
    expect(payDayPatch(true, 15)).toEqual({ pay_day_manual: true, pay_day: 15 });
  });
  it("auto clears the flag", () => {
    expect(payDayPatch(true, "auto")).toEqual({ pay_day_manual: false });
  });
  it("rejects invalid days", () => {
    expect(payDayPatch(true, 7)).toEqual({});
  });
});
