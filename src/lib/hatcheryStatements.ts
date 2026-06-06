/**
 * Hatchery account-statement printing & export helpers.
 * NO financial side-effects — only renders read-only HTML for print, exports
 * Excel, and writes an audit row to hatchery_print_audit.
 */
import * as XLSX from "xlsx";
import { openPrintWindow, escapeHtml, fmtNum, COMPANY_AR } from "@/lib/printPdf";
import { supabase } from "@/integrations/supabase/client";

const FOOTNOTE =
  "هذا الكشف يوضح بيانات التفريخ والحسابات التقديرية، ولا يُعد إثبات تحصيل إلا للحركات المعتمدة في خزنة المعمل.";

const dash = (v: any) => (v == null || v === "" ? "—" : v);

export type BatchStatementRow = {
  id?: string;
  batch_number?: string | number;
  customer_name?: string;
  customer_type?: "internal" | "external" | string;
  is_imported?: boolean;
  receive_date?: string | null;
  entry_date?: string | null;
  machine?: string | null;
  received_eggs?: number;
  damaged?: number;
  net_eggs?: number;
  candle1_date?: string | null;
  candle1_infertile?: number;
  candle1_fertile?: number;
  candle2_date?: string | null;
  candle2_dead?: number;
  candle2_fertile?: number;
  exit_date?: string | null;
  hatcher_dead?: number;
  hatched_chicks?: number;
  charge_total?: number;
  notes?: string | null;
};

const ratio = (num?: number, den?: number) =>
  den && num != null ? `${((num / den) * 100).toFixed(1)}%` : "—";

async function writeAudit(
  reportType: "batch" | "customer",
  targetRef: string,
  targetLabel: string,
  meta?: Record<string, any>,
) {
  try {
    const { data: u } = await supabase.auth.getUser();
    const userName =
      (u?.user?.user_metadata as any)?.full_name ||
      u?.user?.email ||
      "غير معروف";
    await (supabase as any).from("hatchery_print_audit").insert({
      user_id: u?.user?.id ?? null,
      user_name: userName,
      report_type: reportType,
      target_ref: targetRef,
      target_label: targetLabel,
      meta: meta ?? {},
    });
  } catch {
    /* never block printing on audit failure */
  }
}

// ---------- Batch statement ----------
export async function printBatchStatement(b: BatchStatementRow) {
  const isInternal =
    b.customer_type === "internal" || /عاصمة|داخل/.test(b.customer_name || "");
  const netAfterC2 =
    (b.net_eggs || 0) - (b.candle1_infertile || 0) - (b.candle2_dead || 0);
  const fertility = ratio(b.candle1_fertile, b.received_eggs);
  const hatchRate = ratio(b.hatched_chicks, b.received_eggs);
  const damaged =
    b.damaged != null
      ? b.damaged
      : Math.max(0, (b.received_eggs || 0) - (b.net_eggs || 0));
  const isHistoric = !!b.is_imported;
  const chargeLabel = isInternal
    ? "تكلفة تقديرية داخلية"
    : isHistoric
      ? "حساب تقديري تاريخي"
      : "حساب تقديري";

  const printedAt = new Date().toLocaleString("ar-EG-u-nu-latn");
  const body = `
  <header>
    <div>
      <h1>${escapeHtml(COMPANY_AR)}</h1>
      <div class="en">كشف حساب دفعة تفريخ</div>
    </div>
    <div class="meta">
      <div>رقم الدفعة: <b>${escapeHtml(b.batch_number)}</b></div>
      <div>تاريخ الطباعة: ${escapeHtml(printedAt)}</div>
      <div>${isHistoric ? "<b>دفعة تاريخية مستوردة</b>" : "دفعة تشغيلية"}</div>
    </div>
  </header>

  <h2>بيانات العميل والدفعة</h2>
  <table>
    <tbody>
      <tr><th style="width:25%">اسم العميل</th><td>${escapeHtml(b.customer_name)}</td>
          <th style="width:20%">نوع العميل</th><td>${isInternal ? "داخلي (نعام العاصمة)" : "خارجي"}</td></tr>
      <tr><th>تاريخ الوارد</th><td>${escapeHtml(dash(b.receive_date))}</td>
          <th>تاريخ الدخول</th><td>${escapeHtml(dash(b.entry_date))}</td></tr>
      <tr><th>الماكينة</th><td>${escapeHtml(dash(b.machine))}</td>
          <th>تاريخ الخروج</th><td>${escapeHtml(dash(b.exit_date))}</td></tr>
    </tbody>
  </table>

  <h2>البيض والإنتاج</h2>
  <div class="stats">
    <div class="stat"><div class="k">إجمالي البيض الوارد</div><div class="v">${fmtNum(b.received_eggs)}</div></div>
    <div class="stat"><div class="k">التالف</div><div class="v">${fmtNum(damaged)}</div></div>
    <div class="stat"><div class="k">الصافي</div><div class="v">${fmtNum(b.net_eggs)}</div></div>
    <div class="stat"><div class="k">عدد الكتاكيت</div><div class="v">${fmtNum(b.hatched_chicks)}</div></div>
  </div>

  <h2>الكشف الأول</h2>
  <table>
    <tbody>
      <tr><th style="width:25%">التاريخ</th><td>${escapeHtml(dash(b.candle1_date))}</td>
          <th style="width:25%">لايح</th><td class="num">${fmtNum(b.candle1_infertile)}</td></tr>
      <tr><th>مخصب</th><td class="num">${fmtNum(b.candle1_fertile)}</td>
          <th>نسبة الخصوبة</th><td>${fertility}</td></tr>
    </tbody>
  </table>

  <h2>الكشف الثاني</h2>
  <table>
    <tbody>
      <tr><th style="width:25%">التاريخ</th><td>${escapeHtml(dash(b.candle2_date))}</td>
          <th style="width:25%">نافق كشف ثاني</th><td class="num">${fmtNum(b.candle2_dead)}</td></tr>
      <tr><th>الصافي بعد الكشف الثاني</th><td class="num">${fmtNum(netAfterC2)}</td>
          <th>مخصب بعد الكشف الثاني</th><td class="num">${fmtNum(b.candle2_fertile)}</td></tr>
    </tbody>
  </table>

  <h2>الخروج / الهاتشر</h2>
  <table>
    <tbody>
      <tr><th style="width:25%">تاريخ الخروج</th><td>${escapeHtml(dash(b.exit_date))}</td>
          <th style="width:25%">نافق الهاتشر</th><td class="num">${fmtNum(b.hatcher_dead)}</td></tr>
      <tr><th>عدد الكتاكيت</th><td class="num">${fmtNum(b.hatched_chicks)}</td>
          <th>نسبة الفقس</th><td>${hatchRate}</td></tr>
    </tbody>
  </table>

  <h2>${escapeHtml(chargeLabel)}</h2>
  <div class="stats">
    <div class="stat" style="grid-column: span 4; background:#f7f2ff;">
      <div class="k">${escapeHtml(chargeLabel)}</div>
      <div class="v" style="color:#6b46c1">${fmtNum(b.charge_total)} ج.م</div>
      ${isInternal ? '<div class="k" style="margin-top:6px">قيمة داخلية لنعام العاصمة — لا تُحتسب مديونية.</div>' : ""}
      ${isHistoric && !isInternal ? '<div class="k" style="margin-top:6px">حساب تاريخي للمراجعة فقط — تحت التسوية.</div>' : ""}
    </div>
  </div>

  ${b.notes ? `<h2>ملاحظات</h2><div style="border:1px solid #e0e0e0;border-radius:6px;padding:8px;background:#fafafa">${escapeHtml(b.notes)}</div>` : ""}

  <div style="margin-top:30px;display:flex;justify-content:space-between;gap:20px">
    <div style="border-top:1px dashed #999;padding-top:6px;width:40%;text-align:center;font-size:11px">المسؤول / الختم</div>
    <div style="border-top:1px dashed #999;padding-top:6px;width:40%;text-align:center;font-size:11px">العميل</div>
  </div>

  <div style="margin-top:20px;padding:8px;background:#fff7e6;border:1px solid #ffd58a;border-radius:6px;font-size:10px">
    ${escapeHtml(FOOTNOTE)}
  </div>
  `;

  openPrintWindow(`كشف حساب دفعة ${b.batch_number ?? ""}`, body);
  await writeAudit("batch", String(b.id ?? b.batch_number ?? ""), `دفعة ${b.batch_number ?? ""} — ${b.customer_name ?? ""}`);
}

// ---------- Customer statement ----------
export type CustomerStatementBatch = {
  batch_number?: string | number;
  receive_date?: string | null;
  entry_date?: string | null;
  exit_date?: string | null;
  machine?: string | null;
  received_eggs?: number;
  net_eggs?: number;
  hatched_chicks?: number;
  charge_total?: number;
  is_imported?: boolean;
  is_completed?: boolean;
};

export type CustomerStatementOptions = {
  customerName: string;
  phone?: string | null;
  customerType?: "internal" | "external";
  fromDate?: string;
  toDate?: string;
  batches: CustomerStatementBatch[];
  collected?: number;
  mode?: "detailed" | "summary";
  filterLabel?: string;
};

export async function printCustomerStatement(opts: CustomerStatementOptions) {
  const isInternal = opts.customerType === "internal";
  const totals = opts.batches.reduce(
    (s, b) => ({
      eggs: s.eggs + (b.received_eggs || 0),
      chicks: s.chicks + (b.hatched_chicks || 0),
      charge: s.charge + (b.charge_total || 0),
      historic: s.historic + (b.is_imported ? b.charge_total || 0 : 0),
      current: s.current + (!b.is_imported ? b.charge_total || 0 : 0),
    }),
    { eggs: 0, chicks: 0, charge: 0, historic: 0, current: 0 },
  );

  const collected = opts.collected || 0;
  const dueCurrent = totals.current; // current cycle obligation
  const remaining = Math.max(0, dueCurrent - collected);
  const printedAt = new Date().toLocaleString("ar-EG-u-nu-latn");
  const isDetailed = opts.mode !== "summary";

  const tableRows = opts.batches
    .map(
      (b, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(b.batch_number)}</td>
      <td>${escapeHtml(dash(b.receive_date))}</td>
      ${isDetailed ? `<td>${escapeHtml(dash(b.entry_date))}</td><td>${escapeHtml(dash(b.exit_date))}</td><td>${escapeHtml(dash(b.machine))}</td>` : ""}
      <td class="num">${fmtNum(b.received_eggs)}</td>
      <td class="num">${fmtNum(b.hatched_chicks)}</td>
      <td class="num">${fmtNum(b.charge_total)}</td>
      <td>${b.is_imported ? "تاريخية" : "حالية"}</td>
    </tr>`,
    )
    .join("");

  const body = `
  <header>
    <div>
      <h1>${escapeHtml(COMPANY_AR)}</h1>
      <div class="en">كشف حساب عميل المعمل</div>
    </div>
    <div class="meta">
      <div>تاريخ الطباعة: ${escapeHtml(printedAt)}</div>
      ${opts.fromDate || opts.toDate ? `<div>الفترة: ${escapeHtml(opts.fromDate || "—")} → ${escapeHtml(opts.toDate || "—")}</div>` : ""}
      ${opts.filterLabel ? `<div>الفلتر: ${escapeHtml(opts.filterLabel)}</div>` : ""}
    </div>
  </header>

  <h2>بيانات العميل</h2>
  <table>
    <tbody>
      <tr><th style="width:20%">اسم العميل</th><td>${escapeHtml(opts.customerName)}</td>
          <th style="width:20%">نوع العميل</th><td>${isInternal ? "داخلي (نعام العاصمة)" : "خارجي"}</td></tr>
      <tr><th>رقم الهاتف</th><td>${escapeHtml(dash(opts.phone))}</td>
          <th>عدد الدفعات</th><td>${fmtNum(opts.batches.length)}</td></tr>
    </tbody>
  </table>

  <h2>الإجماليات</h2>
  <div class="stats">
    <div class="stat"><div class="k">إجمالي البيض</div><div class="v">${fmtNum(totals.eggs)}</div></div>
    <div class="stat"><div class="k">إجمالي الكتاكيت</div><div class="v">${fmtNum(totals.chicks)}</div></div>
    <div class="stat"><div class="k">إجمالي الحساب التقديري</div><div class="v">${fmtNum(totals.charge)} ج.م</div></div>
    <div class="stat"><div class="k">نسبة الفقس</div><div class="v">${totals.eggs ? ((totals.chicks / totals.eggs) * 100).toFixed(1) + "%" : "—"}</div></div>
  </div>

  <h2>تفصيل الحساب</h2>
  <div class="stats">
    <div class="stat" style="background:#fff7e6"><div class="k">حساب تاريخي تقديري</div><div class="v" style="color:#b45309">${fmtNum(totals.historic)} ج.م</div></div>
    <div class="stat" style="background:#eff6ff"><div class="k">واجب التحصيل (دفعات حالية)</div><div class="v" style="color:#1d4ed8">${fmtNum(dueCurrent)} ج.م</div></div>
    <div class="stat" style="background:#ecfdf5"><div class="k">المحصل فعليًا من خزنة المعمل</div><div class="v" style="color:#047857">${fmtNum(collected)} ج.م</div></div>
    <div class="stat" style="background:#fef2f2"><div class="k">المتبقي الفعلي</div><div class="v" style="color:#b91c1c">${fmtNum(remaining)} ج.م</div></div>
  </div>
  ${
    isInternal
      ? `<div style="padding:8px;background:#f5edff;border:1px solid #d8bfff;border-radius:6px;font-size:11px;margin-bottom:8px">
           قيمة نعام العاصمة الداخلية: <b>${fmtNum(totals.charge)} ج.م</b> — لا تُحتسب مديونية.
         </div>`
      : ""
  }

  <h2>دفعات العميل</h2>
  <table>
    <thead>
      <tr>
        <th>#</th><th>رقم الدفعة</th><th>الوارد</th>
        ${isDetailed ? "<th>الدخول</th><th>الخروج</th><th>الماكينة</th>" : ""}
        <th>البيض</th><th>الكتاكيت</th><th>الحساب</th><th>النوع</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
    <tfoot>
      <tr style="background:#f7f2ff;font-weight:bold">
        <td colspan="${isDetailed ? 6 : 3}">الإجماليات</td>
        <td class="num">${fmtNum(totals.eggs)}</td>
        <td class="num">${fmtNum(totals.chicks)}</td>
        <td class="num">${fmtNum(totals.charge)}</td>
        <td>—</td>
      </tr>
    </tfoot>
  </table>

  <div style="margin-top:30px;display:flex;justify-content:space-between;gap:20px">
    <div style="border-top:1px dashed #999;padding-top:6px;width:40%;text-align:center;font-size:11px">المسؤول / الختم</div>
    <div style="border-top:1px dashed #999;padding-top:6px;width:40%;text-align:center;font-size:11px">العميل</div>
  </div>

  <div style="margin-top:20px;padding:8px;background:#fff7e6;border:1px solid #ffd58a;border-radius:6px;font-size:10px">
    ${escapeHtml(FOOTNOTE)}
  </div>
  `;

  openPrintWindow(`كشف حساب ${opts.customerName}`, body);
  await writeAudit("customer", opts.customerName, `كشف حساب ${opts.customerName}`, {
    from: opts.fromDate,
    to: opts.toDate,
    count: opts.batches.length,
    mode: opts.mode || "detailed",
    filter: opts.filterLabel,
  });
}

export async function exportCustomerStatementExcel(opts: CustomerStatementOptions) {
  const rows = opts.batches.map((b, i) => ({
    "#": i + 1,
    "رقم الدفعة": b.batch_number,
    "الوارد": b.receive_date,
    "الدخول": b.entry_date,
    "الخروج": b.exit_date,
    "الماكينة": b.machine,
    "البيض": b.received_eggs ?? 0,
    "الكتاكيت": b.hatched_chicks ?? 0,
    "الحساب التقديري": b.charge_total ?? 0,
    "النوع": b.is_imported ? "تاريخية" : "حالية",
  }));
  const totals = opts.batches.reduce(
    (s, b) => ({
      eggs: s.eggs + (b.received_eggs || 0),
      chicks: s.chicks + (b.hatched_chicks || 0),
      charge: s.charge + (b.charge_total || 0),
    }),
    { eggs: 0, chicks: 0, charge: 0 },
  );
  rows.push({
    "#": "" as any,
    "رقم الدفعة": "الإجماليات" as any,
    "الوارد": "" as any,
    "الدخول": "" as any,
    "الخروج": "" as any,
    "الماكينة": "" as any,
    "البيض": totals.eggs,
    "الكتاكيت": totals.chicks,
    "الحساب التقديري": totals.charge,
    "النوع": "" as any,
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "كشف العميل");
  XLSX.writeFile(
    wb,
    `كشف-حساب-${opts.customerName}-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
  await writeAudit("customer", opts.customerName, `Excel — ${opts.customerName}`, {
    format: "excel",
    count: opts.batches.length,
  });
}
