import { describe, it, expect } from "vitest";
import { formatDateTime12, formatClock12 } from "./timeFormat";
describe("timeFormat", () => {
  it("clock", () => {
    expect(formatClock12("21:07:00")).toBe("9:07 م");
    expect(formatClock12("00:30")).toBe("12:30 ص");
    expect(formatClock12("12:00")).toBe("12:00 م");
  });
  it("datetime cairo", () => {
    expect(formatDateTime12("2026-10-28T18:07:00Z")).toBe("28/10/2026 9:07 م"); // EEST? Cairo UTC+3 Oct 28 (DST ends last Fri Oct 30)
    expect(formatDateTime12(null)).toBe("—");
  });
});
