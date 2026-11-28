import { describe, expect, it } from "vitest";
import { arDate, egp, num, pct, riyadhTime } from "../format";

const ARABIC_INDIC = /[\u0660-\u0669\u06F0-\u06F9]/;

describe("aiReports format: أرقام لاتينية دايمًا", () => {
  it("المبالغ والنسب والأعداد بأرقام لاتينية", () => {
    expect(egp(98075.4)).toBe("98,075 جنيه");
    expect(num(71.43, 1)).toBe("71.4");
    expect(pct(11.6)).toBe("11.6%");
    for (const s of [egp(10654), num(1234567), pct(9.1), num(3, 1)]) expect(s).not.toMatch(ARABIC_INDIC);
  });
  it("التواريخ والأوقات بأرقام لاتينية", () => {
    expect(arDate("2026-11-27")).toContain("27");
    expect(arDate("2026-11-27")).not.toMatch(ARABIC_INDIC);
    expect(riyadhTime("2026-11-27T10:00:00Z")).not.toMatch(ARABIC_INDIC);
  });
});
