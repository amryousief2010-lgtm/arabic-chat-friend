import type { AppRole } from "@/hooks/useAuth";

/** شاشة «طلبات الموقع» (capitalostrich.com). قرار م. عمرو 25/11/2026: بدون أدوار التسويق. */
export const WEBSITE_ORDERS_PATH = "/website-orders";

/** يطابق website_inbox_can_manage() في قاعدة البيانات. */
export const WEBSITE_ORDERS_ROLES: AppRole[] = ["general_manager", "executive_manager", "sales_manager"];

export const canManageWebsiteOrders = (roles: readonly string[] | null | undefined): boolean =>
  !!roles?.some((r) => (WEBSITE_ORDERS_ROLES as string[]).includes(r));
