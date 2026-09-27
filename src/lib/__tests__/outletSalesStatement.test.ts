import { describe, expect, it } from "vitest";
import { lineQuantityKg, matchOutletLines, parseOutletStatementRows } from "../outletSalesStatement";

describe("outlet sales statement file", () => {
  it("reads Arabic headers and keeps packs unconverted until match", () => {
    const parsed = parseOutletStatementRows([
      { الصنف: "فيليه", الكمية: "2", الوحدة: "عبوة", المبلغ: "40" },
      { الصنف: "دبوس بالعظم", الكمية: 1, الوحدة: "كجم" },
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines[0]).toMatchObject({ key: "فيليه", qty: 2, unit: "pack", amount: 40 });
    expect(parsed.lines[1]).toMatchObject({ key: "دبوس بالعظم", qty: 1, unit: "kg", amount: null });
  });

  it("rejects a missing unit and a non-positive quantity", () => {
    const parsed = parseOutletStatementRows([
      { barcode: "ABC", qty: 0, unit: "kg" },
      { barcode: "ABC", qty: 1, unit: "صندوق" },
    ]);
    expect(parsed.lines).toHaveLength(0);
    expect(parsed.errors.join(" ")).toContain("أكبر من صفر");
    expect(parsed.errors.join(" ")).toContain("عبوة أو كجم");
  });

  it("converts packs with the card weight and names a missing item", () => {
    const parsed = parseOutletStatementRows([
      { barcode: "F1", qty: 2, unit: "pack" },
      { barcode: "MISSING", qty: 1, unit: "kg" },
    ]);
    const matched = matchOutletLines(parsed.lines, [
      { id: "item-1", name: "فيليه", barcode: "F1", pack_weight_kg: 0.75 },
    ]);
    expect(matched.ok).toEqual([
      expect.objectContaining({ item_id: "item-1", quantity_kg: 1.5, pack_weight_kg: 0.75, unit: "pack" }),
    ]);
    expect(matched.errors[0]).toContain("MISSING");
    expect(lineQuantityKg(2, "pack", { name: "دبوس بالعظم", pack_weight_kg: null }).kg).toBe(12);
  });
});
