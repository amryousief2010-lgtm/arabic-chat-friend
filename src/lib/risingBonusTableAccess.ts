/**
 * من يشوف جدول «نظام البونص المعتمد» (منحنى المصنّعات العام).
 * نفس أدوار زر «تسليم سريع» في صفحة الطلبات:
 * المدير العام، المدير التنفيذي، ومديرة التسويق والمبيعات (marketing_sales_manager).
 * مش مربوط باسم شخص. sales_moderator و marketing_sales_viewer و sales_manager لوحده مش داخلين.
 */
export const RISING_BONUS_TABLE_ROLES = [
  'general_manager',
  'executive_manager',
  'marketing_sales_manager',
] as const;

/**
 * من يقرأ جداول إعداد البونص من قاعدة البيانات مباشرة.
 * نفس أدوار الكتابة الحالية على target_bonus_settings و processed_kg_bonus_schedules
 * عشان جدول التارجت الشهري يفضل يتحرر من مديرة المبيعات.
 */
export const BONUS_SETTINGS_READ_ROLES = [
  'general_manager',
  'executive_manager',
  'sales_manager',
  'marketing_sales_manager',
] as const;

export const hasAnyListedRole = (
  roles: readonly string[] | null | undefined,
  allowed: readonly string[],
) => (roles ?? []).some((role) => allowed.includes(role));

export const canViewRisingBonusTable = (roles: readonly string[] | null | undefined) =>
  hasAnyListedRole(roles, RISING_BONUS_TABLE_ROLES);

export const canReadBonusSettingsTable = (roles: readonly string[] | null | undefined) =>
  hasAnyListedRole(roles, BONUS_SETTINGS_READ_ROLES);
