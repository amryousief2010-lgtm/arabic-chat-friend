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
  FileText,
  KeyRound,
  Receipt,
  MapPin,
  CalendarClock,
  ArrowLeftRight,
  Tag,
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
  /** Optional sub-group label. Items sharing the same group label appear inside a nested collapsible. */
  group?: string;
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
      // مخفي من السايد بار فقط - الرابط والصفحة والصلاحيات تعمل عند الفتح المباشر
      // { icon: TrendingUp, label: "اللوحات التنفيذية", path: "/executive-dashboards", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager', 'financial_manager', 'accountant'] },
      { icon: Network, label: "الهيكل التنظيمي", path: "/org-chart", roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'production_manager', 'marketing_sales_manager', 'financial_manager', 'quality_manager', 'farm_manager', 'hatchery_manager', 'brooding_manager', 'slaughterhouse_manager', 'meat_factory_manager', 'feed_factory_manager', 'hr_manager'] },
      { icon: Bell, label: "الإشعارات", path: "/notifications", roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'warehouse_supervisor', 'production_manager', 'marketing_sales_manager', 'financial_manager', 'quality_manager'] },
      { icon: AlertTriangle, label: "طلبات التصحيح", path: "/correction-requests", roles: ['general_manager','executive_manager','slaughterhouse_manager','farm_manager','hatchery_manager','brooding_manager','meat_factory_manager','feed_factory_manager','production_manager','quality_manager'] },
      { icon: ScrollText, label: "سجل تدقيق حالات الطلبات", path: "/order-status-audit", roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'financial_manager', 'marketing_sales_manager'] },
      { icon: MessageSquare, label: "إرسال رسالة داخلية", path: "/send-message", roles: ['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager', 'financial_manager', 'accountant'] },
    ],
  },
  {
    id: "management",
    icon: BarChart3,
    label: "الإدارة والتقارير",
    roles: ['general_manager', 'executive_manager', 'accountant', 'financial_manager'],
    items: [
      { icon: Wallet, label: "الميزانية الشهرية للأقسام", path: "/modules/department-monthly-budget", roles: ['general_manager', 'executive_manager', 'accountant', 'financial_manager'] },
      { icon: Wallet, label: "التقارير المالية", path: "/financial-reports", roles: ['general_manager', 'executive_manager', 'accountant', 'financial_manager', 'sales_manager'] },
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
      { icon: Tag, label: "الأسعار الداخلية بين الأقسام", path: "/modules/internal-prices-settings", roles: ['general_manager', 'executive_manager', 'financial_manager', 'slaughterhouse_manager', 'production_manager'] },
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
      { icon: Wallet, label: "كشف حساب العملاء", path: "/lab-treasury/customer-statement", roles: ['general_manager', 'executive_manager', 'brooding_manager', 'accountant', 'financial_manager', 'lab_treasury_keeper'] },
      { icon: Wallet, label: "أرصدة العملاء", path: "/lab-treasury/customer-balances", roles: ['general_manager', 'executive_manager', 'brooding_manager', 'accountant', 'financial_manager', 'lab_treasury_keeper'] },
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
      { icon: ShieldCheck, label: "الخزنة الرئيسية للشركة — أ. محمد شعلة", path: "/main-treasury", roles: ['general_manager', 'executive_manager', 'financial_manager', 'main_treasury_accountant' as any, 'main_treasury_approver' as any] },
      { icon: Wheat, label: "مخزن علف المجزر — علف النعام التسمين", path: "/modules/slaughterhouse/feed-store", roles: ['general_manager', 'executive_manager', 'slaughterhouse_manager', 'warehouse_supervisor', 'feed_factory_manager', 'production_manager'] },
      { icon: Beef, label: "تكلفة النعام الجاهز للدبح", path: "/modules/slaughterhouse/live-batch-costs", roles: ['general_manager', 'executive_manager', 'slaughterhouse_manager', 'production_manager', 'accountant', 'financial_manager'] },
      
    ],
  },
  {
    id: "meat-factory",
    icon: Factory,
    label: "6. مصنع اللحوم",
    roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager', 'accountant', 'financial_manager', 'warehouse_supervisor'],
    items: [
      // لوحة التحكم
      { group: "لوحة التحكم", icon: Factory, label: "لوحة مصنع اللحوم", path: "/meat-factory/dashboard", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager', 'accountant', 'financial_manager'] },
      { group: "لوحة التحكم", icon: Factory, label: "لوحة المشتريات والتصنيع (متقدم)", path: "/meat-factory/overview-dashboard", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'accountant', 'financial_manager', 'warehouse_supervisor'] },
      // التصنيع والتشغيل
      { group: "التصنيع والتشغيل", icon: Factory, label: "فاتورة تصنيع / سجل الفواتير", path: "/meat-factory/manufacturing", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager'] },
      { group: "التصنيع والتشغيل", icon: Factory, label: "تركيبات التصنيع (مرجع)", path: "/meat-factory/recipes", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager', 'accountant', 'financial_manager'] },
      { group: "التصنيع والتشغيل", icon: Factory, label: "تصنيع المنتجات (شاشة قديمة)", path: "/modules/meat-factory", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager'] },
      // مخزون المصنع
      { group: "مخزون المصنع", icon: Boxes, label: "مخزون خامات مصنع اللحوم (موسّع)", path: "/meat-factory/raw-inventory", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'financial_manager', 'warehouse_supervisor', 'accountant', 'quality_manager'] },
      { group: "مخزون المصنع", icon: Beef, label: "مخازن مصنع اللحوم (خامات/بهارات/تغليف)", path: "/meat-factory/factory-warehouses", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'financial_manager', 'warehouse_supervisor', 'accountant'] },
      { group: "مخزون المصنع", icon: Package, label: "مخزن مواد التغليف والتعبئة", path: "/meat-factory/packaging-inventory", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'warehouse_supervisor', 'accountant', 'financial_manager'] },
      // المشتريات والموردين
      { group: "المشتريات والموردين", icon: ShoppingCart, label: "فواتير مشتريات مصنع اللحوم", path: "/meat-factory/purchase-invoices", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'warehouse_supervisor', 'accountant', 'financial_manager'] },
      // التقارير
      { group: "التقارير", icon: FileText, label: "تقارير مصنع اللحوم (وارد/صرف/إنتاج/مخزون)", path: "/meat-factory/reports", roles: ['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'accountant', 'financial_manager', 'warehouse_supervisor', 'quality_manager'] },
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
      { icon: MapPin, label: "المخازن حسب الموقع الجغرافي", path: "/modules/warehouses/by-location", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor', 'production_manager', 'agouza_warehouse_keeper', 'meat_factory_manager', 'feed_factory_manager', 'slaughterhouse_manager'] },
      { icon: CalendarClock, label: "تواريخ بداية التشغيل الفعلي", path: "/modules/warehouses/operational-dates", roles: ['general_manager', 'executive_manager'] },
      { icon: Package, label: "الرصيد الافتتاحي للمخازن", path: "/modules/warehouses/opening-balance", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor'] },
      { icon: BookOpen, label: "دليل تشغيل المخزن الرئيسي", path: "/warehouse-stock/main/guide", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor', 'agouza_warehouse_keeper'] },
      { icon: Activity, label: "سجل حركات المخازن الموحد", path: "/modules/warehouses/movements-log", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor', 'agouza_warehouse_keeper', 'accountant', 'financial_manager'] },
      { icon: ArrowLeftRight, label: "التحويلات المعلقة", path: "/modules/warehouses/pending-transfers", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor', 'agouza_warehouse_keeper'] },
      { icon: ClipboardList, label: "الجرد والتسويات", path: "/modules/warehouses/stocktaking", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor'] },
      { icon: BarChart3, label: "تقارير المخازن", path: "/modules/warehouses/reports", roles: ['general_manager', 'executive_manager', 'warehouse_supervisor', 'accountant', 'financial_manager'] },
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
    id: "social-media",
    icon: Megaphone,
    label: "11. السوشيال ميديا",
    roles: ['general_manager', 'executive_manager', 'marketing_sales_manager', 'social_media_manager'],
    items: [
      { icon: ShoppingCart, label: "مراجعة الطلبات (قراءة فقط)", path: "/orders", roles: ['social_media_manager'] },
      { icon: ClipboardList, label: "تقرير السوشيال ميديا اليومي", path: "/social-media/daily", roles: ['general_manager', 'executive_manager', 'marketing_sales_manager', 'social_media_manager'] },
      { icon: ClipboardList, label: "تقرير السوشيال ميديا الأسبوعي", path: "/social-media/weekly", roles: ['general_manager', 'executive_manager', 'marketing_sales_manager', 'social_media_manager'] },
      { icon: History, label: "تقاريري السابقة", path: "/social-media/my-reports", roles: ['social_media_manager'] },
      { icon: ShieldCheck, label: "مراجعة تقارير السوشيال ميديا", path: "/social-media/review", roles: ['general_manager', 'executive_manager', 'marketing_sales_manager'] },
    ],
  },
  {
    id: "hr",
    icon: UsersRound,
    label: "شؤون الموظفين",
    roles: ['general_manager', 'executive_manager', 'hr_manager', 'accountant', 'financial_manager'],
    items: [
      { icon: LayoutDashboard, label: "لوحة شؤون الموظفين", path: "/hr", roles: ['general_manager', 'executive_manager', 'hr_manager'] },
      { icon: UsersRound, label: "بيانات الموظفين", path: "/hr/employees", roles: ['general_manager', 'executive_manager', 'accountant'] },
      { icon: Network, label: "أماكن العمل والأقسام", path: "/hr/work-locations", roles: ['general_manager', 'executive_manager', 'hr_manager'] },
      { icon: Receipt, label: "تقرير سلف الموظفين", path: "/hr/advances-report", roles: ['general_manager', 'executive_manager', 'hr_manager', 'accountant', 'financial_manager'] },
      { icon: Receipt, label: "خصومات الموظفين", path: "/hr/deductions", roles: ['general_manager', 'executive_manager', 'hr_manager', 'accountant', 'financial_manager'] },
      { icon: KeyRound, label: "حسابات دخول الموظفين", path: "/modules/hr", roles: ['general_manager', 'executive_manager'] },
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
                {(() => {
                  // If any item has a `group`, render grouped collapsibles; otherwise flat.
                  const hasGroups = section.items.some((i) => i.group);
                  const renderLink = (item: MenuItem) => {
                    const targetPath = ordersPathOverride && item.path === "/orders" ? ordersPathOverride : item.path;
                    const isActive = location.pathname === targetPath;
                    const showBadge = item.path === "/notifications" && unreadCount > 0;
                    const showLabBadge = item.path === "/lab-treasury" && labApprovalsCount > 0;
                    const showInternalMsgBadge = item.path === "/internal-messages" && unreadInternalMessages > 0;
                    return (
                      <Link
                        key={item.path + item.label}
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
                  };

                  if (!hasGroups) return section.items.map(renderLink);

                  // Build ordered groups preserving first-occurrence order.
                  const groupOrder: string[] = [];
                  const groupMap = new Map<string, MenuItem[]>();
                  for (const it of section.items) {
                    const g = it.group || "أخرى";
                    if (!groupMap.has(g)) { groupMap.set(g, []); groupOrder.push(g); }
                    groupMap.get(g)!.push(it);
                  }
                  return groupOrder.map((g) => {
                    const groupItems = groupMap.get(g)!;
                    const groupKey = `${section.id}::${g}`;
                    const groupHasActive = groupItems.some((i) => i.path === location.pathname);
                    const groupOpen = openSections[groupKey] ?? groupHasActive;
                    return (
                      <Collapsible
                        key={groupKey}
                        open={groupOpen}
                        onOpenChange={() => toggleSection(groupKey)}
                      >
                        <CollapsibleTrigger
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors text-right ${
                            groupHasActive ? "bg-sidebar-accent/70 text-sidebar-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/40"
                          }`}
                        >
                          <span className="flex-1 text-right">{g}</span>
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${groupOpen ? "rotate-180" : ""}`} />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                          <div className="mt-1 mr-2 space-y-1 border-r border-sidebar-border/60 pr-2">
                            {groupItems.map(renderLink)}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  });
                })()}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </nav>
  );
};
