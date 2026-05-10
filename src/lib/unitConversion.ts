// نظام تحويل الوحدات للمواد الخام داخل BOM
// يدعم وحدات الكتلة (mass) والحجم (volume) والعدد (count)

export type UnitDimension = "mass" | "volume" | "count" | "unknown";

interface UnitDef {
  dimension: UnitDimension;
  // معامل التحويل إلى الوحدة الأساسية (كجم للكتلة، لتر للحجم، قطعة للعدد)
  toBase: number;
  baseUnit: string;
  aliases: string[];
}

const UNITS: UnitDef[] = [
  // الكتلة - الأساس: كجم
  { dimension: "mass", toBase: 1, baseUnit: "كجم", aliases: ["كجم", "كيلو", "كيلوجرام", "kg"] },
  { dimension: "mass", toBase: 0.001, baseUnit: "كجم", aliases: ["جم", "جرام", "g", "gram"] },
  { dimension: "mass", toBase: 1000, baseUnit: "كجم", aliases: ["طن", "ton", "t"] },
  { dimension: "mass", toBase: 50, baseUnit: "كجم", aliases: ["شيكارة", "شوال", "كيس 50"] },
  { dimension: "mass", toBase: 25, baseUnit: "كجم", aliases: ["كيس 25"] },

  // الحجم - الأساس: لتر
  { dimension: "volume", toBase: 1, baseUnit: "لتر", aliases: ["لتر", "ل", "l", "liter"] },
  { dimension: "volume", toBase: 0.001, baseUnit: "لتر", aliases: ["مل", "ml"] },
  { dimension: "volume", toBase: 1000, baseUnit: "لتر", aliases: ["م3", "متر مكعب", "m3"] },

  // العدد - الأساس: قطعة
  { dimension: "count", toBase: 1, baseUnit: "قطعة", aliases: ["قطعة", "وحدة", "حبة", "pcs", "unit"] },
  { dimension: "count", toBase: 12, baseUnit: "قطعة", aliases: ["دستة", "dozen"] },
  { dimension: "count", toBase: 144, baseUnit: "قطعة", aliases: ["جروسة"] },
];

const normalize = (u: string) => (u || "").trim().toLowerCase().replace(/\s+/g, " ");

export const findUnit = (unit: string): UnitDef | null => {
  const n = normalize(unit);
  return UNITS.find(u => u.aliases.some(a => normalize(a) === n)) || null;
};

export const getDimension = (unit: string): UnitDimension => findUnit(unit)?.dimension ?? "unknown";

export const getBaseUnit = (unit: string): string => findUnit(unit)?.baseUnit ?? unit;

/**
 * تحويل كمية من وحدة لأخرى. يرجع null إذا الوحدتين غير متوافقتين.
 */
export const convert = (qty: number, fromUnit: string, toUnit: string): number | null => {
  if (normalize(fromUnit) === normalize(toUnit)) return qty;
  const from = findUnit(fromUnit);
  const to = findUnit(toUnit);
  if (!from || !to) return null;
  if (from.dimension !== to.dimension) return null;
  // qty * fromBase => في الوحدة الأساسية، ثم نقسم على toBase
  return (qty * from.toBase) / to.toBase;
};

/**
 * تحويل إلى الوحدة الأساسية للبُعد (للتجميع الإجمالي).
 */
export const toBaseQty = (qty: number, unit: string): { qty: number; unit: string; dimension: UnitDimension } => {
  const u = findUnit(unit);
  if (!u) return { qty, unit, dimension: "unknown" };
  return { qty: qty * u.toBase, unit: u.baseUnit, dimension: u.dimension };
};

/**
 * تجميع كميات بوحدات مختلفة حسب البُعد. مفيد لإظهار إجمالي BOM.
 */
export const aggregateByDimension = (
  items: Array<{ qty: number; unit: string }>
): Array<{ unit: string; qty: number; dimension: UnitDimension }> => {
  const map = new Map<string, { unit: string; qty: number; dimension: UnitDimension }>();
  for (const it of items) {
    const b = toBaseQty(it.qty, it.unit);
    const key = `${b.dimension}:${b.unit}`;
    const cur = map.get(key);
    if (cur) cur.qty += b.qty;
    else map.set(key, { unit: b.unit, qty: b.qty, dimension: b.dimension });
  }
  return Array.from(map.values());
};

export const formatAggregate = (
  rows: Array<{ unit: string; qty: number }>
): string => rows.map(r => `${r.qty.toFixed(2)} ${r.unit}`).join(" + ");
