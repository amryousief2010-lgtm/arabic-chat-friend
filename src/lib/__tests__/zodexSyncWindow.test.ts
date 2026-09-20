import { describe, it, expect } from "vitest";
import {
  resolveWindow,
  rowInWindow,
  shouldStopPaging,
  dedupeByBill,
  parseZodexDate,
  shouldRunWeeklyFullReview,
  resolveScheduledMode,
  OVERLAP_HOURS,
  mapBalanceCells,
  phonesMatchLoose,
  looksLikeEgyptianMobile,
  amountMatchesZodex,
  collectAwbCandidates,
  indexAwbCandidate,
  isExpectedZodexShipment,
  phoneIndexKeys,
  pickAwbLinkWinner,
  AGOUZA_WAREHOUSE_ID,
} from "../../../supabase/functions/_shared/zodexSync";

const CYCLE = "2026-09-15T22:00:00.000Z";

describe("resolveWindow", () => {
  it("quick sync starts 48h before the last successful sync", () => {
    const w = resolveWindow({ mode: "quick", lastSuccessAt: "2026-09-15T20:00:00.000Z", cycleStart: CYCLE });
    expect(w.mode).toBe("quick");
    expect(w.from).toBe("2026-09-13T20:00:00.000Z");
    expect(w.to).toBe(CYCLE);
    expect(OVERLAP_HOURS).toBe(48);
  });

  it("falls back to a full review on the first run", () => {
    const w = resolveWindow({ mode: "quick", lastSuccessAt: null, cycleStart: CYCLE });
    expect(w.mode).toBe("full");
    expect(w.first_run).toBe(true);
    expect(w.from).toBe("2026-08-16T22:00:00.000Z"); // 30 days
  });

  it("full review honours the user-chosen period", () => {
    const w = resolveWindow({ mode: "full", lastSuccessAt: "2026-09-15T20:00:00.000Z", cycleStart: CYCLE, fullDays: 7 });
    expect(w.from).toBe("2026-09-08T22:00:00.000Z");
  });

  it("window ends at the cycle start so rows created during the sync are not lost", () => {
    const w = resolveWindow({ mode: "quick", lastSuccessAt: "2026-09-15T20:00:00.000Z", cycleStart: CYCLE });
    // A bill created after the cycle start keeps a later date than the committed
    // timestamp, so the next quick sync (from cycleStart - 48h) still sees it.
    const next = resolveWindow({ mode: "quick", lastSuccessAt: w.to, cycleStart: "2026-09-16T22:00:00.000Z" });
    expect(new Date(next.from).getTime()).toBeLessThan(new Date(CYCLE).getTime());
  });
});

describe("rowInWindow", () => {
  const win = resolveWindow({ mode: "quick", lastSuccessAt: "2026-09-15T20:00:00.000Z", cycleStart: CYCLE });

  it("detects a bill created after the last sync", () => {
    expect(rowInWindow({ created_at: "2026-09-15T21:00:00.000Z", updated_at: null }, win)).toBe(true);
  });

  it("detects an old bill whose status changed after the last sync", () => {
    expect(rowInWindow({ created_at: "2026-08-01T10:00:00.000Z", updated_at: "2026-09-15T21:30:00.000Z" }, win)).toBe(true);
  });

  it("skips an untouched old bill", () => {
    expect(rowInWindow({ created_at: "2026-08-01T10:00:00.000Z", updated_at: "2026-08-02T10:00:00.000Z" }, win)).toBe(false);
  });

  it("never silently skips a row with no readable date", () => {
    expect(rowInWindow({ created_at: null, updated_at: null }, win)).toBe(true);
  });
});

describe("shouldStopPaging", () => {
  const win = resolveWindow({ mode: "quick", lastSuccessAt: "2026-09-15T20:00:00.000Z", cycleStart: CYCLE });
  const inWin = { created_at: "2026-09-15T12:00:00.000Z", updated_at: null };
  const oldRow = { created_at: "2026-01-01T12:00:00.000Z", updated_at: "2026-01-01T12:00:00.000Z" };

  it("keeps paging while rows are inside the window (page 2+ rows are reached)", () => {
    expect(shouldStopPaging([inWin, oldRow], win, 2).stop).toBe(false);
  });

  it("stops only after two consecutive fully-old pages", () => {
    const a = shouldStopPaging([oldRow], win, 2);
    expect(a.stop).toBe(false);
    const b = shouldStopPaging([oldRow], win, a.gracePagesLeft);
    expect(b.stop).toBe(true);
  });

  it("stops on an empty page", () => {
    expect(shouldStopPaging([], win, 2).stop).toBe(true);
  });
});

describe("dedupeByBill (idempotency across the 48h overlap)", () => {
  it("keeps one row per waybill and prefers the freshest", () => {
    const out = dedupeByBill([
      { bill_no: "ZX1", created_at: "2026-09-10T10:00:00.000Z", updated_at: "2026-09-10T10:00:00.000Z" },
      { bill_no: "zx1", created_at: "2026-09-10T10:00:00.000Z", updated_at: "2026-09-14T10:00:00.000Z" },
      { bill_no: "ZX2", created_at: "2026-09-11T10:00:00.000Z", updated_at: null },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].updated_at).toBe("2026-09-14T10:00:00.000Z");
  });
});

describe("parseZodexDate", () => {
  it("parses Cairo date/time with AM/PM", () => {
    expect(parseZodexDate("2026-07-04 04:42 PM")).toBe("2026-07-04T16:42:00+02:00");
    expect(parseZodexDate("2026-07-04 12:05 AM")).toBe("2026-07-04T00:05:00+02:00");
    expect(parseZodexDate("2026-07-04")).toBe("2026-07-04T00:00:00+02:00");
    expect(parseZodexDate("ZX12345")).toBeNull();
  });
});

describe("weekly full review", () => {
  it("runs when none happened yet or a week has passed", () => {
    expect(shouldRunWeeklyFullReview(null, CYCLE)).toBe(true);
    expect(shouldRunWeeklyFullReview("2026-09-01T22:00:00.000Z", CYCLE)).toBe(true);
    expect(shouldRunWeeklyFullReview("2026-09-14T22:00:00.000Z", CYCLE)).toBe(false);
  });

  it("scheduled quick never upgrades to a 30-day scrape (even with no weekly full yet)", () => {
    expect(resolveScheduledMode({
      requestedMode: "quick",
      triggerSource: "schedule",
      lastFullReviewAt: null,
      now: CYCLE,
    })).toBe("quick");
    expect(resolveScheduledMode({
      requestedMode: "quick",
      triggerSource: "schedule",
      lastFullReviewAt: "2026-09-01T22:00:00.000Z",
      now: CYCLE,
    })).toBe("quick");
    expect(resolveScheduledMode({
      requestedMode: "quick",
      triggerSource: "manual",
      lastFullReviewAt: null,
      now: CYCLE,
    })).toBe("quick");
    expect(resolveScheduledMode({
      requestedMode: "full",
      triggerSource: "schedule",
      lastFullReviewAt: "2026-09-14T22:00:00.000Z",
      now: CYCLE,
    })).toBe("full");
    expect(resolveScheduledMode({
      requestedMode: "full",
      triggerSource: "manual",
      lastFullReviewAt: "2026-09-14T22:00:00.000Z",
      now: CYCLE,
    })).toBe("full");
  });
});

describe("AWB auto-link: phone2 / last-9 / delivery-only", () => {
  it("indexes 01 and +20 as the same last-9 key", () => {
    expect(phoneIndexKeys("01012345678")).toContain("1012345678".slice(-9));
    expect(phoneIndexKeys("+201012345678")).toEqual(
      expect.arrayContaining(phoneIndexKeys("01012345678")),
    );
  });

  it("matches a Zodex 01 phone to an order whose number lives on phone2 as 20…", () => {
    const map = new Map<string, { id: string; total: number; created_at: string }[]>();
    indexAwbCandidate(
      map,
      { id: "o1", total: 500, created_at: "2026-09-20T08:00:00.000Z" },
      "01500000000",
      "201012345678",
    );
    const hits = collectAwbCandidates(["01012345678"], map, new Set());
    expect(hits.map((h) => h.id)).toEqual(["o1"]);
  });

  it("prefers locked +110 COD over a same-phone older order with a different total", () => {
    const picked = pickAwbLinkWinner([
      { id: "old", total: 200, created_at: "2026-09-19T08:00:00.000Z" },
      { id: "new", total: 500, created_at: "2026-09-20T08:00:00.000Z" },
    ], 610);
    expect(picked?.winner.id).toBe("new");
    expect(picked?.reason).toBe("phone_and_cod");
  });

  it("still FIFO-links the oldest same-phone order when COD is off", () => {
    const picked = pickAwbLinkWinner([
      { id: "old", total: 200, created_at: "2026-09-19T08:00:00.000Z" },
      { id: "new", total: 500, created_at: "2026-09-20T08:00:00.000Z" },
    ], 900);
    expect(picked?.winner.id).toBe("old");
    expect(picked?.reason).toBe("phone_only_fifo");
  });

  it("does not treat pickup as a Zodex shipment for auto-link", () => {
    expect(isExpectedZodexShipment({
      status: "pending",
      source_warehouse_id: AGOUZA_WAREHOUSE_ID,
      fulfillment_type: "pickup",
    })).toBe(false);
  });
});

describe("HTML scrape mapping (balance page)", () => {
  it("uses positional phone/date when they are valid", () => {
    const cells = [
      "1", "2", "3", "إلي", "تكلفة التوصيل", "ZX999", "نورا 01011111111", "تسليم ناجح",
      "01012345678", "40", "الجيزة", "500", "x", "y", "2026-09-10 04:42 PM",
    ];
    const m = mapBalanceCells(cells, 5);
    expect(m.bill_no).toBe("ZX999");
    expect(m.customer_phone).toBe("01012345678");
    expect(m.phone_source).toBe("positional");
    expect(m.date_source).toBe("positional");
    expect(m.shipment_date).toBe("2026-09-10T16:42:00+02:00");
    expect(m.cod_amount).toBe(500);
  });

  it("does not invent now() when the date column is garbage; rescans a real date cell", () => {
    const cells = [
      "1", "2", "3", "إلي", "تكلفة التوصيل", "ZX999", "نورا", "تسليم ناجح",
      "01012345678", "40", "الجيزة", "500", "x", "y", "not-a-date",
      "2026-08-01 01:00 PM",
    ];
    const m = mapBalanceCells(cells, 5);
    expect(m.date_source).toBe("scanned");
    expect(m.shipment_date).toBe("2026-08-01T13:00:00+02:00");
    expect(m.scrape_warnings).toContain("date_rescanned");
  });

  it("clears the phone instead of using a shifted status/COD column", () => {
    const cells = [
      "1", "2", "3", "إلي", "تكلفة التوصيل", "ZX999", "نورا علي", "تسليم ناجح",
      "الجيزة", "40", "الجيزة", "500", "x", "y", "2026-09-10 04:42 PM",
    ];
    const m = mapBalanceCells(cells, 5);
    expect(m.phone_source).toBe("none");
    expect(m.customer_phone).toBe("");
  });
});

describe("deterministic match keys (sync)", () => {
  it("accepts last-9 phones and locked +110, rejects a 80 EGP gap", () => {
    expect(phonesMatchLoose("01012345678", "201012345678")).toBe(true);
    expect(looksLikeEgyptianMobile("تسليم ناجح")).toBe(false);
    expect(amountMatchesZodex(400, 510).ok).toBe(true);
    expect(amountMatchesZodex(400, 480).ok).toBe(false);
  });
});
