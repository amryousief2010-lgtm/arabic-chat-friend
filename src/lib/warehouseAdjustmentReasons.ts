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
  "بيع لعميل",
] as const;

export type StockAdjustmentReason = typeof STOCK_ADJUSTMENT_REASONS[number];

export const isValidAdjustmentReason = (v: string | null | undefined) =>
  !!v && v.trim().length >= 3;

// ---- Custom reasons (persisted in localStorage) ----------------------------
// kind: "out" = صرف منتجات/توريد للجهات, "in" = إضافة رصيد/توريد مباشر
export type AdjustmentReasonKind = "out" | "in";

const STORAGE_KEY = (kind: AdjustmentReasonKind) =>
  `warehouse:custom_adjustment_reasons:${kind}`;

export const getCustomAdjustmentReasons = (kind: AdjustmentReasonKind): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(kind));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export const addCustomAdjustmentReason = (
  kind: AdjustmentReasonKind,
  name: string,
): { ok: boolean; reason?: string; error?: string } => {
  const trimmed = (name || "").trim();
  if (trimmed.length < 3) return { ok: false, error: "اسم السبب يجب أن لا يقل عن 3 أحرف" };
  const existing = [
    ...(STOCK_ADJUSTMENT_REASONS as readonly string[]),
    ...getCustomAdjustmentReasons(kind),
  ];
  if (existing.some((r) => r.trim().toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false, error: "هذا السبب موجود بالفعل" };
  }
  const next = [...getCustomAdjustmentReasons(kind), trimmed];
  try {
    localStorage.setItem(STORAGE_KEY(kind), JSON.stringify(next));
  } catch {
    return { ok: false, error: "تعذر حفظ السبب" };
  }
  return { ok: true, reason: trimmed };
};

export const getAllAdjustmentReasons = (kind: AdjustmentReasonKind): string[] => [
  ...(STOCK_ADJUSTMENT_REASONS as readonly string[]),
  ...getCustomAdjustmentReasons(kind),
];
