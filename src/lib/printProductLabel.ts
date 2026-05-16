import JsBarcode from "jsbarcode";

/**
 * Opens a print window with a label containing the product name + official barcode.
 */
export function printProductLabel(opts: {
  name: string;
  barcode: string;
  unit?: string | null;
  price?: number | null;
}) {
  const { name, barcode, unit, price } = opts;

  // Render barcode to SVG string
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  try {
    JsBarcode(svg, barcode, {
      format: barcode.length === 13 ? "EAN13" : "CODE128",
      width: 2,
      height: 70,
      displayValue: true,
      fontSize: 16,
      margin: 4,
    });
  } catch {
    JsBarcode(svg, barcode, { format: "CODE128", width: 2, height: 70, displayValue: true, margin: 4 });
  }
  const svgStr = new XMLSerializer().serializeToString(svg);

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>ملصق ${name}</title>
<style>
  @page { size: 60mm 40mm; margin: 2mm; }
  body { font-family: -apple-system, "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; padding: 4mm; }
  .label { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .name { font-size: 14px; font-weight: 700; text-align: center; }
  .meta { font-size: 11px; color: #555; }
  .barcode svg { width: 100%; height: auto; }
  @media print { .no-print { display: none; } }
  .toolbar { text-align: center; margin-bottom: 8px; }
  .toolbar button { padding: 6px 14px; font-size: 13px; cursor: pointer; }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button onclick="window.print()">طباعة</button>
  </div>
  <div class="label">
    <div class="name">${escapeHtml(name)}</div>
    <div class="barcode">${svgStr}</div>
    ${price != null ? `<div class="meta">${price} ج.م${unit ? " / " + escapeHtml(unit) : ""}</div>` : ""}
  </div>
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 200));</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=420,height=320");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
