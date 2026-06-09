import type { AppRole } from "@/hooks/useAuth";

// Per-role default landing page after login (or after hitting "/").
// User-specified mapping:
//  - moderator → org chart
//  - general/executive/marketing/financial/operations → main dashboard
//  - others → the most relevant module they own
export const ROLE_LANDING: Record<AppRole, string> = {
  sales_moderator: "/orders",
  general_manager: "/",
  executive_manager: "/",
  marketing_sales_manager: "/",
  financial_manager: "/",
  production_manager: "/",
  sales_manager: "/",
  accountant: "/reports",
  warehouse_supervisor: "/modules/warehouses",
  quality_manager: "/",
  shipping_company: "/orders",
  farm_manager: "/modules/farm",
  hatchery_manager: "/modules/hatchery",
  brooding_manager: "/modules/brooding",
  slaughterhouse_manager: "/modules/slaughterhouse",
  meat_factory_manager: "/modules/meat-factory",
  feed_factory_manager: "/modules/feed-factory",
  hr_manager: "/modules/hr",
  private_delivery_rep: "/orders",
  agouza_warehouse_keeper: "/warehouse-stock/agouza",
  brooding_dashboard_viewer: "/modules/brooding",
  lab_treasury_keeper: "/lab-treasury",
  lab_external_collector: "/my-lab-collections",
  lab_treasury_approver: "/lab-treasury",
  slaughterhouse_custody_keeper: "/slaughterhouse-custody",
  social_media_manager: "/social-media/daily",
};

export const getLandingForRole = (role?: AppRole | null): string =>
  (role && ROLE_LANDING[role]) || "/";
