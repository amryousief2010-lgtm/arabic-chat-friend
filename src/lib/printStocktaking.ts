import { openPrintWindow, escapeHtml, fmtNum } from "@/lib/printPdf";

export interface StocktakingLineRow {
  name: string;
  unit: string;
  systemQty?: number | null;
  actualQty?: number | null;
  unitCost?: number | null;
  reason?: string | null;
  notes?: string | null;
}

export interface StocktakingMinutesData {
  warehouseName: string;
  sessionNo?: string;
  countDate: string;
  stocktakerName: string;
  approvedByName?: string | null;
  approvedAt?: string | null;
  status: "draft" | "approved" | "cancelled";
  totals?: { increase?: number; decrease?: number; net?: number };
  rows: StocktakingLineRow[];
}

const statusLabel = (s: string) =>
  s === "approved" ? "معتمد" : s === "cancelled" ? "ملغي" : "مسودة";

export function printStocktakingMinutes(d: StocktakingMinutesData) {
  const title = "محضر جرد المخزن الرئيسي";

  const rowsHtml = d.rows.map((r, i) => {
    const sys = Number(r.systemQty || 0);
    const act = Number(r.actualQty || 0);
    const diff = act - sys;
    const value = diff * Number(r.unitCost || 0);
    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.unit || "—")}</td>
        <td class="num">${fmtNum(sys, 2)}</td>
        <td class="num">${fmtNum(act, 2)}</td>
        <td class="num" style="color:${diff > 0 ? "#047857" : diff < 0 ? "#b91c1c" : "#111"};">
          ${diff > 0 ? "+" : ""}${fmtNum(diff, 2)}
        </td>
        <td class="num">${fmtNum(r.unitCost || 0, 2)}</td>
        <td class="num" style="color:${value > 0 ? "#047857" : value < 0 ? "#b91c1c" : "#111"};">
          ${fmtNum(value, 2)}
        </td>
        <td>${escapeHtml(r.reason || "—")}</td>
        <td>${escapeHtml(r.notes || "")}</td>
      </tr>`;
  }).join("");

  const totals = d.totals || {};
  const body = `
    <header>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="en">Na'am Al-Asimah — Capital Ostrich</div>
        <div style="margin-top:4px;font-size:11px;color:#444;">
          المخزن: <b>${escapeHtml(d.warehouseName)}</b>
        </div>
      </div>
      <div class="meta">
        ${d.sessionNo ? `<div>رقم الجلسة: <b>${escapeHtml(d.sessionNo)}</b></div>` : ""}
        <div>تاريخ الجرد: <b>${escapeHtml(d.countDate)}</b></div>
        <div>الحالة: <b>${escapeHtml(statusLabel(d.status))}</b></div>
        ${d.approvedAt ? `<div>تاريخ الاعتماد: <b>${escapeHtml(new Date(d.approvedAt).toLocaleString("ar-EG-u-nu-latn"))}</b></div>` : ""}
      </div>
    </header>

    <div class="stats">
      <div class="stat"><div class="k">القائم بالجرد</div><div class="v">${escapeHtml(d.stocktakerName || "—")}</div></div>
      <div class="stat"><div class="k">المعتمد بواسطة</div><div class="v">${escapeHtml(d.approvedByName || "—")}</div></div>
      <div class="stat"><div class="k">إجمالي الزيادة (قيمة)</div><div class="v" style="color:#047857;">${fmtNum(totals.increase || 0, 2)}</div></div>
      <div class="stat"><div class="k">إجمالي النقص (قيمة)</div><div class="v" style="color:#b91c1c;">${fmtNum(Math.abs(totals.decrease || 0), 2)}</div></div>
    </div>

    <div style="margin:6px 0;padding:6px 8px;background:#fafafa;border:1px solid #eee;border-radius:6px;font-size:11px;">
      <b>صافي فرق الجرد بالقيمة:</b>
      <span style="color:${(totals.net || 0) >= 0 ? "#047857" : "#b91c1c"};">
        ${fmtNum(totals.net || 0, 2)} ج.م
      </span>
    </div>

    <h2>تفاصيل الجرد</h2>
    <table>
      <thead>
        <tr>
          <th style="width:30px;">#</th>
          <th>الصنف</th>
          <th>الوحدة</th>
          <th>قبل الجرد</th>
          <th>بعد الجرد</th>
          <th>الفرق</th>
          <th>تكلفة الوحدة</th>
          <th>قيمة الفرق</th>
          <th>سبب التسوية</th>
          <th>ملاحظات</th>
        </tr>
      </thead>
      <tbody>${rowsHtml || `<tr><td colspan="10" style="text-align:center;padding:12px;">لا توجد أسطر</td></tr>`}</tbody>
    </table>

    <div style="margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div style="border-top:1px solid #333;padding-top:6px;text-align:center;font-size:11px;">
        توقيع مسؤول المخزن / القائم بالجرد<br/>
        <b>${escapeHtml(d.stocktakerName || "—")}</b>
      </div>
      <div style="border-top:1px solid #333;padding-top:6px;text-align:center;font-size:11px;">
        توقيع المدير المعتمد<br/>
        <b>${escapeHtml(d.approvedByName || "—")}</b>
      </div>
    </div>
  `;

  return openPrintWindow(title, body);
}

export interface EmptyStocktakingFormData {
  warehouseName: string;
  countDate: string;
  stocktakerName: string;
  rows: { name: string; unit: string; systemQty?: number | null }[];
}

export function printEmptyStocktakingForm(d: EmptyStocktakingFormData) {
  const title = "نموذج جرد فارغ — المخزن الرئيسي";
  const rowsHtml = d.rows.map((r, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.unit || "—")}</td>
      <td class="num" style="color:#888;">${r.systemQty != null ? fmtNum(r.systemQty, 2) : ""}</td>
      <td style="height:24px;"></td>
      <td></td>
    </tr>
  `).join("");

  const body = `
    <header>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="en">Na'am Al-Asimah — Capital Ostrich</div>
        <div style="margin-top:4px;font-size:11px;color:#444;">
          المخزن: <b>${escapeHtml(d.warehouseName)}</b>
        </div>
      </div>
      <div class="meta">
        <div>تاريخ الجرد: <b>${escapeHtml(d.countDate)}</b></div>
        <div>القائم بالجرد: <b>${escapeHtml(d.stocktakerName)}</b></div>
      </div>
    </header>

    <div style="font-size:11px;margin-bottom:8px;color:#555;">
      يستخدم هذا النموذج للجرد اليدوي على الورق. اكتب الرصيد الفعلي وأي ملاحظات بجانب كل صنف.
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:30px;">#</th>
          <th>الصنف</th>
          <th>الوحدة</th>
          <th style="color:#fff;">رصيد النظام (مرجعي)</th>
          <th style="width:120px;">الرصيد الفعلي</th>
          <th>ملاحظات</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <div style="margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div style="border-top:1px solid #333;padding-top:6px;text-align:center;font-size:11px;">
        توقيع القائم بالجرد<br/><b>${escapeHtml(d.stocktakerName)}</b>
      </div>
      <div style="border-top:1px solid #333;padding-top:6px;text-align:center;font-size:11px;">
        توقيع المدير
      </div>
    </div>
  `;

  return openPrintWindow(title, body);
}
