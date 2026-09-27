import { describe, expect, it } from "vitest";
import { defaultPackWeightKg, resolvePackWeightKg } from "../packWeight";

describe("defaultPackWeightKg", () => {
  it("uses the owner weights", () => {
    expect(defaultPackWeightKg("دبوس بالعظم")).toBe(6);
    expect(defaultPackWeightKg("دهن النعام")).toBe(1);
    expect(defaultPackWeightKg("فيليه")).toBe(0.5);
    expect(defaultPackWeightKg("")).toBe(0.5);
  });

  it("prefers a stored pack weight", () => {
    expect(resolvePackWeightKg({ name: "فيليه", pack_weight_kg: 0.75 })).toBe(0.75);
    expect(resolvePackWeightKg({ name: "دبوس بالعظم", pack_weight_kg: null })).toBe(6);
  });
});
