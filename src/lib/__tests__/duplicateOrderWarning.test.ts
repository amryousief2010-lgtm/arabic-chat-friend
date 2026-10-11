import { describe, it, expect } from "vitest";
import {
  classifyDuplicateCheck,
  ownRepeatDescription,
  type DuplicateCheckPayload,
} from "../duplicateOrderWarning";

// Real case 01102626616 (حاتم محمد): مريم registered ORD-20261005-011956, then created a
// second customer record with the same phone and ORD-20261008-368847 with no warning.
const maryamOwnRepeat: DuplicateCheckPayload = {
  is_duplicate: false,
  is_double_submit: false,
  is_own_repeat: true,
  attempt_id: "a1",
  own_candidates: [
    {
      matched_order_id: "4d75bbd9-2ffa-4420-9fd6-db2ecf27a069",
      order_number: "ORD-20261005-011956",
      customer_name: "حاتم محمد",
      customer_phone: "01102626616",
      moderator_name: "مريم",
      created_at: "2026-10-05T20:54:50.53367+00:00",
      status: "delivered",
      products_summary: "عرض 4 كيلو × 1",
      matched_on_phone: true,
    },
  ],
};

describe("classifyDuplicateCheck", () => {
  it("Maryam ORD-20261008-368847 vs ORD-20261005-011956 → own_repeat confirm", () => {
    expect(classifyDuplicateCheck(maryamOwnRepeat)).toBe("own_repeat");
  });

  it("after she accepts the confirm, the retry is clear", () => {
    expect(classifyDuplicateCheck(maryamOwnRepeat, { ownRepeatConfirmed: true })).toBe("clear");
    expect(
      classifyDuplicateCheck({ is_duplicate: false, is_double_submit: false, is_own_repeat: false, own_candidates: [] }, { ownRepeatConfirmed: true }),
    ).toBe("clear");
  });

  it("cross-moderator duplicate still needs approval, and confirm does not bypass it", () => {
    const cross: DuplicateCheckPayload = { is_duplicate: true, is_double_submit: false, is_own_repeat: false };
    expect(classifyDuplicateCheck(cross)).toBe("needs_approval");
    expect(classifyDuplicateCheck(cross, { ownRepeatConfirmed: true })).toBe("needs_approval");
  });

  it("double submit wins over everything", () => {
    expect(classifyDuplicateCheck({ ...maryamOwnRepeat, is_double_submit: true })).toBe("double_submit");
  });

  it("legacy response (before migration, no is_own_repeat) → clear, no crash", () => {
    expect(classifyDuplicateCheck({ is_duplicate: false, attempt_id: null })).toBe("clear");
    expect(classifyDuplicateCheck(null)).toBe("clear");
  });

  it("own flag without candidates → clear (nothing to show)", () => {
    expect(classifyDuplicateCheck({ is_own_repeat: true, own_candidates: [] })).toBe("clear");
  });
});

describe("ownRepeatDescription", () => {
  it("single / multiple wording", () => {
    expect(ownRepeatDescription(1)).toContain("سجلتِ أوردر لنفس رقم الموبايل");
    expect(ownRepeatDescription(3)).toContain("3 أوردرات");
  });
});
