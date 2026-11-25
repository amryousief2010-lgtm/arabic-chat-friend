/**
 * وزن عبوة منتج الموقع بوحدة COCEG (site_pack_qty على woo_product_map).
 * مثال: لانشون على الموقع عبوة 500 جم، وفي COCEG بالكيلو → 0.5.
 *   سعر الموقع = سعر COCEG × 0.5، وكمية الطلب في COCEG = عدد العبوات × 0.5.
 * الاقتراح من اسم منتج الموقع فقط، ولا يُعتمد إلا بتأكيد صريح.
 */

export const PACK_QTY_MIN = 0.001;
export const PACK_QTY_MAX = 100;

const numFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const moneyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const egp = (v: number) => `${moneyFmt.format(v)} ج.م`;
/** «COCEG» معزول اتجاهياً حتى لا يلتصق بالرقم بعده في سطر عربي. */
export const COCEG_ISOLATED = "\u2066COCEG\u2069";

/** أرقام عربية/فارسية → لاتينية، والفاصلة العشرية العربية → نقطة. */
export function normalizeDigits(s: string): string {
  return String(s ?? "")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u066B]/g, ".")
    .replace(/(\d)[,٬](\d{3})(?!\d)/g, "$1$2");
}

export const roundQty = (n: number) => Math.round(n * 1000) / 1000;
export const roundMoney = (n: number) => Math.round(n * 100) / 100;

/** يستخرج وزن العبوة بالكيلو من نص (اسم منتج الموقع أو COCEG). */
export function parseWeightKg(text: string | null | undefined): number | null {
  const s = normalizeDigits(String(text ?? "")).toLowerCase();
  if (!s.trim()) return null;
  if (/(?:نصف|نص|½)\s*(?:ال)?(?:كيلو|كجم|كغ|كيلوجرام)/.test(s)) return 0.5;
  if (/(?:ربع)\s*(?:ال)?(?:كيلو|كجم|كغ|كيلوجرام)/.test(s)) return 0.25;
  if (/(?:ثلاثة|تلات)\s*أرباع\s*(?:ال)?(?:كيلو|كجم)/.test(s)) return 0.75;
  const g = s.match(/(\d+(?:\.\d+)?)\s*(?:جم|جرام|جرامات|غرام|غم|gm|gr|g)(?![a-z\u0600-\u06FF])/);
  if (g) {
    const v = Number(g[1]) / 1000;
    return v > 0 ? roundQty(v) : null;
  }
  const kg = s.match(/(\d+(?:\.\d+)?)\s*(?:كيلو(?:جرام)?|كجم|كغ|kg|كيلوغرام)/);
  if (kg) {
    const v = Number(kg[1]);
    return v > 0 ? roundQty(v) : null;
  }
  return null;
}

export const isKgUnit = (unit: string | null | undefined) =>
  /^(?:كجم|كيلو|كيلوجرام|كغ|kg)$/i.test(String(unit ?? "").trim());

export interface PackSuggestion {
  qty: number;
  label: string;
  siteKg: number;
  cocKg: number;
}

/** وزن عبوة يُقترح من اسم منتج الموقع (للمنتجات المسعّرة بالكيلو في COCEG فقط). */
export function suggestPackQty(
  siteName: string | null | undefined,
  coc: { name?: string | null; unit?: string | null } | null | undefined,
): PackSuggestion | null {
  if (!coc || !isKgUnit(coc.unit ?? "كجم")) return null;
  const siteKg = parseWeightKg(siteName);
  if (siteKg === null) return null;
  const cocKg = parseWeightKg(coc.name) ?? 1;
  const qty = roundQty(siteKg / cocKg);
  if (!(qty >= PACK_QTY_MIN && qty <= PACK_QTY_MAX)) return null;
  return { qty, label: weightLabel(siteKg), siteKg, cocKg };
}

/** «500 جم» أو «1 كجم» أو «1.5 كجم». */
export function weightLabel(kg: number): string {
  if (kg < 1) return `${numFmt.format(Math.round(kg * 1000))} جم`;
  return `${numFmt.format(roundQty(kg))} كجم`;
}

/** اسم الوحدة بصيغة «سعر الكيلو / سعر القطعة …». */
export function unitWord(unit: string | null | undefined): string {
  const u = String(unit ?? "").trim();
  if (!u || isKgUnit(u)) return "الكيلو";
  if (u === "قطعة") return "القطعة";
  if (u === "عبوة") return "العبوة";
  return "الوحدة";
}

/** رمز الوحدة بعد الرقم: «0.5 كجم» أو «2 قطعة». */
export function unitSymbol(unit: string | null | undefined): string {
  const u = String(unit ?? "").trim();
  if (!u || isKgUnit(u)) return "كجم";
  return u;
}

export function formatPackQty(qty: number, unit?: string | null): string {
  return `${numFmt.format(roundQty(qty))} ${unitSymbol(unit)}`;
}

export function validPackQty(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(normalizeDigits(String(v ?? "")).trim());
  if (!Number.isFinite(n)) return null;
  const r = roundQty(n);
  return r >= PACK_QTY_MIN && r <= PACK_QTY_MAX ? r : null;
}

export const packFactorOf = (m: { kind?: string | null; site_pack_qty?: number | string | null } | null | undefined): number => {
  if (!m || m.kind === "offer_box") return 1;
  return validPackQty(m.site_pack_qty ?? 1) ?? 1;
};

/** سعر العبوة على الموقع = سعر COCEG × وزن العبوة. */
export function sitePackPrice(cocPrice: number | null | undefined, qty: number): number | null {
  if (cocPrice === null || cocPrice === undefined || !Number.isFinite(Number(cocPrice))) return null;
  return roundMoney(Number(cocPrice) * qty);
}

/** «سعر الكيلو في COCEG 350 ج.م × 0.5 كجم = 175 ج.م للعبوة (500 جم)». */
export function packPriceExplanation(
  cocPrice: number | null | undefined,
  qty: number,
  unit?: string | null,
  label?: string | null,
): string | null {
  const p = sitePackPrice(cocPrice, qty);
  if (p === null) return null;
  const lbl = label?.trim() ? ` (${label.trim()})` : "";
  return `سعر ${unitWord(unit)} في ${COCEG_ISOLATED} ${egp(Number(cocPrice))} × ${formatPackQty(qty, unit)} = ${egp(p)} للعبوة${lbl}`;
}

/** سعر COCEG المقابل لسعر عبوة الموقع (سحب السعر من الموقع). */
export function cocPriceFromSite(sitePrice: number | null | undefined, qty: number): number | null {
  if (sitePrice === null || sitePrice === undefined || !Number.isFinite(Number(sitePrice)) || !(qty > 0)) return null;
  return roundMoney(Number(sitePrice) / qty);
}

/** كمية COCEG = عدد عبوات الموقع × وزن العبوة. */
export const cocQtyFromSite = (siteQty: number, qty: number) => roundQty(Number(siteQty) * qty);

/** «2 عبوة × 0.5 كجم = 1 كجم». */
export function packQtyLine(siteQty: number, qty: number, unit?: string | null): string {
  return `${numFmt.format(Number(siteQty))} عبوة × ${formatPackQty(qty, unit)} = ${formatPackQty(cocQtyFromSite(siteQty, qty), unit)}`;
}

export interface PackState {
  qty: number;
  label: string | null;
  confirmed: boolean;
  suggestion: PackSuggestion | null;
  /** الاقتراح يختلف عن القيمة الحالية، والقيمة الحالية لم تُؤكَّد. */
  needsConfirm: boolean;
}

export function packStateFor(
  map: { kind?: string | null; site_pack_qty?: number | string | null; site_pack_label?: string | null; site_pack_confirmed_at?: string | null } | null | undefined,
  siteName: string | null | undefined,
  coc: { name?: string | null; unit?: string | null } | null | undefined,
): PackState {
  const qty = packFactorOf(map);
  const confirmed = !!map?.site_pack_confirmed_at;
  const suggestion = map?.kind === "offer_box" ? null : suggestPackQty(siteName, coc);
  return {
    qty,
    label: map?.site_pack_label?.trim() || null,
    confirmed,
    suggestion,
    needsConfirm: !!suggestion && !confirmed && suggestion.qty !== qty,
  };
}
