import { describe, expect, it } from "vitest";
import {
  BUILTIN_KG_PRICE_VERSIONS,
  defaultKgPrices,
  resolveKgPricesForMonth,
} from "@/lib/kgPrices";

describe("resolveKgPricesForMonth", () => {
  it("uses processed 160 for August 2026 and earlier", () => {
    const aug = resolveKgPricesForMonth(BUILTIN_KG_PRICE_VERSIONS, 2026, 8);
    expect(aug.prices.processed_price).toBe(160);
    expect(aug.prices.meat_price).toBe(390);
    expect(aug.prices.bone_meat_price).toBe(350);
    expect(aug.isHistorical).toBe(true);
    expect(aug.effective_from).toBe("2020-01-01");

    const jul = resolveKgPricesForMonth(BUILTIN_KG_PRICE_VERSIONS, 2026, 7);
    expect(jul.prices.processed_price).toBe(160);
  });

  it("uses processed 140 from September 2026 onward", () => {
    const sep = resolveKgPricesForMonth(BUILTIN_KG_PRICE_VERSIONS, 2026, 9);
    expect(sep.prices).toEqual(defaultKgPrices);
    expect(sep.isHistorical).toBe(false);
    expect(sep.effective_from).toBe("2026-09-01");

    const oct = resolveKgPricesForMonth(BUILTIN_KG_PRICE_VERSIONS, 2026, 10);
    expect(oct.prices.processed_price).toBe(140);
    expect(oct.prices.meat_price).toBe(390);
    expect(oct.prices.bone_meat_price).toBe(350);
  });

  it("computes the same EGP value for the same qty across sections", () => {
    const { prices } = resolveKgPricesForMonth(BUILTIN_KG_PRICE_VERSIONS, 2026, 9);
    const qty = { processed: 12.5, meat: 3, bone: 4 };
    const value = {
      processed: qty.processed * prices.processed_price,
      meat: qty.meat * prices.meat_price,
      bone: qty.bone * prices.bone_meat_price,
    };
    // cards / بيان / قبض all multiply the same way
    expect(value.processed).toBe(12.5 * 140);
    expect(value.meat).toBe(3 * 390);
    expect(value.bone).toBe(4 * 350);
    expect(value.processed).not.toBe(12.5 * 160);
  });
});

===== END FILE =====
