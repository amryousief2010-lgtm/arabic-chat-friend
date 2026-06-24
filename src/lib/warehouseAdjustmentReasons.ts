// Predefined adjustment reasons — used in manual warehouse supply/dispatch dialogs.
// Any manual stock change MUST carry one of these reasons (≥ 3 chars).
export const STOCK_ADJUSTMENT_REASONS = [
  "توريد جديد",
  "جرد فعلي",
  "فرق وزن",
  "خطأ إدخال",
  "تالف",
  "مرتجع",
  "تصحيح عبوات",
  "تسوية مخزون",
] as const;

export type StockAdjustmentReason = typeof STOCK_ADJUSTMENT_REASONS[number];

export const isValidAdjustmentReason = (v: string | null | undefined) =>
  !!v && v.trim().length >= 3;
