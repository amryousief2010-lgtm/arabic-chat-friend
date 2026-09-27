// Centralised signed-quantity helper for inventory_movements on the main warehouse.
// `quantity` is stored as a positive number for in/out movements; the sign is
// inferred from the movement_type. Adjustments and reconciliations are stored
// with their natural sign already.
export const POSITIVE_TYPES = new Set([
  "in",
  "opening_balance",
  "purchase_receipt",
  "return",
  "sales_return",
  "finished_goods_receipt",
  "stock_in",
]);

export const NEGATIVE_TYPES = new Set([
  "out",
  "sales_dispatch",
  "waste_loss",
  "stock_out",
  "production_consumption",
  "packaging_consumption",
]);

export const RAW_SIGN_TYPES = new Set([
  "adjustment",
  "adjust",
  "reconciliation",
  "transfer",
]);

const ABSOLUTE_ADJUSTMENT_TYPES = new Set(["adjustment", "adjust", "reconciliation"]);

export type MovementEffectFields = {
  effect_mode?: string | null;
  stock_before?: number | null;
  stock_after?: number | null;
};

/**
 * Real stock effect of one movement.
 *
 * Prefer stock_after − stock_before when both snapshots exist (posted rows).
 * Delta-mode adjustments use the stored signed quantity.
 * An absolute adjustment (effect_mode null or 'set') without a snapshot is not
 * a delta — return 0 instead of treating the target quantity as a movement.
 */
export function signedDelta(type: string, qty: number, effect?: MovementEffectFields | null): number {
  const before = effect?.stock_before;
  const after = effect?.stock_after;
  if (before != null && after != null) {
    const b = Number(before);
    const a = Number(after);
    if (Number.isFinite(b) && Number.isFinite(a)) return a - b;
  }

  const q = Number(qty) || 0;
  const mode = effect?.effect_mode ?? null;

  if (ABSOLUTE_ADJUSTMENT_TYPES.has(type) && mode !== "delta") return 0;
  if (type === "opening_balance" && mode === "set") return 0;
  if (POSITIVE_TYPES.has(type)) return Math.abs(q);
  if (NEGATIVE_TYPES.has(type)) return -Math.abs(q);
  if (ABSOLUTE_ADJUSTMENT_TYPES.has(type) && mode === "delta") return q;
  return q;
}

export const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  in: "وارد",
  out: "صادر",
  transfer: "تحويل",
  adjustment: "تسوية",
  adjust: "تسوية",
  opening_balance: "رصيد افتتاحي",
  sales_dispatch: "صرف مبيعات",
  sales_return: "مرتجع مبيعات",
  waste_loss: "هالك",
  production_consumption: "استهلاك إنتاج",
  packaging_consumption: "استهلاك تغليف",
  purchase_receipt: "وارد مشتريات",
  finished_goods_receipt: "وارد جاهز",
  return: "مرتجع",
  reconciliation: "تسوية",
  stock_in: "إدخال",
  stock_out: "إخراج",
};

export const isAdjustmentLike = (m: { movement_type: string; reason?: string | null }) => {
  const t = m.movement_type;
  if (t === "adjustment" || t === "adjust" || t === "reconciliation") return true;
  // صرف بالسالب بصلاحية مدير — يُسجَّل عادةً بـ out مع notes/reason خاص
  if ((m.reason || "").includes("سالب") || (m.reason || "").includes("مدير")) return true;
  return false;
};
