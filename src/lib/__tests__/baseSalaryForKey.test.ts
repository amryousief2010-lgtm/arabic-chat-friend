import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASE_SALARY,
  baseSalaryForKey,
  payrollDefaultForMonth,
} from "../../constants/moderators";

describe("baseSalaryForKey", () => {
  it("keeps آية's own salary when the shared default changes", () => {
    expect(baseSalaryForKey("اية", 4000)).toBe(3000);
    expect(baseSalaryForKey("اية")).toBe(3000);
  });

  it("uses the shared default for moderators still on the historical 2,500", () => {
    for (const key of ["نورا", "منال", "مريم"]) {
      expect(baseSalaryForKey(key)).toBe(DEFAULT_BASE_SALARY);
      expect(baseSalaryForKey(key, 2800)).toBe(2800);
    }
  });

  it("uses the shared default when the payroll key is unknown", () => {
    expect(baseSalaryForKey("غير معروفة", 3200)).toBe(3200);
    expect(baseSalaryForKey("غير معروفة")).toBe(DEFAULT_BASE_SALARY);
  });
});

describe("payrollDefaultForMonth", () => {
  it("applies the edited value only after the month is known to be open", () => {
    expect(payrollDefaultForMonth(true, false, 4000, 2500)).toBe(4000);
    expect(payrollDefaultForMonth(true, false, 4, 3.5)).toBe(4);
  });

  it("keeps the historical value for a closed month and while closure status is unknown", () => {
    expect(payrollDefaultForMonth(true, true, 4000, 2500)).toBe(2500);
    expect(payrollDefaultForMonth(false, false, 4000, 2500)).toBe(2500);
    expect(payrollDefaultForMonth(true, true, 5, 3.5)).toBe(3.5);
  });
});
