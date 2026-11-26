import { describe, expect, it } from "vitest";
import { classifyProductDestination } from "@/constants/productRouting";

describe("classifyProductDestination", () => {
  it("does not send processed products to the slaughterhouse just because the name has «نعام»", () => {
    for (const name of ["هوت دوج نعام", "برجر نعام", "سجق نعام", "لانشون نعام", "كفتة نعام", "مفروم نعام", "كفته رز نعام", "لحم نعام مدخن"]) {
      expect(classifyProductDestination(name), name).toBe("meat_factory");
    }
  });

  it("keeps the real slaughterhouse items (carcass, bone-in and raw outputs) on the slaughterhouse", () => {
    for (const name of [
      "نعامة صندوق بالعظم", "فخدة  بالعظم", "دبوس بالعظم", "نص نعامة", "نعامة كاملة", "ذبيحة نعام",
      "لحم نعام طازج", "دهن النعام", "فرم نعام", "شغت نعام", "ريش نعام",
    ]) {
      expect(classifyProductDestination(name), name).toBe("slaughterhouse");
    }
  });

  it("keeps fresh cuts and processed items on the meat factory", () => {
    for (const name of ["استيك", "موزة", "فراشة", "قطعية الدبوس", "قطع كباب", "برجر", "هوت دوج", "شاورما", "حواوشي"]) {
      expect(classifyProductDestination(name), name).toBe("meat_factory");
    }
  });

  it("uses the category «لحوم مصنعة» when the name has no keyword", () => {
    expect(classifyProductDestination("منتج جديد", "لحوم مصنعة")).toBe("meat_factory");
    expect(classifyProductDestination("هوت دوج نعام", "لحوم مصنعة")).toBe("meat_factory");
  });

  it("a rename to «… نعام» does not change the destination", () => {
    expect(classifyProductDestination("هوت دوج نعام")).toBe(classifyProductDestination("هوت دوج"));
    expect(classifyProductDestination("برجر نعام")).toBe(classifyProductDestination("برجر"));
  });

  it("eggs are not routed", () => {
    expect(classifyProductDestination("بيض ")).toBe("none");
  });
});
