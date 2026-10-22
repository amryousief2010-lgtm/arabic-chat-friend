import { describe, it, expect } from "vitest";
import { isSlaughterhouseSupplier } from "../slaughterSupplier";

describe("isSlaughterhouseSupplier", () => {
  it("detects slaughterhouse variants", () => {
    for (const s of ["المجزر", " المجزر ", "مجزر نعام العاصمة", "ال مجزر", "المَجزر", "Slaughterhouse"]) {
      expect(isSlaughterhouseSupplier(s)).toBe(true);
    }
  });
  it("allows real suppliers", () => {
    for (const s of ["", null, undefined, "مورد التوابل", "شركة الأغلفة", "جزار خارجي"]) {
      expect(isSlaughterhouseSupplier(s as any)).toBe(false);
    }
  });
});
