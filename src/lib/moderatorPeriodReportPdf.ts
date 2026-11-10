import { escapeHtml, fmtNum, openPrintWindow } from "@/lib/printPdf";
import {
  BRAND_ORANGE,
  BRAND_PURPLE,
  type MetricDef,
  type ModeratorPeriodReport,
  type ModeratorPeriodRow,
  bestSlugs,
  cairoTimestampLabel,
  formatReportPeriod,
  totalKg,
  visibleMetrics,
} from "@/lib/moderatorPeriodReport";

const fmt = (v: number | null | undefined, digits = 0) => (v == null ? "—" : fmtNum(v, digits));
const kgText = (row: ModeratorPeriodRow, which: "kgRequested" | "kgDelivered") => {
  const k = row[which];
  return `لحوم ${fmt(k.meat, 2)} · عظم ${fmt(k.bone, 2)} · مصنعات ${fmt(k.processed, 2)} · هدايا ${fmt(k.gifts, 2)} · الإجمالي ${fmt(totalKg(k), 2)}`;
};

function cell(row: ModeratorPeriodRow, metric: MetricDef, best: string[]): string {
  const value = metric.value(row);
  const digits = metric.id === "value" || metric.id === "aov" || metric.id.startsWith("kg") ? 2
    : metric.id.endsWith("Reply") || metric.id === "conversion" || metric.id === "answerRate" ? 1 : 0;
  const mark = best.includes(row.slug) ? " best" : "";
  return `<td class="num${mark}">${fmt(value, digits)}${mark ? " الأفضل" : ""}</td>`;
}

function bars(report: ModeratorPeriodReport, metric: MetricDef): string {
  const values = report.moderators.map((row) => metric.value(row) ?? 0);
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);
  const best = bestSlugs(report.moderators, metric);
  return `<section class="chart"><h3>${escapeHtml(metric.label)}${metric.lowerIsBetter ? " — الأقل أفضل" : ""}</h3>${report.moderators.map((row, i) => {
    const v = values[i];
    const w = Math.max(0, Math.min(100, (Math.abs(v) / max) * 100));
    const color = best.includes(row.slug) ? BRAND_ORANGE : BRAND_PURPLE;
    return `<div class="bar-row"><div class="bar-label">${escapeHtml(row.name)}</div><div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div><div class="bar-val">${fmt(metric.value(row), metric.id === "value" || metric.id === "aov" ? 0 : 1)}</div></div>`;
  }).join("")}</section>`;
}

export function moderatorPeriodReportHtml(report: ModeratorPeriodReport, generatedAt = new Date(), logoUrl = "/coc-logo.png"): string {
  const metrics = visibleMetrics(report);
  const period = formatReportPeriod(report);
  const head = report.moderators.map((row) => `<th>${escapeHtml(row.name)}</th>`).join("");
  const metricRows = metrics.map((metric) => {
    const best = bestSlugs(report.moderators, metric);
    return `<tr><th>${escapeHtml(metric.label)}</th>${report.moderators.map((row) => cell(row, metric, best)).join("")}</tr>`;
  }).join("");
  const kgRows = report.moderators.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(kgText(row, "kgRequested"))}</td><td>${escapeHtml(kgText(row, "kgDelivered"))}</td></tr>`).join("");
  const callRows = report.conversationsVisible
    ? report.moderators.map((row) => {
        const c = row.calls;
        return `<tr><td>${escapeHtml(row.name)}</td><td class="num">${fmt(c?.answered)}</td><td class="num">${fmt(c?.missed)}</td><td class="num">${fmt(c?.under1Min)}</td><td class="num">${fmt(c?.from1To5Min)}</td><td class="num">${fmt(c?.over5Min)}</td><td class="num">${fmt(c?.matchedOrder)}</td><td class="num">${fmt(c?.answerRate, 1)}</td></tr>`;
      }).join("")
    : "";
  const days = [...new Set(report.daily.map((d) => d.day))].sort();
  const dailyRows = days.map((day) => {
    const cells = report.moderators.map((row) => {
      const point = report.daily.find((d) => d.day === day && d.slug === row.slug);
      const conv = report.conversationsVisible ? fmt(point?.conversations) : "";
      return `<td class="num">${report.conversationsVisible ? `${conv} / ` : ""}${fmt(point?.orders)}</td>`;
    }).join("");
    return `<tr><td><bdi dir="ltr">${escapeHtml(day.split("-").reverse().join("/"))}</bdi></td>${cells}</tr>`;
  }).join("");
  const hourRows = report.conversationsVisible
    ? Array.from({ length: 24 }, (_, hour) => {
        const cells = report.moderators.map((row) => {
          const n = report.lateByHour.find((x) => x.hour === hour && x.slug === row.slug)?.late ?? 0;
          return `<td class="num">${n || "·"}</td>`;
        }).join("");
        const any = report.lateByHour.some((x) => x.hour === hour && x.late > 0);
        return any ? `<tr><td><bdi dir="ltr">${String(hour).padStart(2, "0")}:00</bdi></td>${cells}</tr>` : "";
      }).join("")
    : "";
  const adNames = [...new Set(report.ads.map((a) => a.adName))];
  const adRows = adNames.map((name) => {
    const cells = report.moderators.map((row) => `<td class="num">${fmt(report.ads.find((a) => a.adName === name && a.slug === row.slug)?.conversations)}</td>`).join("");
    return `<tr><td>${escapeHtml(name)}</td>${cells}</tr>`;
  }).join("");
  const chartBlock = metrics.map((metric) => bars(report, metric)).join("");
  const hiddenNote = report.conversationsVisible
    ? "مؤشرات المحادثة بنفس تعريف لوحة البنات: في الوقت، تغطية (ردّت غير المسندة)، متأخر، وبدون رد (ما زال معلّقاً). بانتظار العميل = آخر رسالة منّا. أوقات أول الرد بالدقائق من بدء العدّ. التحويل = الطلبات المسجّلة ÷ المحادثات التي بدأت في الفترة. مكالمة طابقت طلباً = طلب غير ملغى لنفس العميل خلال يوم قبل المكالمة وسبعة أيام بعدها، بلا إظهار أي رقم."
    : "مؤشرات المحادثات والرسائل والخط الساخن والإعلانات مخفية لهذا الدور. تظهر للمدير العام ومديرة المبيعات والمدير التنفيذي عندما تسمح بوابة المحادثات.";

  return `<header>
    <img class="logo" src="${escapeHtml(logoUrl)}" alt="COC" />
    <div>
      <h1>تقرير أداء الموديراتور</h1>
      <div class="period">الفترة: <bdi dir="ltr">${escapeHtml(period)}</bdi></div>
    </div>
    <div class="meta">أُنشئ ${escapeHtml(cairoTimestampLabel(generatedAt))}<br/>توقيت القاهرة</div>
  </header>
  <p class="note">${hiddenNote} الكيلو للفترة الحالية فقط: اللحم بالعظم منفصل عن اللحوم، الهدايا داخل الإجمالي، والرقاب خارج العدّاد. البنات: ${report.moderators.map((r) => escapeHtml(r.name)).join("، ") || "—"}.</p>
  <h2>مقارنة جنبًا إلى جنب</h2>
  <p class="note">الخلية المميزة هي الأفضل. في المتأخر وبدون رد وانتظار العميل ومدة أول الرد وغير المحصّل، الأقل هو الأفضل.</p>
  <table><thead><tr><th>المؤشر</th>${head}</tr></thead><tbody>${metricRows}</tbody></table>
  <h2>الكيلو المطلوب والمسلّم</h2>
  <table><thead><tr><th>البنت</th><th>مطلوب</th><th>مسلّم</th></tr></thead><tbody>${kgRows}</tbody></table>
  ${report.conversationsVisible ? `<h2>الخط الساخن</h2><table><thead><tr><th>البنت</th><th>مُجابة</th><th>فائتة</th><th>أقل من دقيقة</th><th>1–5 دقائق</th><th>أكثر من 5</th><th>طابقت طلباً</th><th>نسبة الرد %</th></tr></thead><tbody>${callRows}</tbody></table>` : ""}
  <h2>الاتجاه اليومي ${report.conversationsVisible ? "(محادثات / طلبات)" : "(طلبات)"}</h2>
  <table><thead><tr><th>اليوم</th>${head}</tr></thead><tbody>${dailyRows || `<tr><td colspan="${report.moderators.length + 1}">لا حركة في الفترة</td></tr>`}</tbody></table>
  ${report.conversationsVisible ? `<h2>الردود المتأخرة حسب ساعة اليوم</h2><table><thead><tr><th>الساعة</th>${head}</tr></thead><tbody>${hourRows || `<tr><td colspan="${report.moderators.length + 1}">لا ردود متأخرة</td></tr>`}</tbody></table>` : ""}
  ${report.conversationsVisible ? `<h2>المحادثات حسب الإعلان</h2><table><thead><tr><th>الإعلان</th>${head}</tr></thead><tbody>${adRows || `<tr><td colspan="${report.moderators.length + 1}">لا إسناد إعلاني في الفترة</td></tr>`}</tbody></table>` : ""}
  <h2>الرسوم</h2>
  ${chartBlock}
  <p class="src">لا تُطبع أرقام العملاء.</p>`;
}

export const PERIOD_REPORT_CSS = `
  @page { size: A4; margin: 16mm 13mm 18mm;
    @bottom-center { content: "صفحة " counter(page) " من " counter(pages); font-size: 10px; color: ${BRAND_PURPLE}; } }
  @font-face { font-family: "Noto Naskh Arabic"; src: url("file:///usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf"); font-weight: 400; }
  @font-face { font-family: "Noto Naskh Arabic"; src: url("file:///usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf"); font-weight: 700; }
  body { font-family: "Cairo","Noto Naskh Arabic","Noto Kufi Arabic","Segoe UI",Tahoma,sans-serif; color: #1c1024; font-size: 13px; }
  header { display: flex; align-items: center; gap: 21px; border-bottom: 3px solid ${BRAND_PURPLE}; padding-bottom: 13px; margin-bottom: 21px; }
  header h1 { margin: 0; color: ${BRAND_PURPLE}; font-size: 34px; line-height: 1.15; }
  .logo { width: 55px; height: 55px; object-fit: contain; }
  .period { color: ${BRAND_ORANGE}; font-size: 21px; margin-top: 8px; }
  .meta { margin-right: auto; text-align: left; font-size: 10px; color: #5c4a63; }
  h2 { color: ${BRAND_PURPLE}; font-size: 21px; margin: 34px 0 13px; border-bottom: 1px solid ${BRAND_ORANGE}; padding-bottom: 8px; }
  h3 { color: ${BRAND_PURPLE}; font-size: 13px; margin: 0 0 8px; }
  .note, .src { font-size: 10px; color: #5c4a63; margin: 8px 0 13px; }
  table th { background: ${BRAND_PURPLE}; }
  td.best { background: #fff1eb; color: ${BRAND_PURPLE}; font-weight: 700; box-shadow: inset 0 0 0 2px ${BRAND_ORANGE}; }
  td.num, .bar-val, bdi { direction: ltr; unicode-bidi: isolate; }
  .chart { margin: 0 0 21px; break-inside: avoid; }
  .bar-row { display: grid; grid-template-columns: 88px 1fr 72px; gap: 8px; align-items: center; margin-bottom: 8px; font-size: 10px; }
  .bar-track { background: #f6eef4; height: 13px; border-radius: 8px; overflow: hidden; }
  .bar-fill { height: 100%; }
  .bar-val { font-weight: 700; color: ${BRAND_PURPLE}; }
  footer .pn::after { content: counter(page); }
`;

export function exportModeratorPeriodPdf(report: ModeratorPeriodReport, generatedAt = new Date()): boolean {
  const title = `تقرير أداء الموديراتور — ${formatReportPeriod(report)}`;
  const logo = typeof window !== "undefined" ? new URL("/coc-logo.png", window.location.origin).href : "/coc-logo.png";
  return openPrintWindow(title, moderatorPeriodReportHtml(report, generatedAt, logo), PERIOD_REPORT_CSS);
}
