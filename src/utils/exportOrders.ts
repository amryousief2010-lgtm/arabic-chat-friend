import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

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
  pending: "Pending",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const paymentAR: Record<string, string> = {
  paid: "Paid",
  pending: "Pending",
  failed: "Failed",
};

const collectionAR: Record<string, string> = {
  collected: "Collected",
  not_collected: "Not Collected",
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
      r.payment_status === "paid" ? "مدفوع" : r.payment_status === "failed" ? "فشل" : "قيد الانتظار",
      r.collection_status === "collected" ? "تم التحصيل" : "لم يتم التحصيل",
      r.status,
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

export function exportOrdersToPDF(rows: OrderExportRow[], periodLabel = "All Orders") {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(16);
  doc.text(`Orders Report - ${periodLabel}`, 14, 16);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 23);
  doc.text(`Total: ${rows.length} orders`, 14, 29);

  const totalSum = rows.reduce((s, r) => s + r.total, 0);
  const collectedSum = rows
    .filter((r) => r.collection_status === "collected")
    .reduce((s, r) => s + r.total, 0);
  const paidSum = rows.filter((r) => r.payment_status === "paid").reduce((s, r) => s + r.total, 0);

  doc.text(`Total Value: ${totalSum.toLocaleString()} EGP`, 14, 35);
  doc.text(`Collected: ${collectedSum.toLocaleString()} EGP`, 110, 35);
  doc.text(`Paid: ${paidSum.toLocaleString()} EGP`, 210, 35);

  autoTable(doc, {
    startY: 42,
    head: [["#", "Customer", "Moderator", "Total", "Pay Method", "Pay Status", "Collection", "Status", "Created", "Delivered"]],
    body: rows.map((r) => [
      r.order_number,
      r.customer_name,
      r.moderator_name || "-",
      r.total.toLocaleString(),
      r.payment_method === "cash" ? "Cash" : "Online",
      paymentAR[r.payment_status] || r.payment_status,
      collectionAR[r.collection_status] || r.collection_status,
      statusAR[r.status] || r.status,
      new Date(r.created_at).toLocaleDateString(),
      r.delivered_at ? new Date(r.delivered_at).toLocaleDateString() : "-",
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [76, 29, 149] },
  });

  doc.save(`orders-${Date.now()}.pdf`);
}
