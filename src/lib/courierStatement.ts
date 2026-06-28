import * as XLSX from "xlsx";
import { openPrintWindow } from "@/lib/printPdf";
import { supabase } from "@/integrations/supabase/client";

export type StatementLine = {
  id: string;
  performed_at: string;
  line_type: string;
  product_name: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_value: number | null;
  cash_collected: number | null;
  notes: string | null;
};

const LINE_TYPE_AR: Record<string, string> = {
  issue: "تسليم بضاعة",
  return: "مرتجع",
  sale: "بيع/تسليم",
  cash_collect: "تحصيل نقدي",
  bonus: "مجاني/هدية",
  handover: "توريد نقدية",
};

const fmt = (n: number) => new Intl.NumberFormat("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (s: string) => new Date(s).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });

export async function fetchCourierStatementLines(custodyId: string, fromISO?: string, toISO?: string): Promise<StatementLine[]> {
  let q = (supabase as any).from("courier_goods_custody_lines").select("*").eq("custody_id", custodyId).order("performed_at", { ascending: true });
  if (fromISO) q = q.gte("performed_at", fromISO);
  if (toISO) q = q.lte("performed_at", toISO);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as StatementLine[];
}

export function summarizeStatement(lines: StatementLine[]) {
  let issuedValue = 0, returnedValue = 0, soldValue = 0, cashCollected = 0, handedOver = 0, bonusValue = 0;
  for (const l of lines) {
    const v = Number(l.total_value || 0);
    const c = Number(l.cash_collected || 0);
    switch (l.line_type) {
      case "issue": issuedValue += v; break;
      case "return": returnedValue += v; break;
      case "sale": soldValue += v; cashCollected += c; break;
      case "cash_collect": cashCollected += c; break;
      case "bonus": bonusValue += v; break;
      case "handover": handedOver += Math.abs(c); break;
    }
  }
  const netCash = cashCollected - handedOver;
  const outstandingGoods = issuedValue - returnedValue - soldValue - bonusValue;
  return { issuedValue, returnedValue, soldValue, cashCollected, handedOver, bonusValue, netCash, outstandingGoods };
}

export function printCourierStatement(courierName: string, custodyId: string, lines: StatementLine[], range?: { from?: string; to?: string }) {
  const s = summarizeStatement(lines);
  const rangeTxt = range && (range.from || range.to)
    ? `الفترة: ${range.from ? new Date(range.from).toLocaleDateString("ar-EG") : "—"} → ${range.to ? new Date(range.to).toLocaleDateString("ar-EG") : "—"}`
    : "كل الحركات";

  const rows = lines.map((l) => `
    <tr>
      <td>${fmtDate(l.performed_at)}</td>
      <td>${LINE_TYPE_AR[l.line_type] || l.line_type}</td>
      <td>${l.product_name || "—"}</td>
      <td class="num">${l.quantity ?? "—"} ${l.unit || ""}</td>
      <td class="num">${fmt(Number(l.unit_price || 0))}</td>
      <td class="num">${fmt(Number(l.total_value || 0))}</td>
      <td class="num">${fmt(Number(l.cash_collected || 0))}</td>
      <td class="note">${(l.notes || "").replace(/</g, "&lt;")}</td>
    </tr>`).join("");

  const body = `
    <div class="head">
      <h1>كشف حساب المندوب</h1>
      <div class="meta">
        <div><b>المندوب:</b> ${courierName}</div>
        <div><b>رقم العهدة:</b> ${custodyId.slice(0, 8)}</div>
        <div><b>${rangeTxt}</b></div>
        <div><b>تاريخ الطباعة:</b> ${new Date().toLocaleString("ar-EG")}</div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><span>إجمالي البضاعة المُسلّمة</span><b>${fmt(s.issuedValue)} ج.م</b></div>
      <div class="kpi"><span>المرتجعات</span><b>${fmt(s.returnedValue)} ج.م</b></div>
      <div class="kpi"><span>المُباع/المُسلّم</span><b>${fmt(s.soldValue)} ج.م</b></div>
      <div class="kpi"><span>المجانيات</span><b>${fmt(s.bonusValue)} ج.م</b></div>
      <div class="kpi"><span>النقدية المُحصَّلة</span><b>${fmt(s.cashCollected)} ج.م</b></div>
      <div class="kpi"><span>المُورَّد للخزينة</span><b>${fmt(s.handedOver)} ج.م</b></div>
      <div class="kpi total"><span>صافي النقدية لدى المندوب</span><b>${fmt(s.netCash)} ج.م</b></div>
      <div class="kpi total"><span>قيمة البضاعة المتبقية</span><b>${fmt(s.outstandingGoods)} ج.م</b></div>
    </div>

    <table class="grid">
      <thead>
        <tr>
          <th>التاريخ</th><th>نوع الحركة</th><th>الصنف/البيان</th>
          <th>الكمية</th><th>السعر</th><th>الإجمالي</th><th>النقدية</th><th>ملاحظة</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="8" style="text-align:center">لا توجد حركات</td></tr>`}</tbody>
    </table>

    <div class="footer">
      <div>توقيع المندوب: ____________________</div>
      <div>توقيع المسؤول المالي: ____________________</div>
    </div>
  `;

  const css = `
    body { font-family: 'Cairo','Segoe UI',sans-serif; direction: rtl; padding: 16px; color:#111; }
    h1 { margin:0 0 8px; font-size: 20px; text-align:center; }
    .head { border-bottom: 2px solid #444; padding-bottom: 8px; margin-bottom: 12px; }
    .meta { display:grid; grid-template-columns: repeat(2,1fr); gap:4px 16px; font-size: 12px; }
    .kpis { display:grid; grid-template-columns: repeat(4,1fr); gap:8px; margin: 12px 0; }
    .kpi { border:1px solid #ddd; border-radius:6px; padding:8px; background:#fafafa; }
    .kpi span { display:block; font-size:11px; color:#555; }
    .kpi b { font-size:13px; }
    .kpi.total { background:#fff7e6; border-color:#f0b34a; }
    table.grid { width:100%; border-collapse: collapse; font-size: 11px; }
    table.grid th, table.grid td { border:1px solid #ccc; padding:4px 6px; text-align:right; }
    table.grid th { background:#f3f4f6; }
    td.num { font-family: monospace; text-align:left; direction:ltr; }
    td.note { color:#666; font-size:10px; max-width: 220px; }
    .footer { display:flex; justify-content:space-between; margin-top:30px; font-size:12px; }
    @media print { .kpis { grid-template-columns: repeat(4,1fr); } }
  `;
  openPrintWindow(`كشف حساب — ${courierName}`, body, css);
}

export function exportCourierStatementExcel(courierName: string, lines: StatementLine[]) {
  const s = summarizeStatement(lines);
  const rows = lines.map((l) => ({
    "التاريخ": fmtDate(l.performed_at),
    "نوع الحركة": LINE_TYPE_AR[l.line_type] || l.line_type,
    "الصنف/البيان": l.product_name || "",
    "الكمية": Number(l.quantity || 0),
    "الوحدة": l.unit || "",
    "السعر": Number(l.unit_price || 0),
    "إجمالي القيمة": Number(l.total_value || 0),
    "النقدية": Number(l.cash_collected || 0),
    "ملاحظة": l.notes || "",
  }));
  const summary = [
    { "البيان": "إجمالي البضاعة المُسلّمة", "القيمة": s.issuedValue },
    { "البيان": "المرتجعات", "القيمة": s.returnedValue },
    { "البيان": "المُباع/المُسلّم", "القيمة": s.soldValue },
    { "البيان": "المجانيات", "القيمة": s.bonusValue },
    { "البيان": "النقدية المُحصَّلة", "القيمة": s.cashCollected },
    { "البيان": "المُورَّد للخزينة", "القيمة": s.handedOver },
    { "البيان": "صافي النقدية المتبقية", "القيمة": s.netCash },
    { "البيان": "قيمة البضاعة المتبقية", "القيمة": s.outstandingGoods },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "الحركات");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "الملخص");
  const safeName = courierName.replace(/[^\u0600-\u06FFa-zA-Z0-9]+/g, "_");
  XLSX.writeFile(wb, `كشف_${safeName}_${new Date().toISOString().slice(0,10)}.xlsx`);
}
