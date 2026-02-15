import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface ModeratorSummary {
  name: string;
  sales: number;
  orders: number;
  percent: number;
}

interface ModeratorMonthly {
  month: string;
  sales: number;
  orders: number;
}

interface ExportModeratorData {
  moderators: ModeratorSummary[];
  monthlyData: Record<string, ModeratorMonthly[]>;
  totalSales: number;
  totalOrders: number;
}

export function exportModeratorPDF(data: ExportModeratorData) {
  const doc = new jsPDF({ orientation: "landscape" });

  // Title
  doc.setFontSize(20);
  doc.text("Moderator Performance Report - 2025", 14, 20);

  // Summary
  doc.setFontSize(11);
  doc.text(`Total Sales: ${data.totalSales.toLocaleString()} EGP`, 14, 32);
  doc.text(`Total Orders: ${data.totalOrders.toLocaleString()}`, 14, 39);
  doc.text(`Moderators: ${data.moderators.length}`, 14, 46);

  // Overall comparison table
  doc.setFontSize(14);
  doc.text("Performance Comparison", 14, 58);
  autoTable(doc, {
    startY: 62,
    head: [["Moderator", "Sales (EGP)", "Orders", "Avg Order (EGP)", "Share %"]],
    body: data.moderators.map((m) => [
      m.name,
      m.sales.toLocaleString(),
      m.orders.toLocaleString(),
      Math.round(m.sales / m.orders).toLocaleString(),
      `${m.percent}%`,
    ]),
    styles: { fontSize: 10 },
    headStyles: { fillColor: [59, 130, 246] },
  });

  // Simple bar chart simulation using colored rectangles
  let y = (doc as any).lastAutoTable.finalY + 15;
  if (y > 160) { doc.addPage(); y = 20; }

  doc.setFontSize(14);
  doc.text("Sales Distribution (Visual)", 14, y);
  y += 8;

  const maxSales = Math.max(...data.moderators.map((m) => m.sales));
  const barMaxWidth = 180;
  const barHeight = 10;
  const colors: [number, number, number][] = [
    [59, 130, 246], [139, 92, 246], [34, 197, 94],
    [251, 146, 60], [236, 72, 153], [239, 68, 68], [234, 179, 8],
  ];

  data.moderators.forEach((m, i) => {
    const barWidth = (m.sales / maxSales) * barMaxWidth;
    const color = colors[i % colors.length];
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(60, y, barWidth, barHeight, "F");
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(m.name, 14, y + 7);
    doc.text(`${(m.sales / 1000000).toFixed(1)}M`, 60 + barWidth + 3, y + 7);
    y += barHeight + 4;
  });

  doc.setTextColor(0, 0, 0);

  // Per-moderator monthly breakdown
  for (const mod of data.moderators) {
    const monthly = data.monthlyData[mod.name];
    if (!monthly || monthly.length === 0) continue;

    doc.addPage();
    doc.setFontSize(16);
    doc.text(`${mod.name} - Monthly Breakdown`, 14, 20);

    doc.setFontSize(11);
    doc.text(`Total Sales: ${mod.sales.toLocaleString()} EGP`, 14, 30);
    doc.text(`Total Orders: ${mod.orders.toLocaleString()}`, 14, 37);
    doc.text(`Avg Order: ${Math.round(mod.sales / mod.orders).toLocaleString()} EGP`, 14, 44);
    doc.text(`Share: ${mod.percent}%`, 14, 51);

    // Monthly table
    autoTable(doc, {
      startY: 58,
      head: [["Month", "Sales (EGP)", "Orders", "Avg Order (EGP)"]],
      body: monthly.map((r) => [
        r.month,
        r.sales.toLocaleString(),
        r.orders.toLocaleString(),
        Math.round(r.sales / r.orders).toLocaleString(),
      ]),
      styles: { fontSize: 10 },
      headStyles: { fillColor: colors[data.moderators.indexOf(mod) % colors.length] },
    });

    // Monthly bar chart
    let chartY = (doc as any).lastAutoTable.finalY + 12;
    if (chartY > 155) { doc.addPage(); chartY = 20; }

    doc.setFontSize(13);
    doc.text("Monthly Sales Chart", 14, chartY);
    chartY += 8;

    const maxMonthSales = Math.max(...monthly.map((r) => r.sales));
    const color = colors[data.moderators.indexOf(mod) % colors.length];

    monthly.forEach((r) => {
      const bw = (r.sales / maxMonthSales) * barMaxWidth;
      doc.setFillColor(color[0], color[1], color[2]);
      doc.rect(50, chartY, bw, 8, "F");
      doc.setFontSize(8);
      doc.setTextColor(60, 60, 60);
      doc.text(r.month, 14, chartY + 6);
      doc.text(`${(r.sales / 1000).toFixed(0)}K`, 50 + bw + 2, chartY + 6);
      chartY += 11;
    });

    doc.setTextColor(0, 0, 0);
  }

  doc.save("moderator-performance-2025.pdf");
}
