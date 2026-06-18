// تاريخ بداية التشغيل الفعلي للمخزن الرئيسي.
// أي أوردر/حركة قبل هذا التاريخ:
//   - لا تؤثر على الجرد (مفروض على مستوى قاعدة البيانات).
//   - لا تظهر لموظف المخزن في شاشات التشغيل.
//   - تظهر للمدير العام / التنفيذي فقط عند تفعيل "أرشيف قبل بداية التشغيل".
export const MAIN_WAREHOUSE_OPERATIONAL_START = "2026-06-18";
export const MAIN_WAREHOUSE_OPERATIONAL_START_ISO = "2026-06-18T00:00:00+02:00"; // Cairo midnight

export const isBeforeMainWarehouseStart = (iso?: string | null) => {
  if (!iso) return false;
  return new Date(iso) < new Date(MAIN_WAREHOUSE_OPERATIONAL_START_ISO);
};
