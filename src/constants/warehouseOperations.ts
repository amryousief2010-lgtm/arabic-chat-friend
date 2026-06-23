// تاريخ بداية التشغيل الفعلي للمخزن الرئيسي (إقفال تاريخي / بداية جرد جديد).
// أي أوردر/حركة قبل هذا التاريخ:
//   - لا يدخل في حساب المحجوز/المتاح الحالي.
//   - مؤرشف ولا يظهر افتراضيًا في سجل حركة الصنف.
//   - يمكن استعراضه من فلتر "الأرشيف" داخل سجل الحركة.
// آخر إقفال: 24-06-2026 — بداية جرد جديد للمخزن الرئيسي.
export const MAIN_WAREHOUSE_OPERATIONAL_START = "2026-06-24";
export const MAIN_WAREHOUSE_OPERATIONAL_START_ISO = "2026-06-24T00:00:00+02:00"; // Cairo midnight

export const isBeforeMainWarehouseStart = (iso?: string | null) => {
  if (!iso) return false;
  return new Date(iso) < new Date(MAIN_WAREHOUSE_OPERATIONAL_START_ISO);
};
