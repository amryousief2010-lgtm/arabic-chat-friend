import { resolvePackWeightKg } from "./packWeight";

export type OutletQtyUnit = "pack" | "kg";

export interface ParsedOutletLine {
  row: number;
  key: string;
  qty: number;
  unit: OutletQtyUnit;
  amount: number | null;
}

export interface OutletCatalogItem {
  id: string;
  name: string;
  sku?: string | null;
  item_code?: string | null;
  barcode?: string | null;
  pack_weight_kg?: number | null;
}

export interface MatchedOutletLine {
  item_id: string;
  name: string;
  qty: number;
  unit: OutletQtyUnit;
  amount: number | null;
  quantity_kg: number;
  pack_weight_kg: number | null;
}

const ITEM_HEADERS = ["الباركود", "barcode", "sku", "كود", "item_code", "الصنف", "الاسم", "name", "item"];
const QTY_HEADERS = ["الكمية", "qty", "quantity"];
const UNIT_HEADERS = ["الوحدة", "unit"];
const AMOUNT_HEADERS = ["المبلغ", "amount", "القيمة"];

function normHeader(value: string): string {
  return value.trim().toLowerCase();
}

function headerKind(header: string): "item" | "qty" | "unit" | "amount" | null {
  const key = normHeader(header);
  if (ITEM_HEADERS.some((h) => normHeader(h) === key)) return "item";
  if (QTY_HEADERS.some((h) => normHeader(h) === key)) return "qty";
  if (UNIT_HEADERS.some((h) => normHeader(h) === key)) return "unit";
  if (AMOUNT_HEADERS.some((h) => normHeader(h) === key)) return "amount";
  return null;
}

export function parseOutletUnit(raw: string | null | undefined): OutletQtyUnit | null {
  const value = (raw || "").trim().toLowerCase();
  if (["pack", "عبوة", "عبوات"].includes(value)) return "pack";
  if (["kg", "كجم", "كيلو", "كيلوجرام"].includes(value)) return "kg";
  return null;
}

function parseQty(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const n = Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n;
}

function itemKeyFromRow(row: Record<string, unknown>, itemHeaders: string[]): string {
  for (const header of itemHeaders) {
    const value = String(row[header] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/** Turn a spreadsheet (header row already applied) into lines. Does not touch stock. */
export function parseOutletStatementRows(rows: Record<string, unknown>[]): { lines: ParsedOutletLine[]; errors: string[] } {
  const errors: string[] = [];
  const lines: ParsedOutletLine[] = [];
  if (!rows.length) {
    errors.push("الملف بلا صفوف");
    return { lines, errors };
  }
  const headers = Object.keys(rows[0] || {});
  const itemHeaders = ITEM_HEADERS
    .map((wanted) => headers.find((h) => normHeader(h) === normHeader(wanted)))
    .filter((h): h is string => Boolean(h));
  const qtyHeader = headers.find((h) => headerKind(h) === "qty");
  const unitHeader = headers.find((h) => headerKind(h) === "unit");
  const amountHeader = headers.find((h) => headerKind(h) === "amount");
  if (!itemHeaders.length) errors.push("عمود الصنف أو الباركود غير موجود");
  if (!qtyHeader) errors.push("عمود الكمية غير موجود");
  if (!unitHeader) errors.push("عمود الوحدة غير موجود");
  if (errors.length) return { lines, errors };

  rows.forEach((row, index) => {
    const rowNo = index + 2;
    const key = itemKeyFromRow(row, itemHeaders);
    const qty = parseQty(row[qtyHeader!]);
    const unitRaw = String(row[unitHeader!] ?? "").trim();
    const amountRaw = amountHeader ? row[amountHeader] : null;
    if (!key && (qty === null || qty === 0) && !unitRaw) return;
    if (!key) {
      errors.push(`صف ${rowNo}: الصنف فارغ`);
      return;
    }
    if (qty === null || qty <= 0) {
      errors.push(`صف ${rowNo}: الكمية يجب أن تكون أكبر من صفر`);
      return;
    }
    const unit = parseOutletUnit(unitRaw);
    if (!unit) {
      errors.push(`صف ${rowNo}: الوحدة يجب أن تكون عبوة أو كجم`);
      return;
    }
    let amount: number | null = null;
    if (amountRaw !== null && amountRaw !== undefined && String(amountRaw).trim() !== "") {
      amount = parseQty(amountRaw);
      if (amount === null || amount < 0) {
        errors.push(`صف ${rowNo}: المبلغ غير صالح`);
        return;
      }
    }
    lines.push({ row: rowNo, key, qty, unit, amount });
  });
  if (!lines.length && !errors.length) errors.push("لا توجد بنود صالحة");
  return { lines, errors };
}

function catalogKeys(item: OutletCatalogItem): string[] {
  return [item.barcode, item.sku, item.item_code, item.name]
    .map((v) => (v || "").trim().toLowerCase())
    .filter(Boolean);
}

export function lineQuantityKg(qty: number, unit: OutletQtyUnit, item: { name: string; pack_weight_kg?: number | null }): { kg: number; packWeight: number | null } {
  if (unit === "kg") return { kg: qty, packWeight: null };
  const packWeight = resolvePackWeightKg(item);
  return { kg: Math.round(qty * packWeight * 1000) / 1000, packWeight };
}

/** Match parsed lines to cards of one warehouse. Preview only; the server converts again on save. */
export function matchOutletLines(lines: ParsedOutletLine[], catalog: OutletCatalogItem[]): { ok: MatchedOutletLine[]; errors: string[] } {
  const errors: string[] = [];
  const ok: MatchedOutletLine[] = [];
  lines.forEach((line) => {
    const needle = line.key.trim().toLowerCase();
    const hits = catalog.filter((item) => catalogKeys(item).includes(needle));
    if (hits.length === 0) {
      errors.push(`صف ${line.row}: الصنف «${line.key}» غير موجود في مخزن المنفذ`);
      return;
    }
    if (hits.length > 1) {
      errors.push(`صف ${line.row}: «${line.key}» يطابق أكثر من بطاقة`);
      return;
    }
    const item = hits[0];
    const converted = lineQuantityKg(line.qty, line.unit, item);
    ok.push({
      item_id: item.id,
      name: item.name,
      qty: line.qty,
      unit: line.unit,
      amount: line.amount,
      quantity_kg: converted.kg,
      pack_weight_kg: converted.packWeight,
    });
  });
  return { ok, errors };
}
