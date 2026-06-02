import { describe, it, expect } from "vitest";
import {
  getOfferPriceGroup,
  getOfferUnitPriceForReplacement,
} from "@/lib/offerPriceGroups";

const makeOffer = (name: string, price: number, productId = name) => ({
  product_id: productId,
  product_name: name,
  offer_name: "عرض الأسرة",
  unit_price: price,
});

describe("getOfferPriceGroup", () => {
  it("classifies group members", () => {
    expect(getOfferPriceGroup("كفتة")).toBe("G1");
    expect(getOfferPriceGroup("برجر")).toBe("G1");
    expect(getOfferPriceGroup("سجق")).toBe("G1");
    expect(getOfferPriceGroup("مفروم")).toBe("G1");
    expect(getOfferPriceGroup("لحم قطع")).toBe("G2");
    expect(getOfferPriceGroup("رول")).toBe("G2");
    expect(getOfferPriceGroup("موزة")).toBe("G3");
    expect(getOfferPriceGroup("استيك")).toBe("G3");
    expect(getOfferPriceGroup("دبوس")).toBe("G4");
    expect(getOfferPriceGroup("فراشة")).toBe("G4");
    expect(getOfferPriceGroup("تربيانكو")).toBe("G5");
    expect(getOfferPriceGroup("اسكالوب")).toBe("G5");
  });
  it("returns null for unrelated products", () => {
    expect(getOfferPriceGroup("بطاطس")).toBeNull();
    expect(getOfferPriceGroup("")).toBeNull();
  });
});

describe("getOfferUnitPriceForReplacement", () => {
  it("non-offer item uses catalog price", () => {
    const old = { product_id: "x", product_name: "بطاطس", unit_price: 50 };
    const u = getOfferUnitPriceForReplacement(
      old,
      { id: "y", name: "موزة", price: 290 },
      []
    );
    expect(u).toBe(290);
  });

  it("G1: كفتة 290 → سجق keeps 290", () => {
    const old = makeOffer("كفتة", 290);
    const u = getOfferUnitPriceForReplacement(
      old,
      { id: "s", name: "سجق", price: 999 },
      []
    );
    expect(u).toBe(290);
  });

  it("G1: كفتة 290 → برجر keeps 290", () => {
    const old = makeOffer("كفتة", 290);
    expect(
      getOfferUnitPriceForReplacement(old, { id: "b", name: "برجر", price: 777 }, [])
    ).toBe(290);
  });

  it("G1: كفتة 290 → مفروم keeps 290", () => {
    const old = makeOffer("كفتة", 290);
    expect(
      getOfferUnitPriceForReplacement(old, { id: "m", name: "مفروم", price: 700 }, [])
    ).toBe(290);
  });

  it("G2: لحم قطع → رول keeps the same offer price", () => {
    const old = makeOffer("لحم قطع", 500);
    expect(
      getOfferUnitPriceForReplacement(old, { id: "r", name: "رول", price: 999 }, [])
    ).toBe(500);
  });

  it("G3: موزة → استيك keeps the same offer price", () => {
    const old = makeOffer("موزة", 290);
    expect(
      getOfferUnitPriceForReplacement(old, { id: "e", name: "استيك", price: 999 }, [])
    ).toBe(290);
  });

  it("G4: دبوس → فراشة keeps the same offer price", () => {
    const old = makeOffer("دبوس", 350);
    expect(
      getOfferUnitPriceForReplacement(old, { id: "f", name: "فراشة", price: 999 }, [])
    ).toBe(350);
  });

  it("G5: تربيانكو → اسكالوب keeps the same offer price", () => {
    const old = makeOffer("تربيانكو", 420);
    expect(
      getOfferUnitPriceForReplacement(old, { id: "a", name: "اسكالوب", price: 999 }, [])
    ).toBe(420);
  });

  it("cross-group: G1 كفتة → G2 لحم قطع uses sibling G2 offer price when present", () => {
    const old = makeOffer("كفتة", 290);
    const siblings = [makeOffer("رول", 500)]; // sibling G2 offer line
    const u = getOfferUnitPriceForReplacement(
      old,
      { id: "lq", name: "لحم قطع", price: 999 },
      siblings
    );
    expect(u).toBe(500);
  });

  it("cross-group with no sibling falls back to catalog price", () => {
    const old = makeOffer("كفتة", 290);
    const u = getOfferUnitPriceForReplacement(
      old,
      { id: "lq", name: "لحم قطع", price: 480 },
      []
    );
    expect(u).toBe(480);
  });
});
