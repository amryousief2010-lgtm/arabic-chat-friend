import { openPrintWindow, escapeHtml, fmtNum, fmtDate, COMPANY_AR } from "@/lib/printPdf";

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

const COLORS = ["#3b82f6", "#8b5cf6", "#22c55e", "#fb923c", "#ec4899", "#ef4444", "#eab308"];

export function exportModeratorPDF(data: ExportModeratorData) {
  const maxSales = Math.max(...data.moderators.map((m) => m.sales), 1);

  const summaryTable = `
    <h2>المقارنة الإجمالية</h2>
    <table>
      <thead><tr>
        <th>الموديراتور</th>
        <th>المبيعات (ج.م)</th>
        <th>الطلبات</th>
        <th>متوسط الطلب (ج.م)</th>
        <th>النسبة %</th>
      </tr></thead>
      <tbody>
        ${data.moderators
          .map(
            (m) => `<tr>
              <td>${escapeHtml(m.name)}</td>
              <td class="num">${fmtNum(m.sales)}</td>
              <td class="num">${fmtNum(m.orders)}</td>
              <td class="num">${fmtNum(m.orders > 0 ? Math.round(m.sales / m.orders) : 0)}</td>
              <td class="num">${m.percent}%</td>
            </tr>`,
          )
          .join("")}
      </tbody>
    </table>`;

  const bars = `
    <h2>توزيع المبيعات</h2>
    <div class="bars">
      ${data.moderators
        .map((m, i) => {
          const w = (m.sales / maxSales) * 100;
          const color = COLORS[i % COLORS.length];
          return `<div class="bar-row">
            <div class="bar-label">${escapeHtml(m.name)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color};"></div></div>
            <div class="bar-val">${(m.sales / 1_000_000).toFixed(2)}M</div>
          </div>`;
        })
        .join("")}
    </div>`;

  const monthlySections = data.moderators
    .map((mod) => {
      const monthly = data.monthlyData[mod.name];
      if (!monthly || monthly.length === 0) return "";
      const maxMonth = Math.max(...monthly.map((r) => r.sales), 1);
      const color = COLORS[data.moderators.indexOf(mod) % COLORS.length];
      return `
        <div class="page-break"></div>
        <h2 style="color:${color};">${escapeHtml(mod.name)} — التفصيل الشهري</h2>
        <div class="stats">
          <div class="stat"><div class="k">إجمالي المبيعات</div><div class="v">${fmtNum(mod.sales)} ج.م</div></div>
          <div class="stat"><div class="k">إجمالي الطلبات</div><div class="v">${fmtNum(mod.orders)}</div></div>
          <div class="stat"><div class="k">متوسط الطلب</div><div class="v">${fmtNum(mod.orders > 0 ? Math.round(mod.sales / mod.orders) : 0)} ج.م</div></div>
          <div class="stat"><div class="k">النسبة من الإجمالي</div><div class="v">${mod.percent}%</div></div>
        </div>
        <table>
          <thead><tr>
            <th>الشهر</th>
            <th>المبيعات (ج.م)</th>
            <th>الطلبات</th>
            <th>متوسط الطلب</th>
          </tr></thead>
          <tbody>
            ${monthly
              .map(
                (r) => `<tr>
                  <td>${escapeHtml(r.month)}</td>
                  <td class="num">${fmtNum(r.sales)}</td>
                  <td class="num">${fmtNum(r.orders)}</td>
                  <td class="num">${fmtNum(r.orders > 0 ? Math.round(r.sales / r.orders) : 0)}</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>
        <div class="bars">
          ${monthly
            .map((r) => {
              const w = (r.sales / maxMonth) * 100;
              return `<div class="bar-row">
                <div class="bar-label">${escapeHtml(r.month)}</div>
                <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color};"></div></div>
                <div class="bar-val">${(r.sales / 1000).toFixed(0)}K</div>
              </div>`;
            })
            .join("")}
        </div>`;
    })
    .join("");

  const body = `
    <header>
      <div>
        <h1>${COMPANY_AR}</h1>
        <div class="en">تقرير أداء الموديراتور — 2025</div>
      </div>
      <div class="meta">
        <div>تاريخ الإصدار: ${fmtDate(new Date())}</div>
      </div>
    </header>

    <div class="stats">
      <div class="stat"><div class="k">إجمالي المبيعات</div><div class="v">${fmtNum(data.totalSales)} ج.م</div></div>
      <div class="stat"><div class="k">إجمالي الطلبات</div><div class="v">${fmtNum(data.totalOrders)}</div></div>
      <div class="stat"><div class="k">عدد الموديراتور</div><div class="v">${data.moderators.length}</div></div>
      <div class="stat"><div class="k">متوسط مبيعات الموديراتور</div><div class="v">${fmtNum(data.moderators.length > 0 ? Math.round(data.totalSales / data.moderators.length) : 0)} ج.م</div></div>
    </div>

    ${summaryTable}
    ${bars}
    ${monthlySections}
  `;

  const extraCss = `
    .bars { margin: 8px 0 14px; }
    .bar-row { display: grid; grid-template-columns: 140px 1fr 80px; gap: 8px;
               align-items: center; margin-bottom: 4px; font-size: 10px; }
    .bar-label { text-align: right; }
    .bar-track { background: #f0f0f0; height: 14px; border-radius: 3px; overflow: hidden; }
    .bar-fill { height: 100%; }
    .bar-val { text-align: left; font-weight: bold; }
    .page-break { page-break-before: always; }
  `;

  openPrintWindow("تقرير أداء الموديراتور — 2025", body, extraCss);
}
