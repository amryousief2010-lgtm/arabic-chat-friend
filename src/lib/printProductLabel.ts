import JsBarcode from "jsbarcode";

export interface LabelItem {
  name: string;
  barcode: string;
  unit?: string | null;
  price?: number | null;
}

/** Validates an EAN-13 checksum digit. */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  const check = (10 - (sum % 10)) % 10;
  return check === digits[12];
}

/** Returns a human-readable validation result, or null if OK. */
export function validateBarcode(code: string | null | undefined): string | null {
  if (!code) return "هذا المنتج لا يحتوي على باركود رسمي. أضف الباركود من زر التعديل أولاً.";
  const clean = code.trim();
  if (!/^\d+$/.test(clean)) return "الباركود يجب أن يحتوي على أرقام فقط.";
  if (clean.length < 8 || clean.length > 14) return "طول الباركود غير صالح (يجب أن يكون بين 8 و 14 رقمًا).";
  if (clean.length === 13 && !isValidEan13(clean)) return "رقم التحقق EAN13 غير صحيح — راجع الباركود المطبوع.";
  return null;
}

function buildBarcodeSvg(barcode: string): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const format = isValidEan13(barcode) ? "EAN13" : "CODE128";
  try {
    JsBarcode(svg, barcode, { format, width: 2, height: 70, displayValue: true, fontSize: 16, margin: 4 });
  } catch {
    JsBarcode(svg, barcode, { format: "CODE128", width: 2, height: 70, displayValue: true, margin: 4 });
  }
  return new XMLSerializer().serializeToString(svg);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Opens a print window with one or many product labels. */
export function printProductLabels(items: LabelItem[]) {
  if (!items.length) return;

  const labelsHtml = items
    .map((it) => {
      const svgStr = buildBarcodeSvg(it.barcode);
      return `
        <div class="label">
          <div class="name">${escapeHtml(it.name)}</div>
          <div class="barcode">${svgStr}</div>
          ${it.price != null ? `<div class="meta">${it.price} ج.م${it.unit ? " / " + escapeHtml(it.unit) : ""}</div>` : ""}
        </div>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>طباعة ملصقات (${items.length})</title>
<style>
  @page { size: 60mm 40mm; margin: 2mm; }
  body { font-family: -apple-system, "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; padding: 4mm; }
  .label { display: flex; flex-direction: column; align-items: center; gap: 4px; page-break-after: always; }
  .label:last-child { page-break-after: auto; }
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
    <button onclick="window.print()">طباعة ${items.length} ملصق</button>
  </div>
  ${labelsHtml}
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=480,height=600");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/** Backwards-compat: single label. */
export function printProductLabel(item: LabelItem) {
  printProductLabels([item]);
}
