import type { AppRole } from "@/hooks/useAuth";

export const CHAT_MANAGEMENT_SHIFTS_PATH = "/chat-management/shifts";
export const CHAT_MANAGEMENT_SETTINGS_PATH = "/chat-management/settings";

/** من يفتح صفحات إدارة المحادثات. غير المحررين يرون الصفحة للعرض فقط بلا أدوات تعديل. */
export const CHAT_MANAGEMENT_VIEW_ROLES: AppRole[] = [
  "general_manager",
  "executive_manager",
  "sales_manager",
  "marketing_sales_manager",
  "marketing_sales_viewer",
  "social_media_manager",
];

/** من يعدّل الشيفتات والأجازات والتوزيع (يطابق cm_can_manage في قاعدة البيانات). */
export const CHAT_MANAGEMENT_EDIT_ROLES: AppRole[] = ["sales_manager", "general_manager"];

export const canEditChatManagement = (roles: readonly string[] | null | undefined): boolean =>
  !!roles?.some((r) => (CHAT_MANAGEMENT_EDIT_ROLES as string[]).includes(r));

// ───── الخطوة 3: صناديق المحادثات ─────
export const CHAT_INBOX_PATH = "/chat-management/inbox";
export const CHAT_SUPERVISOR_PATH = "/chat-management/conversations";
export const CHAT_PHONE_REVIEW_PATH = "/chat-management/phone-review";

/** صندوق الرسائل: المودريتور فقط (ترى محادثاتها هي فقط عبر RLS). */
export const CHAT_INBOX_ROLES: AppRole[] = ["sales_moderator"];
/** عرض المشرفات لكل المحادثات: نفس أدوار العرض (التعديل لـ SM/GM فقط). المودريتور ممنوعة. */
export const CHAT_SUPERVISOR_ROLES: AppRole[] = CHAT_MANAGEMENT_VIEW_ROLES;
/** مراجعة الأرقام والدمج: يطابق cm_is_supervisor (الدمج والتراجع لـ SM/GM فقط). */
export const CHAT_PHONE_REVIEW_ROLES: AppRole[] = [
  "general_manager", "executive_manager", "sales_manager", "marketing_sales_manager",
];
/** كل من يرى قسم «إدارة المحادثات» في القائمة. */
export const CHAT_MANAGEMENT_SECTION_ROLES: AppRole[] = [...CHAT_MANAGEMENT_VIEW_ROLES, "sales_moderator"];

const hasAny = (roles: readonly string[] | null | undefined, allowed: readonly string[]) =>
  !!roles?.some((r) => allowed.includes(r));
export const canUseInbox = (roles: readonly string[] | null | undefined) => hasAny(roles, CHAT_INBOX_ROLES);
export const canViewSupervisor = (roles: readonly string[] | null | undefined) => hasAny(roles, CHAT_SUPERVISOR_ROLES);
export const canReviewPhones = (roles: readonly string[] | null | undefined) => hasAny(roles, CHAT_PHONE_REVIEW_ROLES);
/** إعادة الإسناد والتغطية والدمج والتراجع: مديرة المبيعات والمدير العام فقط. */
export const canManageConversations = canEditChatManagement;

/** نص الحقل المعطَّل حتى يُربط الإرسال عبر واتساب. */
export const COMPOSER_DISABLED_PLACEHOLDER = "الإرسال من هنا غير متاح بعد — سيُفعَّل بعد ربط واتساب. ردّي من تطبيق واتساب على الخط.";

// ───── الخطوة 4: المؤشرات، الإنفاق، المكالمات ─────
export const CHAT_KPIS_PATH = "/chat-management/kpis";
export const CHAT_AD_SPEND_PATH = "/chat-management/ad-spend";
export const CHAT_CALLS_PATH = "/chat-management/calls";
/** «مؤشرات الأداء»: SM / GM / EM / MSM (القراءة نفسها محكومة بـ RLS). */
export const CHAT_KPIS_ROLES: AppRole[] = ["sales_manager", "general_manager", "executive_manager", "marketing_sales_manager"];
/** إدخال الإنفاق اليومي واستيراده: MSM / SM / GM (قاعدة البيانات تسمح لـ EM أيضاً). */
export const CHAT_AD_SPEND_ROLES: AppRole[] = ["marketing_sales_manager", "sales_manager", "general_manager"];
/** سجل مكالمات الخط الساخن: نفس أدوار المؤشرات؛ الاستيراد SM/GM؛ الاستماع GM/EM/SM. */
export const CHAT_CALLS_ROLES: AppRole[] = CHAT_KPIS_ROLES;
export const CHAT_CDR_IMPORT_ROLES: AppRole[] = ["sales_manager", "general_manager"];
export const CHAT_RECORDING_ROLES: AppRole[] = ["general_manager", "executive_manager", "sales_manager"];
export const canImportCdr = (roles: readonly string[] | null | undefined) => hasAny(roles, CHAT_CDR_IMPORT_ROLES);
export const canListenRecordings = (roles: readonly string[] | null | undefined) => hasAny(roles, CHAT_RECORDING_ROLES);
export const canWriteAdSpend = (roles: readonly string[] | null | undefined) => hasAny(roles, CHAT_AD_SPEND_ROLES);
