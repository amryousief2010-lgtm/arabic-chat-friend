import * as XLSX from "xlsx";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate, COMPANY_AR } from "@/lib/printPdf";

export interface OrderExportRow {
  order_number: string;
  customer_name: string;
  moderator_name: string;
  total: number;
  payment_method: string;
  payment_status: string;
  collection_status: string;
  status: string;
  created_at: string;
  delivered_at: string | null;
}

const statusAR: Record<string, string> = {
  pending: "قيد الانتظار",
  processing: "قيد التنفيذ",
  shipped: "تم الشحن",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

const paymentStatusAR: Record<string, string> = {
  paid: "مدفوع",
  pending: "قيد الانتظار",
  failed: "فشل",
};

const collectionAR: Record<string, string> = {
  collected: "تم التحصيل",
  not_collected: "لم يتم التحصيل",
};

export function exportOrdersToCSV(rows: OrderExportRow[], filename = "orders.csv") {
  const header = [
    "رقم الطلب",
    "العميل",
    "الموديريتور",
    "الإجمالي",
    "طريقة الدفع",
    "حالة الدفع",
    "حالة التحصيل",
    "حالة الطلب",
    "تاريخ الإنشاء",
    "تاريخ التسليم",
  ];
  const csvRows = [header.join(",")];
  rows.forEach((r) => {
    const line = [
      r.order_number,
      `"${r.customer_name.replace(/"/g, '""')}"`,
      `"${(r.moderator_name || "").replace(/"/g, '""')}"`,
      r.total,
      r.payment_method === "cash" ? "نقدي" : "إلكتروني",
      paymentStatusAR[r.payment_status] || r.payment_status,
      collectionAR[r.collection_status] || r.collection_status,
      statusAR[r.status] || r.status,
      new Date(r.created_at).toLocaleString("ar-EG"),
      r.delivered_at ? new Date(r.delivered_at).toLocaleString("ar-EG") : "-",
    ];
    csvRows.push(line.join(","));
  });
  const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportOrdersToXLSX(rows: OrderExportRow[], filename = `orders-${Date.now()}.xlsx`) {
  const data = rows.map((r) => ({
    "رقم الطلب": r.order_number,
    "العميل": r.customer_name,
    "الموديريتور": r.moderator_name || "",
    "الإجمالي": r.total,
    "طريقة الدفع": r.payment_method === "cash" ? "نقدي" : "إلكتروني",
    "حالة الدفع": paymentStatusAR[r.payment_status] || r.payment_status,
    "حالة التحصيل": collectionAR[r.collection_status] || r.collection_status,
    "حالة الطلب": statusAR[r.status] || r.status,
    "تاريخ الإنشاء": new Date(r.created_at).toLocaleString("ar-EG"),
    "تاريخ التسليم": r.delivered_at ? new Date(r.delivered_at).toLocaleString("ar-EG") : "-",
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "الطلبات");
  XLSX.writeFile(wb, filename, { bookType: "xlsx" });
}

export function exportOrdersToPDF(rows: OrderExportRow[], periodLabel = "كل الطلبات") {
  const totalSum = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const collectedSum = rows
    .filter((r) => r.collection_status === "collected")
    .reduce((s, r) => s + Number(r.total || 0), 0);
  const paidSum = rows
    .filter((r) => r.payment_status === "paid")
    .reduce((s, r) => s + Number(r.total || 0), 0);

  const body = `
    <header>
      <div>
        <h1>${COMPANY_AR}</h1>
        <div class="en">تقرير الطلبات — ${escapeHtml(periodLabel)}</div>
      </div>
      <div class="meta">
        <div>تاريخ الإصدار: ${fmtDate(new Date())}</div>
        <div>عدد الطلبات: <b>${fmtNum(rows.length)}</b></div>
      </div>
    </header>

    <div class="stats">
      <div class="stat"><div class="k">إجمالي القيمة</div><div class="v">${fmtNum(totalSum)} ج.م</div></div>
      <div class="stat"><div class="k">المُحصّل</div><div class="v">${fmtNum(collectedSum)} ج.م</div></div>
      <div class="stat"><div class="k">المدفوع</div><div class="v">${fmtNum(paidSum)} ج.م</div></div>
      <div class="stat"><div class="k">عدد الطلبات</div><div class="v">${fmtNum(rows.length)}</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>رقم الطلب</th>
          <th>العميل</th>
          <th>الموديريتور</th>
          <th>الإجمالي</th>
          <th>طريقة الدفع</th>
          <th>حالة الدفع</th>
          <th>التحصيل</th>
          <th>الحالة</th>
          <th>تاريخ الإنشاء</th>
          <th>تاريخ التسليم</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr>
              <td>${escapeHtml(r.order_number)}</td>
              <td>${escapeHtml(r.customer_name)}</td>
              <td>${escapeHtml(r.moderator_name || "—")}</td>
              <td class="num">${fmtNum(r.total)}</td>
              <td>${r.payment_method === "cash" ? "نقدي" : "إلكتروني"}</td>
              <td>${escapeHtml(paymentStatusAR[r.payment_status] || r.payment_status)}</td>
              <td>${escapeHtml(collectionAR[r.collection_status] || r.collection_status)}</td>
              <td>${escapeHtml(statusAR[r.status] || r.status)}</td>
              <td>${escapeHtml(new Date(r.created_at).toLocaleDateString("ar-EG-u-nu-latn"))}</td>
              <td>${r.delivered_at ? escapeHtml(new Date(r.delivered_at).toLocaleDateString("ar-EG-u-nu-latn")) : "—"}</td>
            </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  `;
  openPrintWindow(`تقرير الطلبات — ${periodLabel}`, body);
}
