/**
 * Browser-print HTML report for Meat & Feed production batches.
 *
 * Replaces the previous jsPDF implementation, which could not render Arabic
 * glyphs reliably (Helvetica/Latin only). This version opens a new window with
 * a fully RTL Arabic A4 layout and triggers the system print dialog so the
 * user can "Save as PDF" — which preserves Arabic shaping & ligatures.
 *
 * Export signature kept identical so detail pages do not need any changes.
 */

export interface BatchPDFInput {
  factory: "Meat Factory" | "Feed Factory";
  batch: any;
  consumption: any[];
  packaging?: any[];
  movements: any[];
  audit?: any[];
  preparedBy?: string | null;
  approvedBy?: string | null;
  closedBy?: string | null;
}

const COMPANY_AR = "شركة نعم العاصمة";
const COMPANY_EN = "Na'am Al-Asimah — Capital Ostrich";

const fmt = (v: any, d = 2) =>
  v == null || v === "" || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(d);
const dt = (v: any) => (v ? new Date(v).toLocaleString("ar-EG-u-nu-latn") : "—");
const esc = (v: any) =>
  String(v ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export function exportBatchPDF(input: BatchPDFInput) {
  const { batch, consumption, packaging = [], movements, factory } = input;
  const isMeat = factory === "Meat Factory";
  const factoryAr = isMeat ? "مصنع اللحوم" : "مصنع الأعلاف";
  const qty = isMeat ? batch.actual_qty : batch.actual_quantity;
  const planned = isMeat ? batch.planned_qty : batch.target_quantity;
  const cpu = isMeat ? batch.cost_per_unit : batch.cost_per_kg;
  const unitLabel = isMeat ? batch.unit || "وحدة" : "كجم";
  const productLabel = isMeat
    ? `${batch.product_name_ar || "—"} (${batch.product_code || "—"})`
    : `معرّف العلف: ${String(batch.feed_product_id || "—").slice(0, 8)}`;
  const isTest = /TEST-DISPATCH/i.test(batch.notes || "");

  const plannedCost = batch.planned_total_cost;
  const actualCost = Number(batch.total_cost || 0);
  const variance =
    plannedCost == null ? null : actualCost - Number(plannedCost);
  const variancePct =
    plannedCost == null || Number(plannedCost) === 0
      ? null
      : ((actualCost - Number(plannedCost)) / Number(plannedCost)) * 100;

  const consRows = consumption.length
    ? consumption
        .map(
          (c: any) => `<tr>
            <td>${esc(c.material_code || c.raw_material_id?.slice?.(0, 8))}</td>
            <td>${esc(c.material_name_ar || c.material_name || c.raw_material?.name)}</td>
            <td>${fmt(c.quantity, 3)}</td>
            <td>${fmt(c.actual_qty, 3)}</td>
            <td>${esc(c.unit || "")}</td>
            <td>${fmt(c.unit_cost, 4)}</td>
            <td>${fmt(c.line_total ?? c.total_cost, 2)}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="7" class="empty">لا توجد بنود استهلاك</td></tr>`;

  const packBlock = packaging.length
    ? `<h3>مواد التغليف</h3>
       <table class="lines">
         <thead><tr><th>الاسم</th><th>الكمية</th><th>الوحدة</th><th>تكلفة الوحدة</th><th>الإجمالي</th></tr></thead>
         <tbody>${packaging
           .map(
             (p: any) => `<tr>
               <td>${esc(p.packaging_name_ar)}</td>
               <td>${fmt(p.quantity, 2)}</td>
               <td>${esc(p.unit || "")}</td>
               <td>${fmt(p.unit_cost, 4)}</td>
               <td>${fmt(p.line_total, 2)}</td>
             </tr>`,
           )
           .join("")}</tbody>
       </table>`
    : "";

  const movRows = movements.length
    ? movements
        .map(
          (m: any) => `<tr>
            <td>${esc(m.movement_no)}</td>
            <td>${esc(m.movement_type)}</td>
            <td>${fmt(m.quantity, 3)}</td>
            <td>${fmt(m.unit_cost, 4)}</td>
            <td>${fmt(m.total_cost, 2)}</td>
            <td>${dt(m.performed_at || m.created_at)}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="6" class="empty">لا توجد حركات مخزون</td></tr>`;

  const plannedLabel =
    plannedCost == null
      ? `<span class="muted">لقطة التخطيط غير متاحة</span>`
      : fmt(plannedCost, 2);
  const varianceLabel =
    variance == null
      ? `<span class="muted">—</span>`
      : `${fmt(variance, 2)} (${variancePct == null ? "—" : variancePct.toFixed(2) + "%"})`;

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>تقرير دفعة إنتاج — ${esc(batch.batch_number || batch.id)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Cairo","Tajawal","Noto Naskh Arabic","Segoe UI",Tahoma,sans-serif;
         font-size: 11px; color: #111; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #6b46c1; padding-bottom: 8px; margin-bottom: 10px; }
  header .brand h1 { margin: 0; font-size: 18px; color: #6b46c1; }
  header .brand .en { font-size: 10px; color: #777; }
  header .meta { text-align: left; font-size: 10px; color: #444; }
  .test-banner { background: #fff5e6; border: 1px dashed #e65100;
                 color: #e65100; padding: 4px 8px; margin-bottom: 8px;
                 font-weight: bold; text-align: center; }
  .info-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 12px;
               border: 1px solid #ddd; padding: 8px; margin-bottom: 10px; border-radius: 4px; }
  .info-grid .k { color: #666; font-size: 10px; }
  .info-grid .v { font-weight: bold; font-size: 11px; }
  h3 { margin: 12px 0 4px; font-size: 13px; color: #6b46c1;
       border-bottom: 1px solid #ddd; padding-bottom: 2px; }
  table.lines { width: 100%; border-collapse: collapse; font-size: 10px; }
  table.lines th { background: #6b46c1; color: #fff; padding: 4px 6px; text-align: right; }
  table.lines td { border: 1px solid #e0e0e0; padding: 3px 6px; text-align: right; }
  table.lines td.empty { text-align: center; color: #999; padding: 12px; }
  .cost-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
               margin-top: 6px; }
  .cost-cell { border: 1px solid #ddd; padding: 6px; border-radius: 4px; }
  .cost-cell .k { color: #666; font-size: 10px; }
  .cost-cell .v { font-weight: bold; font-size: 12px; }
  .cost-cell.total { background: #f5edff; border-color: #6b46c1; }
  .cost-cell.variance { background: ${variance != null && variance > 0 ? "#fff0f0" : "#f0fff4"};
                        border-color: ${variance != null && variance > 0 ? "#d32f2f" : "#2e7d32"}; }
  .signatures { display: grid; grid-template-columns: repeat(3, 1fr);
                gap: 12px; margin-top: 16px; }
  .sig { border-top: 1px solid #999; padding-top: 4px; font-size: 10px; }
  .sig .role { color: #666; }
  .sig .name { font-weight: bold; margin-top: 2px; }
  .notes { margin-top: 10px; padding: 6px; background: #fafafa;
           border: 1px solid #eee; font-size: 10px; }
  .muted { color: #999; }
  footer { position: fixed; bottom: 6mm; left: 0; right: 0;
           text-align: center; font-size: 9px; color: #888; }
  @media print { .no-print { display: none; } }
  .no-print { padding: 8px; background: #f5edff; text-align: center; }
  .no-print button { font-size: 14px; padding: 6px 16px; cursor: pointer; }
</style>
</head>
<body>
<div class="no-print">
  <button onclick="window.print()">طباعة / حفظ كـ PDF</button>
  &nbsp; <button onclick="window.close()">إغلاق</button>
</div>

<header>
  <div class="brand">
    <h1>${COMPANY_AR}</h1>
    <div class="en">${COMPANY_EN}</div>
    <div style="margin-top:4px;font-size:12px;">${factoryAr} — تقرير دفعة إنتاج</div>
  </div>
  <div class="meta">
    <div>تاريخ الطباعة: ${dt(new Date())}</div>
    <div>رقم الدفعة: <b>${esc(batch.batch_number)}</b></div>
    <div>الحالة: <b>${esc(batch.status)}</b></div>
  </div>
</header>

${isTest ? `<div class="test-banner">⚠ بيانات اختبار (TEST-DISPATCH) — ليست للتشغيل الفعلي</div>` : ""}

<div class="info-grid">
  <div><div class="k">رقم الدفعة</div><div class="v">${esc(batch.batch_number)}</div></div>
  <div><div class="k">تاريخ الدفعة</div><div class="v">${esc(batch.production_date || (batch.created_at || "").slice(0, 10))}</div></div>
  <div><div class="k">المنتج / نوع العلف</div><div class="v">${esc(productLabel)}</div></div>
  <div><div class="k">إصدار الوصفة BOM</div><div class="v">v${esc(batch.bom_version ?? "—")}</div></div>
  <div><div class="k">الكمية المخططة</div><div class="v">${fmt(planned, 3)} ${esc(unitLabel)}</div></div>
  <div><div class="k">الكمية الفعلية</div><div class="v">${fmt(qty, 3)} ${esc(unitLabel)}</div></div>
  <div><div class="k">الهالك (كمية / تكلفة)</div><div class="v">${fmt(batch.waste_qty, 3)} / ${fmt(batch.waste_cost, 2)}</div></div>
  <div><div class="k">تكلفة الـ ${esc(unitLabel)}</div><div class="v">${fmt(cpu, 4)}</div></div>
</div>

<h3>الخامات المستهلكة</h3>
<table class="lines">
  <thead><tr>
    <th>الكود</th><th>الاسم</th><th>مخطط</th><th>فعلي</th><th>الوحدة</th><th>تكلفة الوحدة</th><th>الإجمالي</th>
  </tr></thead>
  <tbody>${consRows}</tbody>
</table>

${packBlock}

<h3>ملخص التكلفة</h3>
<div class="cost-grid">
  <div class="cost-cell"><div class="k">تكلفة المواد</div><div class="v">${fmt(batch.materials_cost)}</div></div>
  <div class="cost-cell"><div class="k">تكلفة التغليف</div><div class="v">${fmt(batch.packaging_cost)}</div></div>
  <div class="cost-cell"><div class="k">تكلفة العمالة</div><div class="v">${fmt(batch.labor_cost)}</div></div>
  <div class="cost-cell"><div class="k">تكلفة الخدمة</div><div class="v">${fmt(batch.service_cost)}</div></div>
  <div class="cost-cell"><div class="k">مصروفات أخرى</div><div class="v">${fmt(batch.other_expenses ?? batch.other_cost)}</div></div>
  <div class="cost-cell"><div class="k">قيمة المنتج الجانبي</div><div class="v">${fmt(batch.byproduct_value)}</div></div>
  <div class="cost-cell total"><div class="k">إجمالي التكلفة الفعلية</div><div class="v">${fmt(actualCost)}</div></div>
  <div class="cost-cell"><div class="k">إجمالي التكلفة المخططة</div><div class="v">${plannedLabel}</div></div>
  <div class="cost-cell variance"><div class="k">الفرق (فعلي − مخطط)</div><div class="v">${varianceLabel}</div></div>
  <div class="cost-cell"><div class="k">تكلفة ${esc(unitLabel)}</div><div class="v">${fmt(cpu, 4)}</div></div>
</div>

<h3>حركات المخزون الناتجة (${movements.length})</h3>
<table class="lines">
  <thead><tr>
    <th>رقم الحركة</th><th>النوع</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th><th>التاريخ</th>
  </tr></thead>
  <tbody>${movRows}</tbody>
</table>

<div class="signatures">
  <div class="sig">
    <div class="role">أُعدّ بواسطة</div>
    <div class="name">${esc(input.preparedBy || batch.created_by || "—")}</div>
    <div>—</div>
  </div>
  <div class="sig">
    <div class="role">اعتُمد بواسطة</div>
    <div class="name">${esc(input.approvedBy || batch.approved_by || "—")}</div>
    <div>${dt(batch.approved_at)}</div>
  </div>
  <div class="sig">
    <div class="role">أُغلق بواسطة</div>
    <div class="name">${esc(input.closedBy || batch.closed_by || "—")}</div>
    <div>${dt(batch.closed_at)}</div>
  </div>
</div>

${batch.notes ? `<div class="notes"><b>ملاحظات التدقيق:</b> ${esc(batch.notes)}</div>` : ""}

<footer>${COMPANY_AR} • ${COMPANY_EN} • ${esc(batch.batch_number)}</footer>

<script>
  // Auto-trigger print dialog once fonts have loaded.
  window.addEventListener("load", function () {
    setTimeout(function () { try { window.print(); } catch (e) {} }, 300);
  });
</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) {
    alert("الرجاء السماح بفتح النوافذ المنبثقة لطباعة تقرير الدفعة.");
    return null;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  return `print:${batch.batch_number || batch.id}`;
}

/** Compatibility re-export. */
export function buildBatchPDF(input: BatchPDFInput) {
  return exportBatchPDF(input);
}
