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
