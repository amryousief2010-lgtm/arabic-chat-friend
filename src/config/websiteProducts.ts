import type { AppRole } from "@/hooks/useAuth";
import { WEBSITE_ORDERS_ROLES } from "@/config/websiteOrders";

/** شاشة «منتجات الموقع» — مطابقة ومزامنة منتجات وعروض capitalostrich.com مع coceg. */
export const WEBSITE_PRODUCTS_PATH = "/website-products";

/** نفس صلاحية website_inbox_can_manage(): مديرة المبيعات والمدير العام والمدير التنفيذي فقط. */
export const WEBSITE_PRODUCTS_ROLES: AppRole[] = WEBSITE_ORDERS_ROLES;

export const canManageWebsiteProducts = (roles: readonly string[] | null | undefined): boolean =>
  !!roles?.some((r) => (WEBSITE_PRODUCTS_ROLES as string[]).includes(r));
