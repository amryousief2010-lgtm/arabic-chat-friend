/**
 * مصدر قراءة العملاء: المستخدم الذي دوره الوحيد marketing_sales_manager (مدير التسويق فقط)
 * لا يقرأ جدول customers مباشرة (أرقام الهواتف والعنوان)، بل الـ view المقنَّع customers_masked
 * (بدون phone / phone2 / address / notes). باقي الأدوار بدون تغيير.
 */
let masked = false;

export const isMarketingOnlyRoles = (roles: readonly string[] | null | undefined) =>
  !!roles && roles.length > 0 && roles.every((r) => r === "marketing_sales_manager");

export const setMaskedCustomers = (v: boolean) => { masked = v; };
export const usesMaskedCustomers = () => masked;

/** اسم الجدول/الـ view للاستعلام المباشر. */
export const customersTable = () => (masked ? "customers_masked" : "customers");

/** تضمين العميل داخل select على orders، مع الاحتفاظ بالاسم المستعار نفسه. */
export const customersEmbed = (alias: string, cols: string, defaultTarget = "customers") =>
  `${alias}:${masked ? "customers_masked" : defaultTarget}(${cols})`;
