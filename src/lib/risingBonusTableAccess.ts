/**
 * من يشوف جدول «نظام البونص المعتمد» (منحنى المصنّعات العام).
 * المدير العام، المدير التنفيذي، ومدير المبيعات (sales_manager — م. آلاء).
 * marketing_sales_manager لوحده (محمد سيد) مش داخل الظهور.
 * تسليم سريع لسه على شرطه القديم ومش بيستخدم القائمة دي.
 */
export const RISING_BONUS_TABLE_ROLES = [
  'general_manager',
  'executive_manager',
  'sales_manager',
] as const;

/**
 * من يقرأ جداول إعداد البونص من قاعدة البيانات مباشرة.
 * الأربع أدوار الإدارية اللي كانت بتقرأ الإعدادات، بالإضافة لـ marketing_sales_viewer
 * (محمد شعلة) عشان شاشاته تفضل تقرأ الجدولين. الظهور غير القراءة.
 */
export const BONUS_SETTINGS_READ_ROLES = [
  'general_manager',
  'executive_manager',
  'sales_manager',
  'marketing_sales_manager',
  'marketing_sales_viewer',
] as const;

export const hasAnyListedRole = (
  roles: readonly string[] | null | undefined,
  allowed: readonly string[],
) => (roles ?? []).some((role) => allowed.includes(role));

export const canViewRisingBonusTable = (roles: readonly string[] | null | undefined) =>
  hasAnyListedRole(roles, RISING_BONUS_TABLE_ROLES);

export const canReadBonusSettingsTable = (roles: readonly string[] | null | undefined) =>
  hasAnyListedRole(roles, BONUS_SETTINGS_READ_ROLES);
