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
  BookOpen,
  History,
  Wheat,
  Warehouse,
  Truck,
  ChevronDown,
  Megaphone,
  Network,
  TrendingUp,
  Calculator,
  ScrollText,
  MessageSquare,
  Mail,
  Wallet,
  LucideIcon,
  ShieldCheck,
  Boxes,
  ShieldAlert,
  Activity,
  Undo2,
  ClipboardCheck,
} from "lucide-react";
import { useAuth, AppRole } from "@/hooks/useAuth";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import { useLabTreasuryApprovals } from "@/hooks/useLabTreasuryApprovals";
import { useUnreadInternalMessages } from "@/hooks/useUnreadInternalMessages";
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
      { icon: BookOpen, label: "دليل الموظف السريع", path: "/quick-guide", roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'accountant', 'warehouse_supervisor', 'production_manager', 'marketing_sales_manager', 'financial_manager', 'quality_manager', 'farm_manager', 'hatchery_manager', 'brooding_manager', 'slaughterhouse_manager', 'meat_factory_manager', 'feed_factory_manager', 'hr_manager', 'shipping_company', 'private_delivery_rep'] },
      { icon: TrendingUp, label: "لوحة تحكم المدير التنفيذي", path: "/executive-dashboard", roles: ['general_manager', 'executive_manager'] },
      { icon: BookOpen, label: "دليل تشغيل الموظفين", path: "/operations-guide", roles: ['general_manager', 'executive_manager', 'hatchery_manager', 'farm_manager', 'brooding_manager', 'feed_factory_manager', 'meat_factory_manager', 'warehouse_supervisor', 'sales_manager', 'sales_moderator', 'marketing_sales_manager', 'production_manager'] },
      { icon: LayoutDashboard, label: "لوحة التحكم", path: "/", roles: ['general_manager', 'executive_manager', 'marketing_sales_manager', 'financial_manager', 'production_manager'] },
      { icon: TrendingUp, label: "اللوحات التنفيذية", path: "/executive-dashboards", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager', 'financial_manager', 'accountant'] },
      { icon: Network, label: "الهيكل التنظيمي", path: "/org-chart", roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'production_manager', 'marketing_sales_manager', 'financial_manager', 'quality_manager', 'farm_manager', 'hatchery_manager', 'brooding_manager', 'slaughterhouse_manager', 'meat_factory_manager', 'feed_factory_manager', 'hr_manager'] },
      { icon: Bell, label: "الإشعارات", path: "/notifications", roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'warehouse_supervisor', 'production_manager', 'marketing_sales_manager', 'financial_manager', 'quality_manager'] },
      { icon: AlertTriangle, label: "طلبات التصحيح", path: "/correction-requests", roles: ['general_manager','executive_manager','slaughterhouse_manager','farm_manager','hatchery_manager','brooding_manager','meat_factory_manager','feed_factory_manager','production_manager','quality_manager'] },
      { icon: ScrollText, label: "سجل تدقيق حالات الطلبات", path: "/order-status-audit", roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'financial_manager', 'marketing_sales_manager'] },
      { icon: MessageSquare, label: "إرسال رسالة داخلية", path: "/send-message", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager', 'financial_manager', 'accountant'] },
    ],
  },
  {
    id: "internal-messages",
    icon: Mail,
    label: "الرسائل الداخلية",
    roles: ['general_manager','executive_manager','sales_manager','sales_moderator','accountant','warehouse_supervisor','farm_manager','hatchery_manager','brooding_manager','slaughterhouse_manager','meat_factory_manager','feed_factory_manager','hr_manager','production_manager','marketing_sales_manager','financial_manager','quality_manager','shipping_company','private_delivery_rep','agouza_warehouse_keeper','brooding_dashboard_viewer','lab_treasury_keeper','lab_external_collector','lab_treasury_approver','slaughterhouse_custody_keeper'],
    items: [
      { icon: Mail, label: "الرسائل الداخلية", path: "/internal-messages", roles: ['general_manager','executive_manager','sales_manager','sales_moderator','accountant','warehouse_supervisor','farm_manager','hatchery_manager','brooding_manager','slaughterhouse_manager','meat_factory_manager','feed_factory_manager','hr_manager','production_manager','marketing_sales_manager','financial_manager','quality_manager','shipping_company','private_delivery_rep','agouza_warehouse_keeper','brooding_dashboard_viewer','lab_treasury_keeper','lab_external_collector','lab_treasury_approver','slaughterhouse_custody_keeper'] },
    ],
  },
  {
    id: "sales",
    icon: Megaphone,
    label: "1. التسويق والمبيعات",
    roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'accountant', 'warehouse_supervisor', 'marketing_sales_manager', 'financial_manager', 'quality_manager'],
    items: [
      { icon: Package, label: "المنتجات", path: "/products", roles: ['general_manager', 'executive_manager', 'sales_manager', 'warehouse_supervisor', 'marketing_sales_manager', 'quality_manager'] },
      { icon: Calculator, label: "تكاليف المنتجات وهامش الربح", path: "/product-costs", roles: ['general_manager', 'executive_manager', 'accountant', 'financial_manager'] },
      { icon: ShoppingCart, label: "الطلبات", path: "/orders", roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'accountant', 'warehouse_supervisor', 'marketing_sales_manager', 'financial_manager', 'quality_manager'] },
      { icon: Bird, label: "طلبات الكتاكيت", path: "/chick-orders", roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager', 'accountant', 'financial_manager'] },
      { icon: ShieldAlert, label: "موافقات تكرار الطلبات", path: "/duplicate-order-approvals", roles: ['marketing_sales_manager'] },
      { icon: Users, label: "العملاء", path: "/customers", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager'] },
      { icon: Gift, label: "صناديق العروض", path: "/offer-boxes", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager'] },
      { icon: Target, label: "التارجت", path: "/sales-targets", roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager'] },
      { icon: UsersRound, label: "أداء الفريق", path: "/team-performance", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager'] },
      { icon: UserCheck, label: "أداء الموديراتور", path: "/moderator-performance", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager'] },
      { icon: BarChart3, label: "التقارير", path: "/reports", roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'marketing_sales_manager', 'financial_manager', 'quality_manager'] },
      { icon: TrendingUp, label: "تحليل الأداء اليومي وخطة الشهر", path: "/sales/daily-performance-analysis", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager', 'financial_manager', 'accountant'] },
      { icon: Wallet, label: "التقارير المالية", path: "/financial-reports", roles: ['general_manager', 'executive_manager', 'accountant', 'financial_manager', 'sales_manager'] },
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
      { icon: AlertTriangle, label: "الهالك / المكسور", path: "/farm-egg-waste", roles: ['general_manager', 'executive_manager', 'farm_manager', 'production_manager', 'quality_manager'] },
      { icon: Upload, label: "استيراد سجل الإنتاج (Excel)", path: "/farm-production-import", roles: ['general_manager'] },
    ],
  },
  {
    id: "hatchery",
    icon: FlaskConical,
    label: "3. المعمل وتفريغ الكتاكيت",
    roles: ['general_manager', 'executive_manager', 'hatchery_manager', 'farm_manager', 'production_manager', 'quality_manager', 'accountant', 'financial_manager', 'lab_treasury_keeper', 'lab_treasury_approver', 'lab_external_collector'],
    items: [
      { icon: FlaskConical, label: "معمل التفريخ والحضانات", path: "/modules/hatchery-lab", roles: ['general_manager', 'executive_manager', 'hatchery_manager', 'production_manager', 'quality_manager', 'accountant'] },
      { icon: Upload, label: "استيراد دفعات المعمل", path: "/hatchery/import-batches", roles: ['general_manager', 'executive_manager', 'hatchery_manager', 'farm_manager', 'production_manager'] },
      { icon: ClipboardCheck, label: "مراجعة دفعات المعمل المستوردة", path: "/hatchery/import-batches/review", roles: ['general_manager', 'executive_manager', 'hatchery_manager', 'farm_manager', 'production_manager'] },
      { icon: ClipboardCheck, label: "تسوية حسابات عملاء المعمل", path: "/hatchery/customer-reconciliation", roles: ['general_manager', 'executive_manager', 'hatchery_manager', 'farm_manager', 'production_manager'] },
      { icon: Wallet, label: "خزنة المعمل والحضانات", path: "/lab-treasury", roles: ['general_manager', 'executive_manager', 'accountant', 'financial_manager', 'lab_treasury_keeper', 'lab_treasury_approver'] },
      { icon: Wallet, label: "مستحقات خزنة المعمل عند المجزر", path: "/lab-treasury/historical-receivables", roles: ['general_manager', 'executive_manager', 'lab_treasury_keeper', 'lab_treasury_approver', 'lab_external_collector', 'slaughterhouse_manager', 'slaughterhouse_custody_keeper'] },
      { icon: Wallet, label: "كشف حساب عملاء المعمل", path: "/lab-treasury/customer-statement", roles: ['general_manager', 'executive_manager', 'accountant', 'financial_manager', 'lab_treasury_keeper'] },
      { icon: Wallet, label: "أرصدة عملاء معمل التفريخ", path: "/lab-treasury/customer-balances", roles: ['general_manager', 'executive_manager', 'accountant', 'financial_manager', 'lab_treasury_keeper'] },
      { icon: Wallet, label: "تحصيلاتي لخزنة المعمل", path: "/my-lab-collections", roles: ['lab_external_collector'] },
      // الصفحات القديمة متاحة للمدير العام فقط للمراجعة (الـ Routes لا تزال تعمل)
      { icon: FlaskConical, label: "إدارة المعمل (أرشيف)", path: "/hatchery", roles: ['general_manager'] },
      { icon: Wallet, label: "دفعات عملاء المعمل (أرشيف)", path: "/hatchery/payments", roles: ['general_manager'] },
      { icon: TrendingUp, label: "لوحة المزرعة والمعمل (أرشيف)", path: "/modules/farm-hatchery-dashboard", roles: ['general_manager'] },
      { icon: TrendingUp, label: "سجل وارد المزرعة (أرشيف)", path: "/farm-shipments-log", roles: ['general_manager'] },
    ],
  },
  {
    id: "brooding",
    icon: Bird,
    label: "4. التحضين والتسمين",
    roles: ['general_manager', 'executive_manager', 'brooding_manager', 'brooding_dashboard_viewer'],
    items: [
      { icon: Bird, label: "لوحة التحضين والتسمين", path: "/modules/brooding", roles: ['general_manager', 'executive_manager', 'brooding_manager', 'brooding_dashboard_viewer'] },
    ],
  },
  {
    id: "slaughterhouse",
    icon: Beef,
    label: "5. المجزر وإنتاج اللحوم",
    roles: ['general_manager', 'executive_manager', 'slaughterhouse_manager', 'production_manager', 'quality_manager', 'slaughterhouse_custody_keeper', 'lab_treasury_approver'],
    items: [
      { icon: Beef, label: "إدارة المجزر", path: "/modules/slaughterhouse", roles: ['general_manager', 'executive_manager', 'slaughterhouse_manager', 'production_manager', 'quality_manager'] },
      { icon: Beef, label: "إذن ذبح النعام", path: "/modules/slaughterhouse/permit", roles: ['general_manager', 'executive_manager', 'slaughterhouse_manager', 'production_manager', 'quality_manager'] },
      { icon: Package, label: "مخزن التغليف والتعبئة", path: "/modules/packaging", roles: ['general_manager', 'executive_manager', 'slaughterhouse_manager'] },
      { icon: Wallet, label: "خزنة عهدة المجزر — محمد شعلة", path: "/slaughterhouse-custody", roles: ['general_manager', 'executive_manager', 'slaughterhouse_manager', 'lab_treasury_approver', 'slaughterhouse_custody_keeper'] },
      { icon: Wheat, label: "مخزن علف المجزر — علف النعام التسمين", path: "/modules/slaughterhouse/feed-store", roles: ['general_manager', 'executive_manager', 'slaughterhouse_manager', 'warehouse_supervisor', 'feed_factory_manager', 'production_manager'] },
    ],
  },
  {
    id: "meat-factory",
    icon: Factory,
    label: "6. مصنع اللحوم",
    roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager', 'accountant', 'financial_manager', 'warehouse_supervisor'],
    items: [
      { icon: Factory, label: "لوحة مصنع اللحوم", path: "/meat-factory/dashboard", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager', 'accountant', 'financial_manager'] },
      { icon: Factory, label: "تصنيع المنتجات", path: "/modules/meat-factory", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager'] },
      { icon: Beef, label: "مخازن مصنع اللحوم", path: "/meat-factory/factory-warehouses", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'financial_manager', 'warehouse_supervisor', 'accountant'] },
      { icon: Factory, label: "فواتير التصنيع", path: "/meat-factory/manufacturing", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager'] },
      { icon: Package, label: "مخزن التغليف والتعبئة", path: "/modules/packaging", roles: ['general_manager', 'executive_manager', 'meat_factory_manager'] },
    ],
  },
  {
    id: "feed-factory",
    icon: Wheat,
    label: "7. مصنع الأعلاف",
    roles: ['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager', 'accountant', 'financial_manager', 'warehouse_supervisor'],
    items: [
      { icon: Wheat, label: "تصنيع الأعلاف", path: "/modules/feed-factory", roles: ['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager'] },
      { icon: Wheat, label: "لوحة مصنع الأعلاف", path: "/feed-factory/dashboard", roles: ['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager', 'accountant', 'financial_manager'] },
      { icon: Warehouse, label: "مخازن المصنع — خامات/جاهز/شراء/بيع/جرد", path: "/feed-factory/warehouses", roles: ['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'financial_manager', 'warehouse_supervisor'] },
      { icon: Wheat, label: "تقرير توزيع الأعلاف الشهري", path: "/feed-factory/monthly-report", roles: ['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'accountant', 'financial_manager', 'warehouse_supervisor'] },
      { icon: Wallet, label: "حسابات الأقسام مع مصنع العلف", path: "/feed-factory/internal-accounts", roles: ['general_manager', 'executive_manager', 'feed_factory_manager', 'accountant', 'financial_manager', 'brooding_manager', 'slaughterhouse_manager', 'production_manager'] },
      { icon: Warehouse, label: "الأرصدة الافتتاحية لمخازن العلف", path: "/feed-factory/opening-balances", roles: ['general_manager', 'executive_manager', 'feed_factory_manager', 'accountant', 'financial_manager'] },
      
      
      { icon: Factory, label: "نظرة عامة على المصانع", path: "/factories/overview", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'feed_factory_manager', 'production_manager', 'accountant', 'financial_manager'] },
      { icon: Factory, label: "تقارير المصانع", path: "/factories/reports", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'feed_factory_manager', 'production_manager', 'accountant', 'financial_manager', 'quality_manager'] },
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
    roles: ['general_manager', 'executive_manager', 'warehouse_supervisor', 'production_manager', 'quality_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager', 'agouza_warehouse_keeper', 'meat_factory_manager', 'feed_factory_manager', 'slaughterhouse_manager', 'accountant', 'financial_manager'],
    items: [
      // نظرة عامة للمبيعات (قراءة فقط للمتاح)
      { icon: Warehouse, label: "المتاح في المخازن", path: "/warehouse-stock", roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager', 'warehouse_supervisor'] },
      // المخازن الأساسية — كل مخزن مستقل، كل موظف يرى مخزنه فقط
      { icon: Warehouse, label: "المخزن الرئيسي", path: "/warehouse-stock/main", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor'] },
      { icon: Activity, label: "سجل حركات المخزن الرئيسي", path: "/main-warehouse-activity", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor'] },
      { icon: Warehouse, label: "مخزن العجوزة", path: "/warehouse-stock/agouza", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor', 'agouza_warehouse_keeper'] },
      { icon: Package, label: "مخزن التغليف والتعبئة", path: "/modules/packaging", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor', 'meat_factory_manager', 'slaughterhouse_manager', 'production_manager'] },
      // مخازن العملاء — للإدارة وأمناء المخازن فقط
      { icon: Warehouse, label: "هايبر هيلثي تيست", path: "/warehouse-stock/hyper-healthy-test", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor'] },
      { icon: Warehouse, label: "هايبر كارفور", path: "/warehouse-stock/hyper-carrefour", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor'] },
      { icon: Wallet, label: "تحصيل المندوب الخاص", path: "/private-delivery-collection", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor', 'accountant', 'financial_manager'] },
      // تنبيهات وتشغيل
      { icon: AlertTriangle, label: "مخزون منخفض", path: "/low-stock", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor', 'production_manager'] },
      { icon: ClipboardList, label: "قائمة التصنيع", path: "/manufacturing-queue", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor', 'production_manager'] },
      { icon: History, label: "سجل تزويد المخزون", path: "/stock-replenishment-log", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor'] },
      // أدوات إدارية متقدمة — للمدير العام/التنفيذي فقط
      { icon: Warehouse, label: "إدارة المخازن", path: "/modules/warehouses", roles: ['general_manager', 'executive_manager'] },
      { icon: ShieldCheck, label: "مركز مراجعة المدير", path: "/manager-review", roles: ['general_manager', 'executive_manager'] },
      { icon: Boxes, label: "محرك المخزون", path: "/inventory", roles: ['general_manager', 'executive_manager'] },
      { icon: ShieldCheck, label: "مطابقة المخزون (تخطيط)", path: "/stock-reconciliation", roles: ['general_manager', 'executive_manager'] },
      { icon: ShieldCheck, label: "اعتماد وصفات الإنتاج (BOM)", path: "/bom-approval", roles: ['general_manager', 'executive_manager', 'accountant', 'financial_manager'] },
      { icon: Factory, label: "دفعات مصنع اللحوم", path: "/meat-factory/batches", roles: ['general_manager', 'executive_manager'] },
      { icon: Wheat, label: "دفعات مصنع الأعلاف", path: "/feed-factory/batches", roles: ['general_manager', 'executive_manager'] },
    ],
  },
  {
    id: "private-delivery",
    icon: Truck,
    label: "10. المندوب الخاص وخطوط السير",
    roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'marketing_sales_manager', 'warehouse_supervisor', 'private_delivery_rep', 'sales_moderator'],
    items: [
      { icon: Truck, label: "لوحة المندوب الخاص", path: "/private-courier", roles: ['general_manager','executive_manager','sales_manager','marketing_sales_manager','accountant','warehouse_supervisor','private_delivery_rep'] },
      { icon: ShoppingCart, label: "تخطيط الخطوط والتعيين", path: "/private-courier/planning", roles: ['general_manager','executive_manager','sales_manager','marketing_sales_manager'] },
      { icon: Truck, label: "إدارة خطوط السير", path: "/private-courier/routes", roles: ['general_manager','executive_manager','sales_manager','marketing_sales_manager'] },
      { icon: ShoppingCart, label: "طلباتي (مندوب)", path: "/private-courier/my-deliveries", roles: ['private_delivery_rep'] },
      { icon: Package, label: "تسليم المخزن", path: "/private-courier/handovers", roles: ['general_manager','executive_manager','warehouse_supervisor','sales_manager'] },
      { icon: ShoppingCart, label: "تقرير التحصيل", path: "/private-courier/collections", roles: ['general_manager','executive_manager','sales_manager','accountant'] },
      { icon: ShoppingCart, label: "طلباتي (قديم)", path: "/orders", roles: ['private_delivery_rep'] },
      { icon: Truck, label: "خطوط السير (قديم)", path: "/delivery-routes", roles: ['general_manager', 'executive_manager', 'private_delivery_rep'] },
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
  const { role, roles, profile } = useAuth();
  const { unreadCount } = useUnreadNotifications();
  const { total: labApprovalsCount } = useLabTreasuryApprovals();
  const { unreadCount: unreadInternalMessages } = useUnreadInternalMessages();
  // Sales moderators now use the same /orders page as managers (RLS scopes
  // them to their own rows). The previous override sent them to a stripped-
  // down log view, which the user explicitly asked to remove.
  const ordersPathOverride: string | null = null;

  const userRoles: AppRole[] = roles && roles.length > 0 ? roles : (role ? [role] : []);
  const hasAnyRole = (allowed: AppRole[]) => userRoles.some((r) => allowed.includes(r));

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
      items: section.items.filter((item) => hasAnyRole(item.roles)),
    }))
    .filter((section) => hasAnyRole(section.roles) && section.items.length > 0);

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
                  const showLabBadge = item.path === "/lab-treasury" && labApprovalsCount > 0;
                  const showInternalMsgBadge = item.path === "/internal-messages" && unreadInternalMessages > 0;
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
                      {showLabBadge && (
                        <Badge className="h-5 min-w-5 px-1.5 text-xs bg-amber-500 hover:bg-amber-600">
                          {labApprovalsCount > 99 ? "99+" : labApprovalsCount}
                        </Badge>
                      )}
                      {showInternalMsgBadge && (
                        <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-xs">
                          {unreadInternalMessages > 99 ? "99+" : unreadInternalMessages}
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
