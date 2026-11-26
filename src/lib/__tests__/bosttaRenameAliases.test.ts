import { describe, expect, it } from "vitest";
import { buildProductLookup, parseProductText, type CatalogProduct } from "@/lib/bosttaDeliveryParser";

const HOT_DOG = "aa6d5b96-cd4f-43c0-b74b-db9c97403d70";
const BURGER = "69de7370-7ec6-4f68-acc6-88f7a520d4c0";

const base: CatalogProduct[] = [
  { id: HOT_DOG, name: "هوت دوج", unit: "كجم", price: 350, barcode: "6224003208315" },
  { id: BURGER, name: "برجر", unit: "كجم", price: 500, barcode: null },
  { id: "kofta", name: "كفتة", unit: "كجم", price: 480, barcode: null },
];

const renamed: CatalogProduct[] = base.map((p) =>
  p.id === HOT_DOG ? { ...p, name: "هوت دوج نعام" } : p.id === BURGER ? { ...p, name: "برجر نعام" } : p,
);

describe("Bostta parser after a product rename", () => {
  it("matches «هوت دوج» before the rename", () => {
    const r = parseProductText("ك هوت دوج", buildProductLookup(base));
    expect(r.items.map((i) => i.product_id)).toEqual([HOT_DOG]);
  });

  it("matches the old name «هوت دوج» after the rename through the audit-log alias", () => {
    const lookup = buildProductLookup(renamed, [{ product_id: HOT_DOG, old_name: "هوت دوج" }]);
    const r = parseProductText("2ك هوت دوج", lookup);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ product_id: HOT_DOG, product_name: "هوت دوج نعام", quantity: 2 });
    expect(r.unknown_tokens).toEqual([]);
  });

  it("built-in alias targets still resolve after the catalog name changes («برجر» → «برجر نعام»)", () => {
    const without = parseProductText("ك برجر", buildProductLookup(renamed));
    expect(without.items).toHaveLength(0);
    const withAlias = parseProductText("ك برجر", buildProductLookup(renamed, [{ product_id: BURGER, old_name: "برجر" }]));
    expect(withAlias.items.map((i) => i.product_id)).toEqual([BURGER]);
  });

  it("matches a sheet barcode token", () => {
    const r = parseProductText("ك 6224003208315", buildProductLookup(renamed));
    expect(r.items.map((i) => i.product_id)).toEqual([HOT_DOG]);
  });

  it("an old name never takes over another product's current name", () => {
    const lookup = buildProductLookup(renamed, [{ product_id: HOT_DOG, old_name: "كفتة" }]);
    expect(lookup.get("كفته")?.id).toBe("kofta");
  });

  it("an old name claimed by two products is ignored", () => {
    const lookup = buildProductLookup(renamed, [
      { product_id: HOT_DOG, old_name: "منتج قديم" },
      { product_id: BURGER, old_name: "منتج قديم" },
    ]);
    expect(lookup.has("منتج قديم")).toBe(false);
  });
});
