import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

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

export function exportToPDF(data: ExportData) {
  const doc = new jsPDF({ orientation: "landscape" });

  // Title
  doc.setFontSize(18);
  doc.text(`Sales Report - ${data.periodLabel}`, 14, 20);

  // Summary
  doc.setFontSize(11);
  doc.text(`Total Revenue: ${data.totalSales.toLocaleString()} EGP`, 14, 32);
  doc.text(`Total Orders: ${data.totalOrders.toLocaleString()}`, 14, 39);
  doc.text(`Avg Order Value: ${data.avgOrderValue.toLocaleString()} EGP`, 14, 46);
  doc.text(`Customers: ${data.totalCustomers.toLocaleString()}`, 14, 53);

  let y = 62;

  // Monthly Sales
  if (data.monthlySales.length > 0) {
    doc.setFontSize(13);
    doc.text("Monthly Sales", 14, y);
    autoTable(doc, {
      startY: y + 4,
      head: [["Month", "Sales (EGP)", "Orders", "MoM %"]],
      body: data.monthlySales.map((r) => [r.month, r.sales.toLocaleString(), r.orders, `${r.momPercent}%`]),
      styles: { fontSize: 9 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Governorate
  if (data.governorateData.length > 0) {
    if (y > 170) { doc.addPage(); y = 20; }
    doc.setFontSize(13);
    doc.text("Sales by Governorate", 14, y);
    autoTable(doc, {
      startY: y + 4,
      head: [["Governorate", "Sales (EGP)", "Orders"]],
      body: data.governorateData.map((r) => [r.name, r.sales.toLocaleString(), r.orders]),
      styles: { fontSize: 9 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Moderator
  if (data.moderatorData.length > 0) {
    if (y > 170) { doc.addPage(); y = 20; }
    doc.setFontSize(13);
    doc.text("Moderator Performance", 14, y);
    autoTable(doc, {
      startY: y + 4,
      head: [["Moderator", "Sales (EGP)", "Orders", "Share %"]],
      body: data.moderatorData.map((r) => [r.name, r.sales.toLocaleString(), r.orders, `${r.percent}%`]),
      styles: { fontSize: 9 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Products
  if (data.productData.length > 0) {
    if (y > 170) { doc.addPage(); y = 20; }
    doc.setFontSize(13);
    doc.text("Top Products", 14, y);
    autoTable(doc, {
      startY: y + 4,
      head: [["Product", "Quantity"]],
      body: data.productData.map((r) => [r.name, r.quantity.toLocaleString()]),
      styles: { fontSize: 9 },
    });
  }

  doc.save(`sales-report-${data.periodLabel}.pdf`);
}

export function exportToExcel(data: ExportData) {
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summary = [
    ["Sales Report", data.periodLabel],
    [],
    ["Total Revenue (EGP)", data.totalSales],
    ["Total Orders", data.totalOrders],
    ["Avg Order Value (EGP)", data.avgOrderValue],
    ["Total Customers", data.totalCustomers],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

  // Monthly
  if (data.monthlySales.length > 0) {
    const ws = XLSX.utils.json_to_sheet(data.monthlySales.map((r) => ({
      Month: r.month, "Sales (EGP)": r.sales, Orders: r.orders, "MoM %": r.momPercent,
    })));
    XLSX.utils.book_append_sheet(wb, ws, "Monthly Sales");
  }

  // Governorate
  if (data.governorateData.length > 0) {
    const ws = XLSX.utils.json_to_sheet(data.governorateData.map((r) => ({
      Governorate: r.name, "Sales (EGP)": r.sales, Orders: r.orders,
    })));
    XLSX.utils.book_append_sheet(wb, ws, "Governorates");
  }

  // Sources
  if (data.sourceData.length > 0) {
    const ws = XLSX.utils.json_to_sheet(data.sourceData.map((r) => ({
      Source: r.name, "Share %": r.value, Orders: r.orders,
    })));
    XLSX.utils.book_append_sheet(wb, ws, "Sources");
  }

  // Shipping
  if (data.shippingData.length > 0) {
    const ws = XLSX.utils.json_to_sheet(data.shippingData.map((r) => ({
      Company: r.name, "Share %": r.value, Orders: r.orders,
    })));
    XLSX.utils.book_append_sheet(wb, ws, "Shipping");
  }

  // Moderators
  if (data.moderatorData.length > 0) {
    const ws = XLSX.utils.json_to_sheet(data.moderatorData.map((r) => ({
      Moderator: r.name, "Sales (EGP)": r.sales, Orders: r.orders, "Share %": r.percent,
    })));
    XLSX.utils.book_append_sheet(wb, ws, "Moderators");
  }

  // Products
  if (data.productData.length > 0) {
    const ws = XLSX.utils.json_to_sheet(data.productData.map((r) => ({
      Product: r.name, Quantity: r.quantity,
    })));
    XLSX.utils.book_append_sheet(wb, ws, "Products");
  }

  XLSX.writeFile(wb, `sales-report-${data.periodLabel}.xlsx`);
}
