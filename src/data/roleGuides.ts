import type { AppRole } from "@/hooks/useAuth";
import {
  ShoppingCart,
  Package,
  Users,
  Bell,
  Target,
  Gift,
  BarChart3,
  Egg,
  Bird,
  FlaskConical,
  Beef,
  Wheat,
  Warehouse,
  Factory,
  UsersRound,
  ClipboardList,
  AlertTriangle,
  LayoutDashboard,
  History,
  TrendingUp,
  UserCheck,
  Truck,
  Settings,
  Network,
  type LucideIcon,
} from "lucide-react";

export type TaskCadence = "daily" | "weekly";

export type GuideLink = {
  label: string;
  path: string;
  icon: LucideIcon;
  desc: string;
  cadence?: TaskCadence; // default daily
};

export type RoleGuide = {
  role: AppRole;
  title: string;
  summary: string;
  color: string;
  links: GuideLink[];
};

export const ROLE_GUIDES: RoleGuide[] = [
  {
    role: "general_manager",
    title: "المدير العام",
    summary: "وصول كامل لجميع وحدات النظام، التقارير، الإعدادات، واستيراد البيانات.",
    color: "from-purple-500 to-orange-500",
    links: [
      { label: "لوحة التحكم", path: "/", icon: LayoutDashboard, desc: "نظرة عامة على المؤشرات" },
      { label: "اللوحات التنفيذية", path: "/executive-dashboards", icon: TrendingUp, desc: "تحليلات تنفيذية شاملة", cadence: "weekly" },
      { label: "الطلبات", path: "/orders", icon: ShoppingCart, desc: "إدارة كل الطلبات" },
      { label: "الموظفون", path: "/employees", icon: UsersRound, desc: "إدارة الحسابات والصلاحيات", cadence: "weekly" },
      { label: "الإعدادات", path: "/settings", icon: Settings, desc: "إعدادات النظام", cadence: "weekly" },
      { label: "استيراد البيانات", path: "/import-sales", icon: ClipboardList, desc: "استيراد ملفات Excel", cadence: "weekly" },
    ],
  },
  {
    role: "executive_manager",
    title: "المدير التنفيذي",
    summary: "متابعة شاملة لجميع الأقسام، التقارير التنفيذية، وأداء الفرق.",
    color: "from-purple-500 to-purple-700",
    links: [
      { label: "لوحة التحكم", path: "/", icon: LayoutDashboard, desc: "نظرة عامة" },
      { label: "اللوحات التنفيذية", path: "/executive-dashboards", icon: TrendingUp, desc: "تحليلات تنفيذية" },
      { label: "الطلبات", path: "/orders", icon: ShoppingCart, desc: "متابعة الطلبات" },
      { label: "التقارير", path: "/reports", icon: BarChart3, desc: "تقارير المبيعات", cadence: "weekly" },
      { label: "أداء الفريق", path: "/team-performance", icon: UsersRound, desc: "متابعة الموظفين", cadence: "weekly" },
      { label: "الهيكل التنظيمي", path: "/org-chart", icon: Network, desc: "هيكل الشركة", cadence: "weekly" },
    ],
  },
  {
    role: "sales_manager",
    title: "مدير المبيعات",
    summary: "إدارة الطلبات والعملاء، متابعة الموديراتور، وضع الأهداف، وعروض الصناديق.",
    color: "from-orange-500 to-orange-700",
    links: [
      { label: "الطلبات", path: "/orders", icon: ShoppingCart, desc: "إدارة كل الطلبات" },
      { label: "العملاء", path: "/customers", icon: Users, desc: "إدارة بيانات العملاء" },
      { label: "أهداف المبيعات", path: "/sales-targets", icon: Target, desc: "تتبع الأهداف الشهرية", cadence: "weekly" },
      { label: "صناديق العروض", path: "/offer-boxes", icon: Gift, desc: "إنشاء وإدارة العروض", cadence: "weekly" },
      { label: "أداء الموديراتور", path: "/moderator-performance", icon: UserCheck, desc: "متابعة كل موديراتور", cadence: "weekly" },
      { label: "التقارير", path: "/reports", icon: BarChart3, desc: "تقارير المبيعات", cadence: "weekly" },
    ],
  },
  {
    role: "sales_moderator",
    title: "موديراتور المبيعات",
    summary: "إنشاء الطلبات اليومية، متابعة طلباتك الخاصة، وتحقيق التارجت الشهري.",
    color: "from-orange-500 to-purple-500",
    links: [
      { label: "طلب جديد", path: "/orders/new", icon: ShoppingCart, desc: "إنشاء طلب لعميل" },
      { label: "طلباتي", path: "/orders", icon: ShoppingCart, desc: "متابعة طلباتك" },
      { label: "التارجت", path: "/sales-targets", icon: Target, desc: "هدفك الشهري", cadence: "weekly" },
      { label: "صناديق العروض", path: "/offer-boxes", icon: Gift, desc: "العروض المتاحة" },
      { label: "المخزون المنخفض", path: "/low-stock", icon: AlertTriangle, desc: "أصناف على وشك النفاد" },
    ],
  },
  {
    role: "marketing_sales_manager",
    title: "مدير التسويق والمبيعات",
    summary: "متابعة الحملات والعروض، تحليل العملاء، وأداء الفريق.",
    color: "from-purple-500 to-orange-400",
    links: [
      { label: "الطلبات", path: "/orders", icon: ShoppingCart, desc: "متابعة الطلبات" },
      { label: "العملاء", path: "/customers", icon: Users, desc: "قاعدة العملاء" },
      { label: "صناديق العروض", path: "/offer-boxes", icon: Gift, desc: "إدارة العروض", cadence: "weekly" },
      { label: "أهداف المبيعات", path: "/sales-targets", icon: Target, desc: "الأهداف الشهرية", cadence: "weekly" },
      { label: "أداء الفريق", path: "/team-performance", icon: UsersRound, desc: "أداء الموديراتور", cadence: "weekly" },
      { label: "التقارير", path: "/reports", icon: BarChart3, desc: "تقارير شاملة", cadence: "weekly" },
    ],
  },
  {
    role: "accountant",
    title: "المحاسب",
    summary: "متابعة المدفوعات، تحديث حالات الدفع، ومراجعة التقارير المالية.",
    color: "from-emerald-500 to-emerald-700",
    links: [
      { label: "الطلبات", path: "/orders", icon: ShoppingCart, desc: "تحديث حالة الدفع" },
      { label: "التقارير", path: "/reports", icon: BarChart3, desc: "التقارير المالية", cadence: "weekly" },
      { label: "سجل تجديد المخزون", path: "/stock-replenishment-log", icon: History, desc: "حركات المخزون", cadence: "weekly" },
    ],
  },
  {
    role: "financial_manager",
    title: "المدير المالي",
    summary: "إشراف مالي شامل، التقارير، ومراجعة الطلبات والمدفوعات.",
    color: "from-emerald-600 to-purple-600",
    links: [
      { label: "اللوحات التنفيذية", path: "/executive-dashboards", icon: TrendingUp, desc: "مؤشرات مالية" },
      { label: "الطلبات", path: "/orders", icon: ShoppingCart, desc: "مراجعة الطلبات" },
      { label: "التقارير", path: "/reports", icon: BarChart3, desc: "تقارير مالية", cadence: "weekly" },
    ],
  },
  {
    role: "warehouse_supervisor",
    title: "مشرف المخزن",
    summary: "إدارة المخزون، استلام المخرجات من الإنتاج، وتحديث حالات تجهيز الطلبات.",
    color: "from-amber-500 to-orange-600",
    links: [
      { label: "المخازن", path: "/modules/warehouses", icon: Warehouse, desc: "إدارة كل المخازن" },
      { label: "لوحة المخازن", path: "/modules/warehouses/dashboard", icon: LayoutDashboard, desc: "مؤشرات المخزون" },
      { label: "المخزون المنخفض", path: "/low-stock", icon: AlertTriangle, desc: "تنبيهات النفاد" },
      { label: "قائمة التصنيع", path: "/manufacturing-queue", icon: Factory, desc: "ما يحتاج تصنيع" },
      { label: "الطلبات", path: "/orders", icon: ShoppingCart, desc: "تحديث حالة التجهيز" },
    ],
  },
  {
    role: "farm_manager",
    title: "مدير المزرعة",
    summary: "إدارة الأسر، تسجيل إنتاج البيض اليومي، ومتابعة شحنات المعمل.",
    color: "from-green-500 to-emerald-600",
    links: [
      { label: "إدارة المزرعة", path: "/modules/farm", icon: Egg, desc: "الأسر والإنتاج" },
      { label: "لوحة المزرعة-المعمل", path: "/modules/farm-hatchery-dashboard", icon: LayoutDashboard, desc: "نظرة موحدة" },
      { label: "سجل شحنات المزرعة", path: "/farm-shipments-log", icon: Truck, desc: "متابعة الشحنات" },
    ],
  },
  {
    role: "hatchery_manager",
    title: "مدير المعمل (الفقاسة)",
    summary: "استلام شحنات المزرعة، إنشاء دفعات الفقس، ومتابعة نتائج التفقيس.",
    color: "from-yellow-500 to-orange-500",
    links: [
      { label: "المعمل", path: "/modules/hatchery", icon: FlaskConical, desc: "دفعات الفقس" },
      { label: "لوحة المزرعة-المعمل", path: "/modules/farm-hatchery-dashboard", icon: LayoutDashboard, desc: "نظرة موحدة" },
      { label: "سجل شحنات المزرعة", path: "/farm-shipments-log", icon: Truck, desc: "الوارد من المزرعة" },
    ],
  },
  {
    role: "brooding_manager",
    title: "مدير الحضانة",
    summary: "استقبال الكتاكيت بعد الفقس، متابعة النمو، وتسجيل الحركات.",
    color: "from-yellow-400 to-amber-500",
    links: [
      { label: "الحضانة", path: "/modules/brooding", icon: Bird, desc: "إدارة الكتاكيت" },
    ],
  },
  {
    role: "slaughterhouse_manager",
    title: "مدير المجزر",
    summary: "استلام الطيور الحية، إنشاء دفعات الذبح، وتسجيل المخرجات.",
    color: "from-red-500 to-red-700",
    links: [
      { label: "المجزر", path: "/modules/slaughterhouse", icon: Beef, desc: "دفعات الذبح" },
      { label: "تصاريح الذبح", path: "/modules/slaughterhouse/permit", icon: ClipboardList, desc: "إصدار التصاريح" },
    ],
  },
  {
    role: "meat_factory_manager",
    title: "مدير مصنع اللحوم",
    summary: "إدارة دفعات التصنيع، استهلاك المواد، ومتابعة الجودة.",
    color: "from-rose-500 to-rose-700",
    links: [
      { label: "مصنع اللحوم", path: "/modules/meat-factory", icon: Factory, desc: "دفعات التصنيع" },
    ],
  },
  {
    role: "feed_factory_manager",
    title: "مدير مصنع الأعلاف",
    summary: "إدارة الوصفات، الطلبات، صرف المواد الخام، ودفعات الإنتاج.",
    color: "from-lime-500 to-green-600",
    links: [
      { label: "مصنع الأعلاف", path: "/modules/feed-factory", icon: Wheat, desc: "نظرة عامة" },
      { label: "لوحة الأعلاف", path: "/modules/feed-factory/dashboard", icon: LayoutDashboard, desc: "مؤشرات الإنتاج" },
      { label: "الوصفات", path: "/modules/feed-factory/recipes", icon: ClipboardList, desc: "وصفات الأعلاف", cadence: "weekly" },
      { label: "طلبات الإنتاج", path: "/modules/feed-factory/orders", icon: ShoppingCart, desc: "أوامر التصنيع" },
      { label: "صرف المواد", path: "/modules/feed-factory/issues", icon: Truck, desc: "صرف خام للإنتاج" },
    ],
  },
  {
    role: "production_manager",
    title: "مدير الإنتاج",
    summary: "إشراف على جميع وحدات الإنتاج، الجودة، والمخزون.",
    color: "from-blue-500 to-purple-600",
    links: [
      { label: "لوحة التحكم", path: "/", icon: LayoutDashboard, desc: "نظرة عامة" },
      { label: "المزرعة", path: "/modules/farm", icon: Egg, desc: "إنتاج البيض" },
      { label: "المعمل", path: "/modules/hatchery", icon: FlaskConical, desc: "الفقاسة" },
      { label: "المجزر", path: "/modules/slaughterhouse", icon: Beef, desc: "الذبح" },
      { label: "مصنع اللحوم", path: "/modules/meat-factory", icon: Factory, desc: "التصنيع" },
      { label: "المخازن", path: "/modules/warehouses", icon: Warehouse, desc: "المخزون" },
      { label: "قائمة التصنيع", path: "/manufacturing-queue", icon: Factory, desc: "ما يحتاج تصنيع" },
    ],
  },
  {
    role: "quality_manager",
    title: "مدير الجودة",
    summary: "متابعة جودة الإنتاج، فحص الدفعات، والتقارير.",
    color: "from-cyan-500 to-blue-600",
    links: [
      { label: "المزرعة", path: "/modules/farm", icon: Egg, desc: "جودة الإنتاج" },
      { label: "المعمل", path: "/modules/hatchery", icon: FlaskConical, desc: "جودة الفقس" },
      { label: "المجزر", path: "/modules/slaughterhouse", icon: Beef, desc: "جودة الذبح" },
      { label: "مصنع اللحوم", path: "/modules/meat-factory", icon: Factory, desc: "جودة المنتج" },
      { label: "التقارير", path: "/reports", icon: BarChart3, desc: "تقارير الجودة", cadence: "weekly" },
    ],
  },
  {
    role: "hr_manager",
    title: "مدير الموارد البشرية",
    summary: "إدارة الموظفين، الهيكل التنظيمي، ومتابعة الفرق.",
    color: "from-pink-500 to-rose-600",
    links: [
      { label: "الموارد البشرية", path: "/modules/hr", icon: UsersRound, desc: "إدارة الفرق" },
      { label: "الهيكل التنظيمي", path: "/org-chart", icon: Network, desc: "هيكل الشركة", cadence: "weekly" },
    ],
  },
  {
    role: "shipping_company",
    title: "شركة الشحن",
    summary: "استلام الطلبات للتوصيل وتحديث حالات الشحن.",
    color: "from-sky-500 to-blue-600",
    links: [
      { label: "الطلبات", path: "/orders", icon: ShoppingCart, desc: "طلبات للشحن" },
    ],
  },
  {
    role: "private_delivery_rep",
    title: "مندوب التوصيل الخاص",
    summary: "متابعة طلبات التوصيل الخاصة وتحديث حالاتها.",
    color: "from-teal-500 to-cyan-600",
    links: [
      { label: "الطلبات", path: "/orders", icon: ShoppingCart, desc: "طلبات التوصيل" },
    ],
  },
];

export const getGuideForRole = (role?: AppRole | null) =>
  ROLE_GUIDES.find((g) => g.role === role) ?? null;
