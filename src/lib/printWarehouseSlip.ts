import { openPrintWindow, escapeHtml, fmtNum } from "@/lib/printPdf";

export interface SlipItemRow {
  name: string;
  unit: string;
  packageCount?: number | null;
  packageWeightKg?: number | null;
  quantity: number;
  stockBefore?: number | null;
  stockAfter?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
}

export interface SlipData {
  kind: "in" | "out";
  opNo: string;
  warehouseName: string;
  partyLabel: string;        // جهة التوريد / جهة الصرف
  supplier: string;          // القائم بالتوريد
  deliveryDate: string;      // تاريخ التوريد
  performedByName?: string;  // المستخدم الذي سجل
  performedAt?: string;      // ISO
  notes?: string;
  rows: SlipItemRow[];
}

export function printWarehouseSlip(d: SlipData) {
  const isIn = d.kind === "in";
  const title = isIn ? "محضر توريد للمخزن الرئيسي" : "محضر صرف منتجات من المخزن الرئيسي";
  const partyTitle = isIn ? "جهة التوريد" : "جهة الصرف";

  const performedAtTxt = d.performedAt
    ? new Date(d.performedAt).toLocaleString("ar-EG-u-nu-latn")
    : new Date().toLocaleString("ar-EG-u-nu-latn");

  const totalQty = d.rows.reduce((a, b) => a + (Number(b.quantity) || 0), 0);
  const hasPrices = d.rows.some((r) => (r.unitPrice != null && Number(r.unitPrice) > 0) || (r.totalPrice != null && Number(r.totalPrice) > 0));
  const grandTotal = d.rows.reduce((a, b) => {
    const tp = b.totalPrice != null ? Number(b.totalPrice) : (b.unitPrice != null ? Number(b.unitPrice) * Number(b.quantity || 0) : 0);
    return a + (Number.isFinite(tp) ? tp : 0);
  }, 0);

  const rowsHtml = d.rows.map((r, i) => {
    const tp = r.totalPrice != null ? Number(r.totalPrice) : (r.unitPrice != null ? Number(r.unitPrice) * Number(r.quantity || 0) : null);
    return `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.unit || "كجم")}</td>
      <td class="num">${r.packageCount != null ? fmtNum(r.packageCount) : "—"}</td>
      <td class="num">${r.packageWeightKg != null ? fmtNum(r.packageWeightKg, 3) : "—"}</td>
      <td class="num"><b>${fmtNum(r.quantity, 2)}</b></td>
      ${hasPrices ? `<td class="num">${r.unitPrice != null ? fmtNum(Number(r.unitPrice), 2) : "—"}</td>` : ""}
      ${hasPrices ? `<td class="num"><b>${tp != null ? fmtNum(tp, 2) : "—"}</b></td>` : ""}
      <td class="num">${r.stockBefore != null ? fmtNum(r.stockBefore, 2) : "—"}</td>
      <td class="num">${r.stockAfter != null ? fmtNum(r.stockAfter, 2) : "—"}</td>
    </tr>
  `;}).join("");

  const body = `
    <header>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="en">Na'am Al-Asimah — Capital Ostrich</div>
        <div style="margin-top:4px;font-size:11px;color:#444;">المخزن: <b>${escapeHtml(d.warehouseName)}</b></div>
      </div>
      <div class="meta">
        <div>رقم العملية: <b>${escapeHtml(d.opNo)}</b></div>
        <div>تاريخ التوريد: <b>${escapeHtml(d.deliveryDate)}</b></div>
        <div>تاريخ ووقت التسجيل: <b>${escapeHtml(performedAtTxt)}</b></div>
      </div>
    </header>

    <div class="stats">
      <div class="stat"><div class="k">${escapeHtml(partyTitle)}</div><div class="v">${escapeHtml(d.partyLabel || "—")}</div></div>
      <div class="stat"><div class="k">القائم بالتوريد</div><div class="v">${escapeHtml(d.supplier || "—")}</div></div>
      <div class="stat"><div class="k">المستخدم المسجِّل</div><div class="v">${escapeHtml(d.performedByName || "—")}</div></div>
      <div class="stat"><div class="k">إجمالي الكمية</div><div class="v">${fmtNum(totalQty, 2)} كجم</div></div>
      ${hasPrices ? `<div class="stat"><div class="k">إجمالي الفاتورة</div><div class="v" style="color:#059669">${fmtNum(grandTotal, 2)} ج.م</div></div>` : ""}
    </div>

    ${d.notes ? `<div style="margin:6px 0;padding:6px 8px;background:#fafafa;border:1px solid #eee;border-radius:6px;font-size:11px;">
      <b>ملاحظات:</b> ${escapeHtml(d.notes)}
    </div>` : ""}

    <h2>${isIn ? "أصناف التوريد" : "أصناف الصرف"}</h2>
    <table>
      <thead>
        <tr>
          <th style="width:30px;">#</th>
          <th>الصنف</th>
          <th style="width:60px;">الوحدة</th>
          <th style="width:70px;">عدد العبوات</th>
          <th style="width:80px;">وزن العبوة</th>
          <th style="width:90px;">الكمية</th>
          ${hasPrices ? `<th style="width:80px;">سعر الوحدة</th>` : ""}
          ${hasPrices ? `<th style="width:90px;">الإجمالي</th>` : ""}
          <th style="width:80px;">قبل</th>
          <th style="width:80px;">بعد</th>
        </tr>
      </thead>
      <tbody>${rowsHtml || `<tr><td colspan="${hasPrices ? 10 : 8}" style="text-align:center;">لا توجد أصناف</td></tr>`}</tbody>
      ${hasPrices ? `<tfoot><tr><td colspan="${5}" style="text-align:left;font-weight:700;">الإجمالي الكلي</td><td class="num"><b>${fmtNum(totalQty, 2)}</b></td><td></td><td class="num" style="color:#059669;"><b>${fmtNum(grandTotal, 2)} ج.م</b></td><td colspan="2"></td></tr></tfoot>` : ""}
    </table>


    <div style="margin-top:28px;display:grid;grid-template-columns:repeat(${isIn ? 3 : 4},1fr);gap:14px;font-size:11px;">
      ${isIn ? "" : `<div style="border-top:1px solid #555;padding-top:6px;text-align:center;">توقيع المستلم</div>`}
      <div style="border-top:1px solid #555;padding-top:6px;text-align:center;">توقيع القائم بالتوريد</div>
      <div style="border-top:1px solid #555;padding-top:6px;text-align:center;">توقيع مسؤول المخزن</div>
      <div style="border-top:1px solid #555;padding-top:6px;text-align:center;">توقيع المدير / الاعتماد</div>
    </div>
  `;

  openPrintWindow(`${title} — ${d.opNo}`, body);
}
