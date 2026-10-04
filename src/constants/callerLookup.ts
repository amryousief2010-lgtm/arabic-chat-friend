import type { AppRole } from "@/hooks/useAuth";

export const CALLER_LOOKUP_PATH = "/caller-lookup";

// sales_moderator is the role the sales moderators use.
// The other roles are the ones whose orders SELECT policy is not limited
// to their own rows: "Managers and authorized roles can view all orders"
// and "marketing_sales_viewer read".
// social_media_manager can also read every order, but has no customer
// SELECT policy, so the screen stays closed and the function returns no
// customer payload for that role.
export const CALLER_LOOKUP_ROLES: AppRole[] = [
  "sales_moderator",
  "general_manager",
  "executive_manager",
  "sales_manager",
  "marketing_sales_manager",
  "accountant",
  "warehouse_supervisor",
  "marketing_sales_viewer",
];
