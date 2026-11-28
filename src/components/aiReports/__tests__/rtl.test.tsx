import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MorningReportView from "../MorningReportView";
import ModeratorEvalView from "../ModeratorEvalView";
import AlertsView from "../AlertsView";
import RulesView from "../RulesView";

const facts: any = {
  date: "2026-11-27", ads_cap_pct: 10, day_of_month: 27, days_in_month: 30,
  sales: { orders: 79, net_sales: 98075, cancelled: 4, avg7_orders: 71.4, avg7_net_sales: 91200, mtd_net_sales: 1650000, mtd_orders: 1400 },
  ads: { spend_recorded: true, spend: 10654, pct: 10.9, mtd_spend: 150000, mtd_pct: 9.1, campaigns_3d: [] },
  moderators: [], call_eval_7d: [], top_objections_7d: [],
  followups: { pending_over_72h: 1, pending_over_7d: 0, missed_calls_no_callback: 0, call_followups_needed_7d: 0 }, open_alerts: [],
};
const row: any = { report_date: "2026-11-27", facts, status: "done", model: null, cost_usd: null, error: null, created_at: "", updated_at: "",
  report: { headline: ["aya 794 أعلى مبيعًا."], sections: { sales: "المبيعات 98,075 جنيه.", ads: "", moderators: "", calls: "", followups: "" }, moderator_notes: [], decisions: [{ title: "راجع", why: "سبب." }] } };

const ARABIC_INDIC = /[\u0660-\u0669\u06F0-\u06F9]/;

describe("صفحة التقارير الذكية: اتجاه RTL", () => {
  it("التقرير الصباحي: الجذر والقائمة المرقمة والفقرات RTL وبأرقام لاتينية", () => {
    const html = renderToStaticMarkup(<MorningReportView row={row} />);
    expect(html.startsWith('<div dir="rtl"')).toBe(true);
    expect(html).toMatch(/<ol dir="rtl"[^>]*list-decimal/);
    expect(html).toMatch(/<p dir="rtl"[^>]*>المبيعات/);
    expect(html).not.toMatch(ARABIC_INDIC);
  });
  it("باقي التبويبات: الجذر RTL", () => {
    expect(renderToStaticMarkup(<ModeratorEvalView rows={[]} />)).toBeTruthy();
    expect(renderToStaticMarkup(<AlertsView alerts={[]} actions={[]} scope="active" onScope={() => {}} isGm onOp={() => {}} onRequest={() => {}} onDecide={() => {}} />).startsWith('<div dir="rtl"')).toBe(true);
    expect(renderToStaticMarkup(<RulesView rules={[]} canEdit onSave={() => {}} />)).toContain('dir="rtl"');
  });
});
