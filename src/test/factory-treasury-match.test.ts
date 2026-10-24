import { describe, it, expect } from "vitest";
import { findAmountDateMatches, matchDateRange, formatMatchWarning } from "@/lib/factoryTreasuryMatch";

const c = [
  { id: "1", label: "MPI-202610-0047", amount: 82049.967, date: "2026-10-24" },
  { id: "2", label: "MPI-202610-0046", amount: 1360, date: "2026-10-20" },
  { id: "3", label: "MPI-202610-0040", amount: 15653.475, date: "2026-10-18" },
  { id: "4", label: "MPI-202610-0035", amount: 15652.897, date: "2026-10-17" },
];

describe("findAmountDateMatches", () => {
  it("matches within ±50 EGP and ±3 days", () => {
    expect(findAmountDateMatches(82050, "2026-10-22", c).map((m) => m.id)).toEqual(["1"]);
    expect(findAmountDateMatches(1360, "2026-10-18", c).map((m) => m.id)).toEqual(["2"]);
  });
  it("rejects outside the date window", () => {
    expect(findAmountDateMatches(82050, "2026-10-20", c)).toEqual([]);
  });
  it("rejects outside the amount window", () => {
    expect(findAmountDateMatches(82000 - 1, "2026-10-24", c)).toEqual([]);
    expect(findAmountDateMatches(82099, "2026-10-24", c).map((m) => m.id)).toEqual(["1"]);
  });
  it("returns all ambiguous candidates, closest amount first", () => {
    expect(findAmountDateMatches(15650, "2026-10-17", c).map((m) => m.id)).toEqual(["4", "3"]);
  });
  it("ignores empty input", () => {
    expect(findAmountDateMatches(0, "2026-10-17", c)).toEqual([]);
  });
});

describe("helpers", () => {
  it("date range", () => {
    expect(matchDateRange("2026-10-01")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });
  it("warning text", () => {
    expect(formatMatchWarning("invoice", [c[0]])).toContain("MPI-202610-0047");
  });
});
