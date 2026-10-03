import { describe, expect, it } from "vitest";
import {
  offerPreviewMatchesSeed,
  quantityForAnotherCopy,
  summarizeOfferCartLines,
  type OfferPreviewItem,
} from "./NewOrder";

const item = (patch: Partial<OfferPreviewItem> = {}): OfferPreviewItem => ({
  id: "line-1",
  product_id: "minced",
  product: null,
  custom_price: 310,
  quantity: 2,
  seedProductId: "minced",
  seedQuantity: 2,
  seedPrice: 310,
  seedIsGift: false,
  ...patch,
});

describe("offerPreviewMatchesSeed", () => {
  it("matches the cart lines the dialog was opened with", () => {
    expect(offerPreviewMatchesSeed([item(), item({ id: "line-2", product_id: "sausage", seedProductId: "sausage" })], 2)).toBe(true);
  });

  it("is a change when a quantity, product, or line count differs", () => {
    expect(offerPreviewMatchesSeed([item({ quantity: 3 })], 1)).toBe(false);
    expect(offerPreviewMatchesSeed([item({ product_id: "burger" })], 1)).toBe(false);
    expect(offerPreviewMatchesSeed([item()], 2)).toBe(false);
    expect(offerPreviewMatchesSeed([item({ quantity: 0 })], 1)).toBe(false);
  });

  it("is not a cart reopen when there is no seed", () => {
    expect(offerPreviewMatchesSeed([item()], undefined)).toBe(false);
  });
});

describe("summarizeOfferCartLines", () => {
  const line = (patch: {
    offerBoxId?: string;
    quantity: number;
    name: string;
    isOfferItem?: boolean;
  }) => ({
    isOfferItem: patch.isOfferItem ?? true,
    offerBoxId: patch.offerBoxId ?? "box-1",
    quantity: patch.quantity,
    product: { name: patch.name },
  });

  it("builds the box summary from the current lines and drops zeros", () => {
    const summary = summarizeOfferCartLines([
      line({ quantity: 2, name: "مفروم" }),
      line({ quantity: 0, name: "كفتة" }),
      line({ quantity: 2, name: "سجق" }),
      line({ quantity: 1, name: "برجر", isOfferItem: false, offerBoxId: undefined }),
    ]);

    const n = (qty: number) => qty.toLocaleString();
    expect(summary["box-1"]).toEqual([`${n(2)} × مفروم`, `${n(2)} × سجق`]);
    expect(summary["box-1"]).toHaveLength(2);
  });

  it("keeps one cart row as one line after a product swap", () => {
    const summary = summarizeOfferCartLines([
      line({ quantity: 2, name: "مفروم" }),
      line({ quantity: 2, name: "برجر" }),
    ]);
    const n = (qty: number) => qty.toLocaleString();
    expect(summary["box-1"]).toEqual([`${n(2)} × مفروم`, `${n(2)} × برجر`]);
  });

  it("does not split a repeated product that is already one cart row", () => {
    const summary = summarizeOfferCartLines([
      line({ quantity: 4, name: "مفروم" }),
    ]);
    expect(summary["box-1"]).toEqual([`${(4).toLocaleString()} × مفروم`]);
  });
});

describe("quantityForAnotherCopy", () => {
  it("copies the quantity on screen when she has one box", () => {
    expect(quantityForAnotherCopy(2, 1)).toBe(2);
  });

  it("adds one box worth of a merged cart instead of stacking the total", () => {
    expect(quantityForAnotherCopy(4, 2)).toBe(2);
  });
});
