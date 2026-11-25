import { describe, expect, it } from "vitest";
import {
  canKeepSale,
  canonicalPreviewField,
  customerPaySummary,
  previewTableRows,
  effectiveCustomerPrice,
  keepSaleDisabledReason,
  keepSaleLabel,
  parseMoney,
  previewFieldLabel,
  priceContextFromChanges,
  saleIsActive,
  saleRemovalWarning,
  saleWouldBeCleared,
  SKU_ROW_HINT,
  type PreviewPriceContext,
} from "@/lib/wooPreview";

const burgerDefault: PreviewPriceContext = {
  beforeRegular: "390",
  beforeSale: "320",
  afterRegular: "300",
  afterSale: "",
  sellingPrice: 300,
};

const burgerKeep: PreviewPriceContext = {
  beforeRegular: "390",
  beforeSale: "320",
  afterRegular: "390",
  afterSale: "300",
  sellingPrice: 300,
};

const noSale: PreviewPriceContext = {
  beforeRegular: "580",
  beforeSale: "",
  afterRegular: "560",
  afterSale: "",
  sellingPrice: 560,
};

describe("effective customer price", () => {
  it("uses the sale when it is below the regular price", () => {
    expect(effectiveCustomerPrice("390", "320")).toBe(320);
    expect(saleIsActive("390", "320")).toBe(true);
  });
  it("ignores an empty, zero, or invalid sale, and a sale not below regular", () => {
    expect(effectiveCustomerPrice("390", "")).toBe(390);
    expect(effectiveCustomerPrice("390", null)).toBe(390);
    expect(effectiveCustomerPrice(580, "0")).toBe(580);
    expect(saleIsActive("300", "300")).toBe(false);
    expect(effectiveCustomerPrice("300", "300")).toBe(300);
    expect(parseMoney("1,250")).toBe(1250);
  });
});

describe("preview copy (standard Arabic, Latin numerals)", () => {
  it("states what the customer pays now versus after in the burger case", () => {
    expect(customerPaySummary(burgerDefault)).toBe("العميل يدفع الآن 320 ج.م ← بعد التأكيد سيدفع 300 ج.م.");
  });
  it("states that the amount stays the same when the effective price does not change", () => {
    expect(customerPaySummary({ ...noSale, afterRegular: "580" })).toBe("العميل يدفع الآن 580 ج.م، وسيبقى كذلك بعد التأكيد.");
  });
  it("states the new amount when there is no current sale", () => {
    expect(customerPaySummary(noSale)).toBe("العميل يدفع الآن 580 ج.م ← بعد التأكيد سيدفع 560 ج.م.");
  });
  it("warns when an active sale would be removed, with the crossed-out regular price", () => {
    expect(saleWouldBeCleared(burgerDefault)).toBe(true);
    expect(saleRemovalWarning(burgerDefault)).toBe(
      "سيتم إلغاء التخفيض الحالي (390 ج.م بدلاً من 320 ج.م)، ولن يظهر السعر الأساسي مشطوباً.",
    );
    expect(saleWouldBeCleared(noSale)).toBe(false);
    expect(saleRemovalWarning(noSale)).toBeNull();
    expect(saleWouldBeCleared(burgerKeep)).toBe(false);
  });
  it("allows keeping the sale only when the system price is below the current regular price", () => {
    expect(canKeepSale(burgerDefault)).toBe(true);
    expect(keepSaleLabel(burgerDefault)).toContain("390 ج.م");
    expect(keepSaleLabel(burgerDefault)).toContain("300 ج.م");
    expect(canKeepSale(noSale)).toBe(false);
    expect(canKeepSale({ ...burgerDefault, sellingPrice: 390, afterRegular: "400" })).toBe(false);
    expect(keepSaleDisabledReason({ ...burgerDefault, sellingPrice: 400, afterRegular: "400" })).toContain("أقل من السعر الأساسي");
  });
  it("renames price rows and explains the SKU row", () => {
    expect(previewFieldLabel("regular_price")).toBe("السعر الأساسي");
    expect(previewFieldLabel("sale_price")).toBe("سعر التخفيض");
    expect(previewFieldLabel("price")).toBe("السعر النهائي للعميل");
    expect(canonicalPreviewField("السعر الأساسي · على الموقع")).toBe("regular_price");
    expect(SKU_ROW_HINT).toBe("سيُكتب باركود COCEG على المنتج في الموقع.");
  });
  it("rebuilds a price context from diff rows", () => {
    const ctx = priceContextFromChanges([
      { field: "regular_price", before: "390", after: "300" },
      { field: "sale_price", before: "320", after: "" },
      { field: "sku", before: "", after: "6224003208124" },
    ], { sellingPrice: 300 });
    expect(customerPaySummary(ctx)).toBe(customerPaySummary(burgerDefault));
    expect(saleWouldBeCleared(ctx)).toBe(true);
  });
});

describe("preview table rows", () => {
  it("shows base, sale, final, and SKU with a hint in the burger case", () => {
    const rows = previewTableRows([
      { field: "regular_price", before: "390", after: "300" },
      { field: "sale_price", before: "320", after: "" },
      { field: "sku", before: "", after: "6224003208124" },
    ], burgerDefault);
    expect(rows.map((r) => r.label)).toEqual(["السعر الأساسي", "سعر التخفيض", "السعر النهائي للعميل", "رمز الصنف (الباركود)"]);
    expect(rows[0].before).toBe("390 ج.م");
    expect(rows[0].after).toBe("300 ج.م");
    expect(rows[1].after).toBe("(فارغ)");
    expect(rows[2].before).toBe("320 ج.م");
    expect(rows[2].after).toBe("300 ج.م");
    expect(rows[3].after).toBe("6224003208124");
    expect(rows[3].hint).toBe(SKU_ROW_HINT);
  });
  it("omits the sale row when there is no sale before or after", () => {
    const rows = previewTableRows([
      { field: "regular_price", before: "580", after: "560" },
    ], noSale);
    expect(rows.map((r) => r.label)).toEqual(["السعر الأساسي", "السعر النهائي للعميل"]);
    expect(rows[1].before).toBe("580 ج.م");
    expect(rows[1].after).toBe("560 ج.م");
  });
});
