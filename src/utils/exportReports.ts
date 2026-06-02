import * as XLSX from "xlsx";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate, COMPANY_AR } from "@/lib/printPdf";

interface ExportData {
  totalSales: number;
  totalOrders: number;
  avgOrderValue: number;
  totalCustomers: number;
  monthlySales: { month: string; sales: number; orders: number; momPercent: number }[];
  governorateData: { name: string; sales: number; orders: number }[];
  sourceData: { name: string; value: number; orders: number }[];
  shippingData: { name: string; value: number; orders: number }[];
  moderatorData: { name: string; sales: number; orders: number; percent: number }[];
  productData: { name: string; quantity: number }[];
  periodLabel: string;
}

function buildTable(title: string, headers: string[], rows: (string | number)[][]) {
  if (rows.length === 0) return "";
  return `
    <h2>${escapeHtml(title)}</h2>
    <table>
      <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows
          .map(
            (r) =>
              `<tr>${r
                .map((c) => `<td class="num">${escapeHtml(c)}</td>`)
                .join("")}</tr>`,
          )
          .join("")}
      </tbody>
    </table>`;
}

export function exportToPDF(data: ExportData) {
  const body = `
    <header>
      <div>
        <h1>${COMPANY_AR}</h1>
        <div class="en">تقرير المبيعات — ${escapeHtml(data.periodLabel)}</div>
      </div>
      <div class="meta">
        <div>تاريخ الإصدار: ${fmtDate(new Date())}</div>
      </div>
    </header>

    <div class="stats">
      <div class="stat"><div class="k">إجمالي الإيرادات</div><div class="v">${fmtNum(data.totalSales)} ج.م</div></div>
      <div class="stat"><div class="k">إجمالي الطلبات</div><div class="v">${fmtNum(data.totalOrders)}</div></div>
      <div class="stat"><div class="k">متوسط قيمة الطلب</div><div class="v">${fmtNum(data.avgOrderValue)} ج.م</div></div>
      <div class="stat"><div class="k">العملاء</div><div class="v">${fmtNum(data.totalCustomers)}</div></div>
    </div>

    ${buildTable(
      "المبيعات الشهرية",
      ["الشهر", "المبيعات (ج.م)", "الطلبات", "النمو الشهري %"],
      data.monthlySales.map((r) => [r.month, fmtNum(r.sales), fmtNum(r.orders), `${r.momPercent}%`]),
    )}

    ${buildTable(
      "المبيعات حسب المحافظة",
      ["المحافظة", "المبيعات (ج.م)", "الطلبات"],
      data.governorateData.map((r) => [r.name, fmtNum(r.sales), fmtNum(r.orders)]),
    )}

    ${buildTable(
      "مصادر العملاء",
      ["المصدر", "النسبة %", "الطلبات"],
      data.sourceData.map((r) => [r.name, `${r.value}%`, fmtNum(r.orders)]),
    )}

    ${buildTable(
      "شركات الشحن",
      ["الشركة", "النسبة %", "الطلبات"],
      data.shippingData.map((r) => [r.name, `${r.value}%`, fmtNum(r.orders)]),
    )}

    ${buildTable(
      "أداء الموديراتور",
      ["الموديراتور", "المبيعات (ج.م)", "الطلبات", "النسبة %"],
      data.moderatorData.map((r) => [r.name, fmtNum(r.sales), fmtNum(r.orders), `${r.percent}%`]),
    )}

    ${buildTable(
      "أفضل المنتجات (بالكمية)",
      ["المنتج", "الكمية"],
      data.productData.map((r) => [r.name, fmtNum(r.quantity)]),
    )}
  `;
  openPrintWindow(`تقرير المبيعات — ${data.periodLabel}`, body);
}

export function exportToExcel(data: ExportData) {
  const wb = XLSX.utils.book_new();

  const summary = [
    ["تقرير المبيعات", data.periodLabel],
    [],
    ["إجمالي الإيرادات (ج.م)", data.totalSales],
    ["إجمالي الطلبات", data.totalOrders],
    ["متوسط قيمة الطلب (ج.م)", data.avgOrderValue],
    ["إجمالي العملاء", data.totalCustomers],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "ملخص");

  if (data.monthlySales.length > 0) {
    const ws = XLSX.utils.json_to_sheet(
      data.monthlySales.map((r) => ({
        "الشهر": r.month,
        "المبيعات (ج.م)": r.sales,
        "الطلبات": r.orders,
        "النمو %": r.momPercent,
      })),
    );
    XLSX.utils.book_append_sheet(wb, ws, "المبيعات الشهرية");
  }

  if (data.governorateData.length > 0) {
    const ws = XLSX.utils.json_to_sheet(
      data.governorateData.map((r) => ({
        "المحافظة": r.name,
        "المبيعات (ج.م)": r.sales,
        "الطلبات": r.orders,
      })),
    );
    XLSX.utils.book_append_sheet(wb, ws, "المحافظات");
  }

  if (data.sourceData.length > 0) {
    const ws = XLSX.utils.json_to_sheet(
      data.sourceData.map((r) => ({
        "المصدر": r.name,
        "النسبة %": r.value,
        "الطلبات": r.orders,
      })),
    );
    XLSX.utils.book_append_sheet(wb, ws, "المصادر");
  }

  if (data.shippingData.length > 0) {
    const ws = XLSX.utils.json_to_sheet(
      data.shippingData.map((r) => ({
        "الشركة": r.name,
        "النسبة %": r.value,
        "الطلبات": r.orders,
      })),
    );
    XLSX.utils.book_append_sheet(wb, ws, "شركات الشحن");
  }

  if (data.moderatorData.length > 0) {
    const ws = XLSX.utils.json_to_sheet(
      data.moderatorData.map((r) => ({
        "الموديراتور": r.name,
        "المبيعات (ج.م)": r.sales,
        "الطلبات": r.orders,
        "النسبة %": r.percent,
      })),
    );
    XLSX.utils.book_append_sheet(wb, ws, "الموديراتور");
  }

  if (data.productData.length > 0) {
    const ws = XLSX.utils.json_to_sheet(
      data.productData.map((r) => ({
        "المنتج": r.name,
        "الكمية": r.quantity,
      })),
    );
    XLSX.utils.book_append_sheet(wb, ws, "المنتجات");
  }

  XLSX.writeFile(wb, `تقرير-المبيعات-${data.periodLabel}.xlsx`);
}
