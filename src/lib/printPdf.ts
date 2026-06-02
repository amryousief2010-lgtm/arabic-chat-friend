/**
 * Shared helper for opening an Arabic-friendly print window that the user can
 * save as PDF. This bypasses jsPDF's poor Unicode/RTL support entirely — the
 * browser renders the content with full Arabic shaping and ligatures.
 */

export const PRINT_BASE_CSS = `
  @page { size: A4; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Cairo","Tajawal","Noto Naskh Arabic","Segoe UI",Tahoma,sans-serif;
         font-size: 12px; color: #111; margin: 0; direction: rtl; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #6b46c1; padding-bottom: 8px; margin-bottom: 12px; }
  header h1 { margin: 0; font-size: 20px; color: #6b46c1; }
  header .en { font-size: 10px; color: #777; }
  header .meta { text-align: left; font-size: 10px; color: #444; }
  h2 { margin: 14px 0 6px; font-size: 15px; color: #6b46c1;
       border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
           margin-bottom: 12px; }
  .stat { border: 1px solid #e0e0e0; border-radius: 6px; padding: 8px;
          background: #fafafa; }
  .stat .k { font-size: 10px; color: #666; }
  .stat .v { font-size: 14px; font-weight: bold; color: #111; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px; }
  table th { background: #6b46c1; color: #fff; padding: 5px 6px; text-align: right;
             font-weight: bold; }
  table td { border: 1px solid #e0e0e0; padding: 4px 6px; text-align: right; }
  table tbody tr:nth-child(even) { background: #f9f7ff; }
  .num { font-variant-numeric: tabular-nums; }
  footer { position: fixed; bottom: 6mm; left: 0; right: 0;
           text-align: center; font-size: 9px; color: #888; }
  @media print { .no-print { display: none; } }
  .no-print { padding: 8px; background: #f5edff; text-align: center; }
  .no-print button { font-size: 14px; padding: 6px 16px; cursor: pointer;
                     margin: 0 4px; }
`;

export const COMPANY_AR = "شركة نعم العاصمة";
export const COMPANY_EN = "Na'am Al-Asimah — Capital Ostrich";

export const escapeHtml = (v: any) =>
  String(v ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const fmtNum = (v: any, d = 0) => {
  if (v == null || v === "" || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("ar-EG-u-nu-latn", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
};

export const fmtDate = (v: any) =>
  v ? new Date(v).toLocaleString("ar-EG-u-nu-latn") : "—";

/**
 * Open a print window with a full HTML document. The window auto-triggers the
 * print dialog so the user can save as PDF.
 */
export function openPrintWindow(title: string, bodyHtml: string, extraCss = "") {
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${PRINT_BASE_CSS}${extraCss}</style>
</head>
<body>
<div class="no-print">
  <button onclick="window.print()">طباعة / حفظ كـ PDF</button>
  <button onclick="window.close()">إغلاق</button>
</div>
${bodyHtml}
<footer>${COMPANY_AR} • ${COMPANY_EN}</footer>
<script>
  window.addEventListener("load", function () {
    setTimeout(function () { try { window.print(); } catch (e) {} }, 400);
  });
</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=1000,height=1200");
  if (!w) {
    alert("الرجاء السماح بفتح النوافذ المنبثقة لطباعة التقرير.");
    return false;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
