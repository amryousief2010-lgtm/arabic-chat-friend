/**
 * May 2026 Rebuild Parser
 * ----------------------------------------------------------------------------
 * Strict parser for the موديراتورز Excel ("Form Responses 1" sheet).
 *
 * Rules (locked):
 *  - Each Excel row = one order.
 *  - Source of truth for items = product columns ONLY.
 *    Do NOT use "العرض" or "ملاحظات" to add or override items.
 *  - For every non-empty product column → create one order item.
 *  - Half-kg rule: for weighed products, Excel value N means N * 0.5 kg.
 *    For unit-based products (بيض, دبوس6 كيلو, فخدة/نص نعامة/نعامة صندوق)
 *    the value is the unit quantity (no multiplication).
 *  - Normalize names to existing product master records.
 *  - Phone numbers stay as text with leading zero.
 */

import type { WorkBook } from "xlsx";

export type Moderator = "أية" | "سارة" | "نورا" | "منال";
export const MAY_MODERATORS: Moderator[] = ["أية", "سارة", "نورا", "منال"];

interface ColumnDef {
  /** Excel column header (preserving any trailing spaces as in the source). */
  header: string;
  /** Canonical product name in the products master table (preserving spaces). */
  productName: string;
  /** Whether the Excel value should be multiplied by 0.5 (kg). */
  isHalfKg: boolean;
  /** If true, this column is ambiguous and rows using it need manual review. */
  ambiguous?: boolean;
}

// NOTE: trailing spaces in headers and product names are intentional —
// they match the actual Excel columns and `products.name` values in the DB.
export const PRODUCT_COLUMN_MAP: ColumnDef[] = [
  { header: "بيض", productName: "بيض ", isHalfKg: false },
  { header: " دبوس6 كيلو", productName: "دبوس بالعظم 6 كيلو", isHalfKg: false },
  {
    header: " فخدة او نص نعامة او نعامة صندوق",
    productName: "فخدة  بالعظم",
    isHalfKg: false,
    ambiguous: true,
  },
  { header: "لحم", productName: "لحم قطع", isHalfKg: true },
  { header: "استيك", productName: "استيك ", isHalfKg: true },
  { header: "موزة", productName: "موزة ", isHalfKg: true },
  { header: "فراشة", productName: "فراشة ", isHalfKg: true },
  { header: "قطعية الدبوس", productName: "قطعية الدبوس", isHalfKg: true },
  { header: "تربيانكو ", productName: "تربيانكو ", isHalfKg: true },
  { header: "اسكالوب", productName: "اسكالوب ", isHalfKg: true },
  { header: "رول", productName: "رول ", isHalfKg: true },
  { header: "كباب", productName: "قطع كباب", isHalfKg: true },
  { header: "كبدة", productName: "كبدة ", isHalfKg: true },
  { header: "قلب", productName: "قلب", isHalfKg: true },
  { header: "قوانص", productName: "قوانص ", isHalfKg: true },
  { header: "رقاب", productName: "رقاب ", isHalfKg: true },
  { header: "كوارع ", productName: "كوارع ", isHalfKg: true },
  { header: "دهن", productName: "دهن ", isHalfKg: true },
  { header: "شاورما", productName: "شاورما ", isHalfKg: true },
  { header: "شيش", productName: "شيش ", isHalfKg: true },
  { header: "كفتة", productName: "كفتة", isHalfKg: true },
  { header: "سجق", productName: "سجق ", isHalfKg: true },
  { header: "برجر", productName: "برجر ", isHalfKg: true },
  { header: "طرب", productName: "طرب ", isHalfKg: true },
  { header: "حواوشي", productName: "حواوشي ", isHalfKg: true },
  { header: "مفروم", productName: "مفروم ", isHalfKg: true },
  { header: "كفتة أرز", productName: "كفتة الرز", isHalfKg: true },
  { header: "برجر بالجبنة", productName: "برجر جبنة ", isHalfKg: true },
  { header: "ممبار", productName: "ممبار ", isHalfKg: true },
  { header: "نخاع", productName: "نخاع ", isHalfKg: true },
];

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

const normalizeDigits = (s: string): string =>
  s.replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d] ?? d);

const parseQty = (raw: unknown): number | null => {
  if (raw === null || raw === undefined) return null;
  const s = normalizeDigits(String(raw).trim());
  if (!s || s.toLowerCase() === "nan") return null;
  const m = s.match(/\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const normalizePhone = (raw: unknown): string => {
  if (raw === null || raw === undefined) return "";
  let s = normalizeDigits(String(raw).trim());
  // strip non-digits but preserve leading zero
  s = s.replace(/[^\d]/g, "");
  if (!s) return "";
  // Excel sometimes drops leading zero on Egyptian numbers (10/11/12/15-digit)
  if (s.length === 10 && /^[1]/.test(s)) s = "0" + s;
  return s;
};

const isMayTimestamp = (raw: unknown): boolean => {
  if (!raw) return false;
  const s = String(raw);
  // Match Google Forms timestamps like "2026-05-19 18:58:56.033"
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  return d.getUTCFullYear() === 2026 && d.getUTCMonth() === 4;
};

export interface ParsedItem {
  productName: string;
  quantity: number;       // final qty after half-kg rule (kg or units)
  excelRawValue: number;  // original Excel value (before half-kg rule)
  isHalfKgApplied: boolean;
  ambiguous: boolean;
  sourceColumn: string;
}

export interface ParsedRow {
  excelRow: number;            // 1-based row number in the sheet (header = row 1)
  timestamp: string;
  moderator: string;
  customerName: string;
  customerPhone: string;
  customerPhone2: string;
  address: string;
  governorate: string;
  city: string;
  source: string;
  shippingCompany: string;
  orderStatus: string;
  orderValue: number;
  offerName: string;
  notes: string;
  items: ParsedItem[];
  /** true if any item came from an ambiguous column or items list is empty */
  needsManualReview: boolean;
  reviewReason?: string;
}

const STATUS_MAP: Record<string, string> = {
  "تم التوصيل": "delivered",
  "ملغي": "cancelled",
  "قيد التوصيل": "out_for_delivery",
  "قيد التنفيذ": "processing",
  "جديد": "pending",
};

export const mapStatus = (excelStatus: string): string => {
  const s = (excelStatus || "").trim();
  return STATUS_MAP[s] ?? "out_for_delivery"; // default per project rule
};

/**
 * Parse the master sheet ("Form Responses 1") and return canonical rows
 * for May 2026 belonging to the 4 girls.
 */
export const parseMayRebuildWorkbook = async (
  workbook: WorkBook
): Promise<ParsedRow[]> => {
  const XLSX = await import("xlsx");
  const sheetName =
    workbook.SheetNames.find((n) => n.toLowerCase().includes("form responses")) ??
    workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  const out: ParsedRow[] = [];
  json.forEach((row, idx) => {
    const moderator = String(row["الموديراتور"] ?? "").trim();
    if (!MAY_MODERATORS.includes(moderator as Moderator)) return;
    if (!isMayTimestamp(row["Timestamp"])) return;

    const items: ParsedItem[] = [];
    let anyAmbiguous = false;
    for (const col of PRODUCT_COLUMN_MAP) {
      const q = parseQty(row[col.header]);
      if (q === null) continue;
      const qty = col.isHalfKg ? q * 0.5 : q;
      items.push({
        productName: col.productName,
        quantity: qty,
        excelRawValue: q,
        isHalfKgApplied: col.isHalfKg,
        ambiguous: !!col.ambiguous,
        sourceColumn: col.header.trim(),
      });
      if (col.ambiguous) anyAmbiguous = true;
    }

    const orderValueRaw = parseQty(row["قيمة الاوردر بدون شحن"]) ?? 0;

    let reviewReason: string | undefined;
    if (items.length === 0) reviewReason = "لا توجد أعمدة منتجات معبأة في هذا الصف";
    else if (anyAmbiguous) reviewReason = "صف يحتوي على عمود (فخدة/نص نعامة/نعامة صندوق) — راجع المنتج يدوياً";

    out.push({
      excelRow: idx + 2, // header is row 1, data starts at row 2
      timestamp: String(row["Timestamp"] ?? ""),
      moderator,
      customerName: String(row["اسم العميل"] ?? "").trim(),
      customerPhone: normalizePhone(row["رقم العميل"]),
      customerPhone2: normalizePhone(row["رقم اخر للعميل ان وجد"]),
      address: String(row["العنوان بالتفصيل"] ?? "").trim(),
      governorate: String(row["المحافظة"] ?? "").trim(),
      city: String(row["المدينة أو المركز"] ?? "").trim(),
      source: String(row["مصدر العميل"] ?? "").trim(),
      shippingCompany: String(row["شركة الشحن"] ?? "").trim(),
      orderStatus: String(row["حالة الاوردر"] ?? "").trim(),
      orderValue: orderValueRaw,
      offerName: String(row["العرض"] ?? "").trim(),
      notes: String(row["ملاحظات"] ?? "").trim(),
      items,
      needsManualReview: items.length === 0 || anyAmbiguous,
      reviewReason,
    });
  });

  return out;
};

/** Validate that DB items exactly match the canonical Excel items. */
export const validateMatch = (
  expected: ParsedItem[],
  actual: { product_name: string; quantity: number }[]
): { ok: boolean; reason?: string } => {
  if (expected.length !== actual.length) {
    return { ok: false, reason: `عدد المنتجات مختلف: متوقع ${expected.length}، فعلي ${actual.length}` };
  }
  const norm = (s: string) => s.trim();
  const expSorted = [...expected].sort((a, b) => norm(a.productName).localeCompare(norm(b.productName)));
  const actSorted = [...actual].sort((a, b) => norm(a.product_name).localeCompare(norm(b.product_name)));
  for (let i = 0; i < expSorted.length; i++) {
    const e = expSorted[i];
    const a = actSorted[i];
    if (norm(e.productName) !== norm(a.product_name)) {
      return { ok: false, reason: `اسم المنتج مختلف: متوقع "${e.productName.trim()}" — فعلي "${a.product_name.trim()}"` };
    }
    if (Math.abs(Number(e.quantity) - Number(a.quantity)) > 0.001) {
      return { ok: false, reason: `كمية ${e.productName.trim()} مختلفة: متوقع ${e.quantity} — فعلي ${a.quantity}` };
    }
  }
  return { ok: true };
};
