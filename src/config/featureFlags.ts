// ============================================================================
// Feature Flags
// ----------------------------------------------------------------------------
// Lightweight runtime flags. Toggle a value here to enable/disable a feature
// across the app without changing logic. When a flag is disabled, related UI
// is hidden but historical data is preserved (no deletes, no rollbacks).
// ============================================================================

export const FEATURE_FLAGS = {
  /**
   * مؤقتًا: السماح لمسؤول المخزن الرئيسي / المدير العام / المدير التنفيذي
   * بإضافة رصيد يدوي للمخزن الرئيسي (وارد) بدون اشتراط نقل رسمي من المجزر
   * أو مصنع اللحوم. عند الإيقاف: يختفي زر "إضافة رصيد يدوي" فقط، وتبقى
   * كل الحركات اليدوية القديمة محفوظة في سجل الحركات.
   */
  allow_manual_main_warehouse_stock_addition: true,
  /**
   * مؤقتًا: السماح بإضافة رصيد / توريد مباشر يدوي لأي مخزن (الرئيسي،
   * العجوزة، مخازن العملاء، ... إلخ) بدون تحويل داخلي ولا فاتورة ولا حركة
   * خزنة. عند الإيقاف: يختفي زر "إضافة رصيد / توريد مباشر" من كل المخازن
   * ويُستأنف الاعتماد على التحويلات الداخلية الرسمية. الحركات القديمة
   * تبقى محفوظة في سجل الحركات.
   */
  allow_manual_warehouse_stock_addition: true,
} as const;


export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export const isFeatureEnabled = (key: FeatureFlagKey): boolean =>
  FEATURE_FLAGS[key] === true;
