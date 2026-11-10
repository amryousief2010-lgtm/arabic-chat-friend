import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bestSlugs,
  mapModeratorPeriodReport,
  REPORT_METRICS,
  resolveReportRange,
  viewerMaySeeConversationMetrics,
  type ModeratorPeriodRow,
} from "../moderatorPeriodReport";
import { PERIOD_REPORT_CSS, moderatorPeriodReportHtml } from "../moderatorPeriodReportPdf";

const now = new Date("2026-11-10T12:00:00+02:00");

const row = (patch: Partial<ModeratorPeriodRow>): ModeratorPeriodRow => ({
  slug: "aya",
  name: "آية",
  ordersRegistered: 4,
  ordersCancelled: 1,
  ordersDelivered: 2,
  deliveredValue: 2000,
  averageOrderValue: 500,
  collectionCollected: 1,
  collectionNotCollected: 3,
  collectionOther: 0,
  kgRequested: { meat: 1, bone: 2, processed: 0, gifts: 0.5 },
  kgDelivered: { meat: 1, bone: 0, processed: 0, gifts: 0 },
  conversations: 10,
  onTime: 6,
  cover: 1,
  late: 2,
  unreplied: 1,
  waitingCustomer: 1,
  inboundMessages: 20,
  outboundMessages: 18,
  avgFirstReplyMin: 12,
  medianFirstReplyMin: 8,
  conversionPct: 40,
  calls: { answered: 3, missed: 1, under1Min: 1, from1To5Min: 1, over5Min: 1, matchedOrder: 2, answerRate: 75 },
  ...patch,
});

describe("resolveReportRange", () => {
  it("uses Cairo presets: today, Saturday week, this month, and last month", () => {
    expect(resolveReportRange("today", "", "", now)).toEqual({ from: "2026-11-10", to: "2026-11-10" });
    expect(resolveReportRange("week", "", "", now)).toEqual({ from: "2026-11-07", to: "2026-11-10" });
    expect(resolveReportRange("this_month", "", "", now)).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(resolveReportRange("last_month", "", "", now).from).toBe("2026-10-01");
    expect(resolveReportRange("last_month", "", "", now).to.startsWith("2026-10")).toBe(true);
    expect(resolveReportRange("custom", "2026-11-10", "2026-11-01", now)).toEqual({ from: "2026-11-01", to: "2026-11-10" });
  });
});

describe("conversation visibility", () => {
  const raw = {
    from: "2026-11-01",
    to: "2026-11-10",
    conversations_visible: true,
    moderators: [{
      slug: "aya", name: "آية", orders_registered: 2, orders_cancelled: 3, orders_delivered: 1, delivered_value: 100,
      average_order_value: 50, collection_collected: 1, collection_not_collected: 1, collection_other: 0,
      kg_requested: { meat: 1, bone: 0, processed: 0, gifts: 0 },
      kg_delivered: { meat: 0, bone: 0, processed: 0, gifts: 0 },
      conversations: 4, late: 1, unreplied: 1, calls: { answered: 1, missed: 1, under_1_min: 0, from_1_to_5_min: 1, over_5_min: 0, matched_order: 1, answer_rate: 50 },
    }],
    daily: [{ day: "2026-11-01", slug: "aya", orders: 2, conversations: 4 }],
    late_by_hour: [{ hour: 21, slug: "aya", late: 1 }],
    ads: [{ ad_name: "إعلان تجريبي", slug: "aya", conversations: 3 }],
  };

  it("keeps conversation metrics for the general manager, sales manager, and executive manager", () => {
    expect(viewerMaySeeConversationMetrics(["general_manager"])).toBe(true);
    expect(viewerMaySeeConversationMetrics(["sales_manager"])).toBe(true);
    expect(viewerMaySeeConversationMetrics(["executive_manager"])).toBe(true);
    const report = mapModeratorPeriodReport(raw, true);
    expect(report.conversationsVisible).toBe(true);
    expect(report.moderators[0].late).toBe(1);
    expect(report.ads).toHaveLength(1);
  });

  it("hides conversation metrics from marketing roles even if a payload includes them", () => {
    expect(viewerMaySeeConversationMetrics(["marketing_sales_manager"])).toBe(false);
    const report = mapModeratorPeriodReport({ ...raw, conversations_visible: false }, false);
    expect(report.conversationsVisible).toBe(false);
    expect(report.moderators[0].conversations).toBeNull();
    expect(report.moderators[0].calls).toBeNull();
    expect(report.lateByHour).toEqual([]);
    expect(report.ads).toEqual([]);
    expect(report.moderators[0].ordersRegistered).toBe(2);
    expect(report.moderators[0].ordersCancelled).toBe(3);
    const { orders_cancelled: _dropped, ...withoutCancelled } = raw.moderators[0] as { orders_cancelled?: number };
    void _dropped;
    const legacy = mapModeratorPeriodReport({ ...raw, moderators: [withoutCancelled] }, true);
    expect(legacy.moderators[0].ordersRegistered).toBe(2);
    expect(legacy.moderators[0].ordersCancelled).toBeNull();
  });

  it("refuses a payload that carries a phone field", () => {
    expect(() => mapModeratorPeriodReport({ ...raw, phone_norm: "01000000000" }, true)).toThrow(/private field/);
  });
});

describe("best highlight", () => {
  const late = REPORT_METRICS.find((m) => m.id === "late")!;
  const orders = REPORT_METRICS.find((m) => m.id === "orders")!;
  const rows = [row({ slug: "aya", name: "آية", late: 4, ordersRegistered: 2 }), row({ slug: "noura", name: "نورا", late: 1, ordersRegistered: 9 })];

  it("treats the lowest late count as best and the highest orders as best", () => {
    expect(bestSlugs(rows, late)).toEqual(["noura"]);
    expect(bestSlugs(rows, orders)).toEqual(["noura"]);
  });

  it("marks the lowest cancelled count as best and keeps the net orders figure separate", () => {
    const cancelled = REPORT_METRICS.find((m) => m.id === "cancelled")!;
    const registered = REPORT_METRICS.find((m) => m.id === "orders")!;
    expect(registered.label).toBe("الطلبات المسجّلة (الصافي بدون الملغي)");
    expect(cancelled.label).toBe("الملغي");
    expect(cancelled.lowerIsBetter).toBe(true);
    const sample = [row({ slug: "aya", ordersCancelled: 4, ordersRegistered: 10 }), row({ slug: "noura", ordersCancelled: 1, ordersRegistered: 10 })];
    expect(bestSlugs(sample, cancelled)).toEqual(["noura"]);
    expect(sample[0].ordersRegistered).toBe(10);
  });

  it("does not crown anyone when every value ties", () => {
    expect(bestSlugs([row({ late: 1 }), row({ slug: "noura", late: 1 })], late)).toEqual([]);
  });
});

describe("PDF", () => {
  it("prints the selected period, brand colors, logo, page numbers, and no phone", () => {
    const report = mapModeratorPeriodReport({
      from: "2026-11-01",
      to: "2026-11-10",
      conversations_visible: true,
      moderators: [row({}), row({ slug: "noura", name: "نورا", late: 0, ordersRegistered: 1 })].map((r) => ({
        slug: r.slug, name: r.name, orders_registered: r.ordersRegistered, orders_cancelled: r.ordersCancelled, orders_delivered: r.ordersDelivered,
        delivered_value: r.deliveredValue, average_order_value: r.averageOrderValue,
        collection_collected: r.collectionCollected, collection_not_collected: r.collectionNotCollected,
        collection_other: 0, kg_requested: r.kgRequested, kg_delivered: r.kgDelivered,
        conversations: r.conversations, on_time: r.onTime, cover: r.cover, late: r.late, unreplied: r.unreplied,
        waiting_customer: r.waitingCustomer, inbound_messages: r.inboundMessages, outbound_messages: r.outboundMessages,
        avg_first_reply_min: r.avgFirstReplyMin, median_first_reply_min: r.medianFirstReplyMin,
        conversion_pct: r.conversionPct,
        calls: { answered: 3, missed: 1, under_1_min: 1, from_1_to_5_min: 1, over_5_min: 1, matched_order: 2, answer_rate: 75 },
      })),
      daily: [{ day: "2026-11-01", slug: "aya", orders: 4, conversations: 10 }],
      late_by_hour: [{ hour: 18, slug: "aya", late: 2 }],
      ads: [{ ad_name: "حملة العظم", slug: "aya", conversations: 6 }],
    }, true);
    const html = moderatorPeriodReportHtml(report, new Date("2026-11-10T15:00:00Z"), "/coc-logo.png");
    expect(html).toContain("01/11/2026");
    expect(html).toContain("10/11/2026");
    expect(PERIOD_REPORT_CSS).toContain("#A4288A");
    expect(PERIOD_REPORT_CSS).toContain("#F37346");
    expect(PERIOD_REPORT_CSS).toContain("counter(page)");
    expect(html).toContain("/coc-logo.png");
    expect(html).toContain("الأفضل");
    expect(html).toContain("حملة العظم");
    expect(html).not.toMatch(/01[0125]\d{8}/);
    expect(html).toContain("الطلبات المسجّلة (الصافي بدون الملغي)");
    expect(html).toContain("الملغي");
    expect(html).toContain("لا تُطبع أرقام العملاء");
  });
});

describe("migration contract", () => {
  const sql = readFileSync(resolve("supabase/migrations/20261110203000_cm_moderator_period_report.sql"), "utf8");
  const rollback = readFileSync(resolve("supabase/rollbacks/20261110203000_cm_moderator_period_report_ROLLBACK.sql"), "utf8");

  it("is read-only, gated, limited to the five moderators, and drops cleanly", () => {
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("cm_gate_allows()");
    expect(sql).toContain("'general_manager', 'executive_manager', 'sales_manager'");
    for (const slug of ["aya", "noura", "manal", "mariam", "soha"]) expect(sql).toContain(`'${slug}'`);
    expect(sql).not.toContain("'fatma'");
    expect(sql).toContain("رقب");
    expect(sql).toContain("دبوس بالعظم");
    expect(sql).not.toMatch(/jsonb_build_object\(\s*'phone/);
    expect(sql).not.toContain("phone_raw");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.cm_moderator_period_report(date, date)");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.cm_report_kg_bucket(text, boolean, text)");
  });

  it("adds a cancelled count without folding it into the net registered orders", () => {
    const sql = readFileSync(resolve("supabase/migrations/20261110223000_cm_moderator_period_report_cancelled.sql"), "utf8");
    const undo = readFileSync(resolve("supabase/rollbacks/20261110223000_cm_moderator_period_report_cancelled_ROLLBACK.sql"), "utf8");
    expect(sql).toContain("'orders_cancelled'");
    expect(sql).toContain("NOT public.cm_order_is_cancelled(status)");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("cm_gate_allows()");
    expect(undo).not.toContain("'orders_cancelled'");
    expect(undo).toContain("CREATE OR REPLACE FUNCTION public.cm_moderator_period_report");
  });
});
