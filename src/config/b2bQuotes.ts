import type { AppRole } from "@/hooks/useAuth";

/**
 * شاشة «طلبات عروض الأسعار – الفنادق والمطاعم» (B2B) — منفصلة عن «طلبات الموقع» (التجزئة).
 * قرار م. عمرو 27/11/2026.
 */
export const B2B_QUOTES_PATH = "/sales/b2b-quotes";
export const B2B_QUOTES_LABEL = "طلبات عروض الأسعار – الفنادق والمطاعم";

/** يرون كل الطلبات، يُسندون، ويربطون/ينشئون العميل. يطابق b2b_quote_can_manage(). */
export const B2B_QUOTES_MANAGE_ROLES: AppRole[] = ["general_manager", "executive_manager", "sales_manager"];

/** يدخلون الشاشة: المديرون + المودريتور (يرى المُسند إليه فقط بحكم RLS). */
export const B2B_QUOTES_VIEW_ROLES: AppRole[] = [...B2B_QUOTES_MANAGE_ROLES, "sales_moderator"];

/** أنواع الإشعارات التي تفتح هذه الشاشة. */
export const B2B_NOTIFICATION_TYPES = ["b2b_quote_request", "b2b_quote_assigned"] as const;

export const canManageB2BQuotes = (roles: readonly string[] | null | undefined): boolean =>
  !!roles?.some((r) => (B2B_QUOTES_MANAGE_ROLES as string[]).includes(r));

export const isB2BQuoteNotification = (type: string | null | undefined): boolean =>
  !!type && (B2B_NOTIFICATION_TYPES as readonly string[]).includes(type);
