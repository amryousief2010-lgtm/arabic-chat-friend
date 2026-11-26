import { describe, expect, it } from "vitest";
import { isRealRename, shouldWarnRename } from "@/lib/productRename";

const base = { is_processed: true, linked_by_id: [], name_linked_kept: [], name_linked_lost: [], will_be_unlinked: false };

describe("product rename warning", () => {
  it("ignores spelling-only changes", () => {
    expect(isRealRename("كفتة الرز", "كفته الرز ")).toBe(false);
    expect(isRealRename("هوت دوج", "هوت دوج نعام")).toBe(true);
  });
  it("does not warn when the factory card is linked by product_id", () => {
    expect(shouldWarnRename({ ...base, linked_by_id: ["هوت دوج نعام"] })).toBe(false);
  });
  it("warns when the rename drops the only name-based link", () => {
    expect(shouldWarnRename({ ...base, name_linked_lost: ["برجر نعام"], will_be_unlinked: true })).toBe(true);
  });
  it("does not warn for products that were never linked or are not processed", () => {
    expect(shouldWarnRename({ ...base, will_be_unlinked: true })).toBe(false);
    expect(shouldWarnRename({ ...base, is_processed: false, name_linked_lost: ["x"], will_be_unlinked: true })).toBe(false);
    expect(shouldWarnRename(null)).toBe(false);
  });
});
