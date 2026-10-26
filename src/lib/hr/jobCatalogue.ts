/**
 * كتالوج الأقسام والمسميات الوظيفية المعتمد (المرحلة 1 من مقترح الموارد البشرية).
 * - المبيعات والتسويق قسمان منفصلان.
 * - مدير كل قسم بيانات فقط (manager_user_id في جدول hr_departments) ولا يُثبَّت في الكود.
 * - خانة الوظيفة اختيارية، ويمكن كتابة مسمى آخر عبر «أخرى».
 */
export interface HrDepartment {
  code: string;
  name: string;
  parent: string | null;
  jobs: { title: string; description: string }[];
}

export const OTHER_JOB = "__other__";

export const HR_DEPARTMENTS: HrDepartment[] = [
  { code: "executive", name: "الإدارة العليا", parent: null, jobs: [
    { title: "المدير العام", description: "قيادة الشركة واعتماد القرارات" },
    { title: "المدير التنفيذي", description: "إدارة التشغيل اليومي للأقسام" },
    { title: "مساعد إداري", description: "دعم الإدارة العليا والمراسلات" },
  ] },
  { code: "sales", name: "المبيعات", parent: "executive", jobs: [
    { title: "مدير المبيعات", description: "قيادة فريق المبيعات وتحقيق التارجت" },
    { title: "مشرف موديريتورز", description: "متابعة أداء الموديريتورز وجودة الطلبات" },
    { title: "موديريتور مبيعات", description: "استقبال الطلبات والرد على العملاء" },
  ] },
  { code: "customer_service", name: "خدمة العملاء", parent: "sales", jobs: [
    { title: "مشرف خدمة العملاء", description: "متابعة الشكاوى وجودة الخدمة" },
    { title: "موظف خط ساخن", description: "الرد على المتصلين" },
    { title: "متابعة شكاوى", description: "متابعة ما بعد البيع" },
  ] },
  { code: "shipping", name: "الشحن والتوصيل", parent: "sales", jobs: [
    { title: "منسق شحن", description: "تنظيم تسليم الطلبات" },
    { title: "متابعة شحن العاصمة", description: "متابعة البوالص والتحصيل" },
    { title: "مندوب توصيل", description: "توصيل الطلبات للعملاء" },
    { title: "سائق", description: "نقل البضائع والأفراد" },
  ] },
  { code: "marketing", name: "التسويق", parent: "executive", jobs: [
    { title: "مدير التسويق", description: "تخطيط الحملات والهوية" },
    { title: "مسؤول تسويق رقمي", description: "إدارة الإعلانات والصفحات" },
    { title: "مصمم محتوى", description: "تصميم المنشورات والفيديوهات" },
    { title: "أخصائي دعاية وتسويق", description: "تنفيذ الحملات والعروض" },
  ] },
  { code: "finance", name: "الحسابات والمالية", parent: "executive", jobs: [
    { title: "مدير مالي", description: "الإشراف على الحسابات والخزائن" },
    { title: "محاسب عام", description: "القيود والفواتير" },
    { title: "محاسب خزنة رئيسية", description: "حركات الخزنة الرئيسية" },
    { title: "محاسب تكاليف", description: "تكلفة الإنتاج والمخزون" },
    { title: "أمين خزنة", description: "استلام وصرف النقدية" },
  ] },
  { code: "operations", name: "الإنتاج والتشغيل", parent: "executive", jobs: [
    { title: "مدير إنتاج", description: "الإشراف على المزرعة والمعمل والمجزر والمصنع" },
  ] },
  { code: "farm", name: "المزرعة", parent: "operations", jobs: [
    { title: "مشرف مزرعة", description: "متابعة القطيع والتغذية" },
    { title: "عامل مزرعة أمهات", description: "رعاية الأمهات وجمع البيض" },
    { title: "عامل مزرعة تسمين", description: "رعاية التسمين" },
    { title: "طبيب بيطري", description: "صحة القطيع" },
  ] },
  { code: "hatchery", name: "معمل التفريخ", parent: "operations", jobs: [
    { title: "مشرف معمل", description: "إدارة دفعات التحضين" },
    { title: "فني تفريخ", description: "التحضين والفقس" },
    { title: "عامل معمل", description: "رعاية الكتاكيت والنظافة" },
  ] },
  { code: "slaughterhouse", name: "المجزر", parent: "operations", jobs: [
    { title: "مشرف مجزر", description: "إدارة دفعات الذبح" },
    { title: "جزار", description: "الذبح والتشفية" },
    { title: "مساعد جزار", description: "المساعدة في التجهيز" },
    { title: "عامل تجهيز وتغليف", description: "التغليف والتسليم للمخزن" },
  ] },
  { code: "meat_factory", name: "مصنع اللحوم", parent: "operations", jobs: [
    { title: "مشرف وردية", description: "متابعة خط الإنتاج" },
    { title: "فني تصنيع", description: "تشغيل الماكينات والوصفات" },
    { title: "عامل إنتاج", description: "التصنيع والتعبئة" },
    { title: "مراقب جودة", description: "فحص المنتجات والمواصفات" },
  ] },
  { code: "warehouses", name: "المخازن", parent: "operations", jobs: [
    { title: "أمين مخزن رئيسي", description: "الاستلام والصرف من الرئيسي" },
    { title: "أمين مخزن فرعي", description: "إدارة مخزن فرعي" },
    { title: "عامل مخزن", description: "التحميل والترتيب" },
    { title: "مسؤول جرد", description: "الجرد والمطابقة" },
  ] },
  { code: "support", name: "الدعم الإداري", parent: "executive", jobs: [] },
  { code: "hr", name: "الموارد البشرية", parent: "support", jobs: [
    { title: "مسؤول موارد بشرية", description: "ملفات الموظفين" },
    { title: "مسؤول رواتب وحضور", description: "الرواتب والسلف والخصومات" },
  ] },
  { code: "it", name: "تقنية المعلومات", parent: "support", jobs: [
    { title: "مسؤول أنظمة", description: "التطبيق والصلاحيات" },
    { title: "دعم فني", description: "الأجهزة والمساعدة" },
  ] },
  { code: "services", name: "الخدمات المساندة", parent: "support", jobs: [
    { title: "بواب", description: "الحراسة والاستقبال" },
    { title: "فرد أمن", description: "تأمين المواقع" },
    { title: "عامل نظافة", description: "نظافة المواقع" },
    { title: "مستشار قانوني", description: "الشؤون القانونية" },
  ] },
];

export const ALL_JOB_TITLES: string[] = HR_DEPARTMENTS.flatMap((d) => d.jobs.map((j) => j.title));

export const findDepartmentByName = (name?: string | null) =>
  HR_DEPARTMENTS.find((d) => d.name === (name || "").trim()) || null;

/** هل القيمة الحالية من الكتالوج؟ إن لم تكن فهي «أخرى» نص حر */
export const isCatalogueJob = (title?: string | null) =>
  !!title && ALL_JOB_TITLES.includes(title.trim());

/** الوظائف مرتبة: وظائف القسم المختار أولًا ثم الباقي */
export const jobsForDepartment = (deptName?: string | null): HrDepartment[] => {
  const d = findDepartmentByName(deptName);
  return d ? [d, ...HR_DEPARTMENTS.filter((x) => x !== d)] : HR_DEPARTMENTS;
};
