import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Bell,
  UsersRound,
  Target,
  Gift,
  AlertTriangle,
  Upload,
  UserCheck,
  Egg,
  FlaskConical,
  Bird,
  Beef,
  Factory,
  ClipboardList,
  History,
  Wheat,
  Warehouse,
  Truck,
  ChevronDown,
  Megaphone,
  Network,
  TrendingUp,
  LucideIcon,
} from "lucide-react";
import { useAuth, AppRole } from "@/hooks/useAuth";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import { findModeratorByName } from "@/constants/moderators";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface MenuItem {
  icon: LucideIcon;
  label: string;
  path: string;
  roles: AppRole[];
}

interface ModuleSection {
  id: string;
  icon: LucideIcon;
  label: string;
  roles: AppRole[];
  items: MenuItem[];
}

export const moduleSections: ModuleSection[] = [
  {
    id: "overview",
    icon: LayoutDashboard,
    label: "الرئيسية",
    roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'warehouse_supervisor', 'production_manager', 'marketing_sales_manager', 'financial_manager', 'quality_manager', 'farm_manager', 'hatchery_manager', 'brooding_manager', 'slaughterhouse_manager', 'meat_factory_manager', 'feed_factory_manager', 'hr_manager'],
    items: [
      { icon: LayoutDashboard, label: "لوحة التحكم", path: "/", roles: ['general_manager', 'executive_manager', 'marketing_sales_manager', 'financial_manager', 'production_manager'] },
      { icon: TrendingUp, label: "اللوحات التنفيذية", path: "/executive-dashboards", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager', 'financial_manager', 'accountant'] },
      { icon: Network, label: "الهيكل التنظيمي", path: "/org-chart", roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'warehouse_supervisor', 'production_manager', 'marketing_sales_manager', 'financial_manager', 'quality_manager', 'farm_manager', 'hatchery_manager', 'brooding_manager', 'slaughterhouse_manager', 'meat_factory_manager', 'feed_factory_manager', 'hr_manager'] },
      { icon: Bell, label: "الإشعارات", path: "/notifications", roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'warehouse_supervisor', 'production_manager', 'marketing_sales_manager', 'financial_manager', 'quality_manager'] },
    ],
  },
  {
    id: "sales",
    icon: Megaphone,
    label: "1. التسويق والمبيعات",
    roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'accountant', 'warehouse_supervisor', 'marketing_sales_manager', 'financial_manager', 'quality_manager'],
    items: [
      { icon: Package, label: "المنتجات", path: "/products", roles: ['general_manager', 'executive_manager', 'sales_manager', 'warehouse_supervisor', 'marketing_sales_manager', 'quality_manager'] },
      { icon: ShoppingCart, label: "الطلبات", path: "/orders", roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'accountant', 'warehouse_supervisor', 'marketing_sales_manager', 'financial_manager', 'quality_manager'] },
      { icon: Users, label: "العملاء", path: "/customers", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager'] },
      { icon: Gift, label: "صناديق العروض", path: "/offer-boxes", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager'] },
      { icon: Target, label: "أهداف المبيعات", path: "/sales-targets", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager'] },
      { icon: Target, label: "التارجت", path: "/sales-targets", roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager'] },
      { icon: UsersRound, label: "أداء الفريق", path: "/team-performance", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager'] },
      { icon: UserCheck, label: "أداء الموديراتور", path: "/moderator-performance", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager'] },
      { icon: BarChart3, label: "التقارير", path: "/reports", roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'marketing_sales_manager', 'financial_manager', 'quality_manager'] },
      { icon: Upload, label: "استيراد البيانات", path: "/import-sales", roles: ['general_manager'] },
    ],
  },
  {
    id: "farm",
    icon: Egg,
    label: "2. مزرعة الأمهات والإنتاج",
    roles: ['general_manager', 'executive_manager', 'farm_manager', 'production_manager', 'quality_manager'],
    items: [
      { icon: Egg, label: "إدارة المزرعة", path: "/farm", roles: ['general_manager', 'executive_manager', 'farm_manager', 'production_manager', 'quality_manager'] },
      { icon: Upload, label: "استيراد سجل الإنتاج (Excel)", path: "/farm-production-import", roles: ['general_manager', 'executive_manager', 'farm_manager', 'production_manager'] },
    ],
  },
  {
    id: "hatchery",
    icon: FlaskConical,
    label: "3. المعمل وتفريغ الكتاكيت",
    roles: ['general_manager', 'executive_manager', 'hatchery_manager', 'production_manager', 'quality_manager'],
    items: [
      { icon: FlaskConical, label: "إدارة المعمل", path: "/hatchery", roles: ['general_manager', 'executive_manager', 'hatchery_manager', 'production_manager', 'quality_manager'] },
      { icon: TrendingUp, label: "لوحة المزرعة والمعمل", path: "/modules/farm-hatchery-dashboard", roles: ['general_manager', 'executive_manager', 'farm_manager', 'hatchery_manager', 'production_manager', 'quality_manager'] },
      { icon: TrendingUp, label: "سجل وارد المزرعة", path: "/farm-shipments-log", roles: ['general_manager', 'executive_manager', 'farm_manager', 'hatchery_manager', 'production_manager', 'quality_manager'] },
    ],
  },
  {
    id: "brooding",
    icon: Bird,
    label: "4. التحضين والتسمين",
    roles: ['general_manager', 'executive_manager', 'brooding_manager', 'production_manager', 'quality_manager'],
    items: [
      { icon: Bird, label: "إدارة التحضين", path: "/modules/brooding", roles: ['general_manager', 'executive_manager', 'brooding_manager', 'production_manager', 'quality_manager'] },
    ],
  },
  {
    id: "slaughterhouse",
    icon: Beef,
    label: "5. المجزر وإنتاج اللحوم",
    roles: ['general_manager', 'executive_manager', 'slaughterhouse_manager', 'production_manager', 'quality_manager'],
    items: [
      { icon: Beef, label: "إدارة المجزر", path: "/modules/slaughterhouse", roles: ['general_manager', 'executive_manager', 'slaughterhouse_manager', 'production_manager', 'quality_manager'] },
      { icon: Beef, label: "إذن ذبح النعام", path: "/modules/slaughterhouse/permit", roles: ['general_manager', 'executive_manager', 'slaughterhouse_manager', 'production_manager', 'quality_manager'] },
    ],
  },
  {
    id: "meat-factory",
    icon: Factory,
    label: "6. مصنع اللحوم",
    roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager'],
    items: [
      { icon: Factory, label: "تصنيع المنتجات", path: "/modules/meat-factory", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager'] },
    ],
  },
  {
    id: "feed-factory",
    icon: Wheat,
    label: "7. مصنع الأعلاف",
    roles: ['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager'],
    items: [
      { icon: Wheat, label: "تصنيع الأعلاف", path: "/modules/feed-factory", roles: ['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager'] },
    ],
  },
  {
    id: "hr",
    icon: UsersRound,
    label: "8. الموارد البشرية",
    roles: ['general_manager', 'executive_manager', 'hr_manager'],
    items: [
      { icon: UsersRound, label: "الموارد البشرية", path: "/modules/hr", roles: ['general_manager', 'executive_manager', 'hr_manager'] },
      { icon: Users, label: "الموظفين (نظام)", path: "/employees", roles: ['general_manager'] },
    ],
  },
  {
    id: "warehouses",
    icon: Warehouse,
    label: "9. المخازن",
    roles: ['general_manager', 'executive_manager', 'warehouse_supervisor', 'production_manager', 'quality_manager', 'sales_manager', 'marketing_sales_manager', 'sales_moderator'],
    items: [
      { icon: Warehouse, label: "إدارة المخازن", path: "/modules/warehouses", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor', 'production_manager', 'quality_manager', 'sales_moderator'] },
      { icon: AlertTriangle, label: "مخزون منخفض", path: "/low-stock", roles: ['general_manager', 'executive_manager', 'sales_manager', 'warehouse_supervisor', 'production_manager', 'marketing_sales_manager', 'quality_manager'] },
      { icon: ClipboardList, label: "قائمة التصنيع", path: "/manufacturing-queue", roles: ['general_manager', 'executive_manager', 'sales_manager', 'warehouse_supervisor', 'production_manager', 'quality_manager'] },
      { icon: History, label: "سجل تزويد المخزون", path: "/stock-replenishment-log", roles: ['general_manager', 'executive_manager', 'sales_manager', 'warehouse_supervisor', 'production_manager', 'accountant'] },
    ],
  },
  {
    id: "private-delivery",
    icon: Truck,
    label: "10. شحن المندوب الخاص",
    roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'marketing_sales_manager', 'private_delivery_rep', 'sales_moderator'],
    items: [
      { icon: ShoppingCart, label: "طلباتي", path: "/orders", roles: ['private_delivery_rep'] },
      { icon: Truck, label: "أسعار شحن المندوب الخاص", path: "/private-delivery-pricing", roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'marketing_sales_manager', 'private_delivery_rep', 'sales_moderator'] },
      { icon: Bell, label: "الإشعارات", path: "/notifications", roles: ['private_delivery_rep'] },
    ],
  },
  {
    id: "system",
    icon: Settings,
    label: "النظام",
    roles: ['general_manager'],
    items: [
      { icon: Settings, label: "الإعدادات", path: "/settings", roles: ['general_manager'] },
    ],
  },
];

interface SidebarMenuProps {
  onItemClick?: () => void;
}

export const SidebarMenuSections = ({ onItemClick }: SidebarMenuProps) => {
  const location = useLocation();
  const { role, profile } = useAuth();
  const { unreadCount } = useUnreadNotifications();
  // Sales moderators now use the same /orders page as managers (RLS scopes
  // them to their own rows). The previous override sent them to a stripped-
  // down log view, which the user explicitly asked to remove.
  const ordersPathOverride: string | null = null;

  const activeSectionId = moduleSections.find((s) =>
    s.items.some((i) => i.path === location.pathname)
  )?.id;

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => ({
    [activeSectionId ?? "overview"]: true,
    overview: true,
    sales: activeSectionId === "sales" || activeSectionId === undefined,
  }));

  const toggleSection = (id: string) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const visibleSections = moduleSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => role && item.roles.includes(role)),
    }))
    .filter((section) => role && section.roles.includes(role) && section.items.length > 0);

  return (
    <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
      {visibleSections.map((section) => {
        const isOpen = openSections[section.id] ?? false;
        const hasActiveItem = section.items.some((i) => i.path === location.pathname);

        return (
          <Collapsible
            key={section.id}
            open={isOpen}
            onOpenChange={() => toggleSection(section.id)}
          >
            <CollapsibleTrigger
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-right ${
                hasActiveItem
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
              }`}
            >
              <section.icon className="w-5 h-5 shrink-0" />
              <span className="font-semibold text-sm flex-1 text-right">{section.label}</span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
              <div className="mt-1 mr-3 space-y-1 border-r-2 border-sidebar-border pr-3">
                {section.items.map((item) => {
                  const targetPath = ordersPathOverride && item.path === "/orders" ? ordersPathOverride : item.path;
                  const isActive = location.pathname === targetPath;
                  const showBadge = item.path === "/notifications" && unreadCount > 0;
                  return (
                    <Link
                      key={item.path}
                      to={targetPath}
                      onClick={onItemClick}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      }`}
                    >
                      <item.icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {showBadge && (
                        <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-xs">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </Badge>
                      )}
                    </Link>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </nav>
  );
};
