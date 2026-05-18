import { useRef, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { ROLE_GUIDES, type RoleGuide } from "@/data/roleGuides";
import { toast } from "sonner";
import {
  BookOpen,
  Package,
  Bell,
  ClipboardList,
  UsersRound,
  UserCheck,
  Network,
  ArrowLeft,
  Sparkles,
  Search,
  Printer,
  Download,
  CheckCircle2,
  RotateCcw,
  CalendarClock,
} from "lucide-react";


const ROLE_GUIDES: RoleGuide[] = [
  {
    role: "general_manager",
    title: "المدير العام",
    summary: "وصول كامل لجميع وحدات النظام، التقارير، الإعدادات، واستيراد البيانات.",
    color: "from-purple-500 to-orange-500",
    links: [
      { label: "لوحة التحكم", path: "/", icon: LayoutDashboard, desc: "نظرة عامة على المؤشرات" },
      { label: "اللوحات التنفيذية", path: "/executive-dashboards", icon: TrendingUp, desc: "تحليلات تنفيذية شاملة" },
      { label: "الطلبات", path: "/orders", icon: ShoppingCart, desc: "إدارة كل الطلبات" },
      { label: "الموظفون", path: "/employees", icon: UsersRound, desc: "إدارة الحسابات والصلاحيات" },
      { label: "الإعدادات", path: "/settings", icon: Settings, desc: "إعدادات النظام" },
      { label: "استيراد البيانات", path: "/import-sales", icon: ClipboardList, desc: "استيراد ملفات Excel" },
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
      { label: "التقارير", path: "/reports", icon: BarChart3, desc: "تقارير المبيعات" },
      { label: "أداء الفريق", path: "/team-performance", icon: UsersRound, desc: "متابعة الموظفين" },
      { label: "الهيكل التنظيمي", path: "/org-chart", icon: Network, desc: "هيكل الشركة" },
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
      { label: "أهداف المبيعات", path: "/sales-targets", icon: Target, desc: "تتبع الأهداف الشهرية" },
      { label: "صناديق العروض", path: "/offer-boxes", icon: Gift, desc: "إنشاء وإدارة العروض" },
      { label: "أداء الموديراتور", path: "/moderator-performance", icon: UserCheck, desc: "متابعة كل موديراتور" },
      { label: "التقارير", path: "/reports", icon: BarChart3, desc: "تقارير المبيعات" },
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
      { label: "التارجت", path: "/sales-targets", icon: Target, desc: "هدفك الشهري" },
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
      { label: "صناديق العروض", path: "/offer-boxes", icon: Gift, desc: "إدارة العروض" },
      { label: "أهداف المبيعات", path: "/sales-targets", icon: Target, desc: "الأهداف الشهرية" },
      { label: "أداء الفريق", path: "/team-performance", icon: UsersRound, desc: "أداء الموديراتور" },
      { label: "التقارير", path: "/reports", icon: BarChart3, desc: "تقارير شاملة" },
    ],
  },
  {
    role: "accountant",
    title: "المحاسب",
    summary: "متابعة المدفوعات، تحديث حالات الدفع، ومراجعة التقارير المالية.",
    color: "from-emerald-500 to-emerald-700",
    links: [
      { label: "الطلبات", path: "/orders", icon: ShoppingCart, desc: "تحديث حالة الدفع" },
      { label: "التقارير", path: "/reports", icon: BarChart3, desc: "التقارير المالية" },
      { label: "سجل تجديد المخزون", path: "/stock-replenishment-log", icon: History, desc: "حركات المخزون" },
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
      { label: "التقارير", path: "/reports", icon: BarChart3, desc: "تقارير مالية" },
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
      { label: "الوصفات", path: "/modules/feed-factory/recipes", icon: ClipboardList, desc: "وصفات الأعلاف" },
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
      { label: "التقارير", path: "/reports", icon: BarChart3, desc: "تقارير الجودة" },
    ],
  },
  {
    role: "hr_manager",
    title: "مدير الموارد البشرية",
    summary: "إدارة الموظفين، الهيكل التنظيمي، ومتابعة الفرق.",
    color: "from-pink-500 to-rose-600",
    links: [
      { label: "الموارد البشرية", path: "/modules/hr", icon: UsersRound, desc: "إدارة الفرق" },
      { label: "الهيكل التنظيمي", path: "/org-chart", icon: Network, desc: "هيكل الشركة" },
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

export default function QuickGuide() {
  const { role, profile, isGeneralManager } = useAuth();
  const printRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [refQuery, setRefQuery] = useState("");
  const [downloading, setDownloading] = useState(false);

  const myGuide = ROLE_GUIDES.find((g) => g.role === role);
  const otherGuides = ROLE_GUIDES.filter((g) => g.role !== role);

  const normalized = query.trim().toLowerCase();
  const filteredLinks = useMemo(() => {
    if (!myGuide) return [];
    if (!normalized) return myGuide.links;
    return myGuide.links.filter(
      (l) =>
        l.label.toLowerCase().includes(normalized) ||
        l.desc.toLowerCase().includes(normalized) ||
        l.path.toLowerCase().includes(normalized),
    );
  }, [myGuide, normalized]);

  const refNormalized = refQuery.trim().toLowerCase();
  const filteredOtherGuides = useMemo(() => {
    if (!refNormalized) return otherGuides;
    return otherGuides
      .map((g) => {
        const matchRole =
          g.title.toLowerCase().includes(refNormalized) ||
          g.summary.toLowerCase().includes(refNormalized) ||
          g.role.toLowerCase().includes(refNormalized);
        const links = g.links.filter(
          (l) =>
            l.label.toLowerCase().includes(refNormalized) ||
            l.desc.toLowerCase().includes(refNormalized),
        );
        if (matchRole) return g;
        if (links.length) return { ...g, links };
        return null;
      })
      .filter(Boolean) as RoleGuide[];
  }, [otherGuides, refNormalized]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = async () => {
    if (!printRef.current || !myGuide) return;
    try {
      setDownloading(true);
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`دليل-${myGuide.title}.pdf`);
      toast.success("تم تحميل الدليل بصيغة PDF");
    } catch (e) {
      console.error(e);
      toast.error("تعذّر إنشاء ملف PDF");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <DashboardLayout>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
      <div className="space-y-6" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">دليل الموظف السريع</h1>
              <p className="text-sm text-muted-foreground">
                صفحاتك اليومية حسب دورك في الشركة — للوصول السريع للمهام المتكررة.
              </p>
            </div>
          </div>
          {myGuide && (
            <div className="flex gap-2 no-print">
              <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
                <Printer className="w-4 h-4" /> طباعة
              </Button>
              <Button size="sm" onClick={handleDownloadPdf} disabled={downloading} className="gap-2">
                <Download className="w-4 h-4" />
                {downloading ? "جارٍ التحميل..." : "تحميل PDF"}
              </Button>
            </div>
          )}
        </div>

        {profile && (
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertTitle>
              مرحبًا {profile.full_name || profile.email} 👋
            </AlertTitle>
            <AlertDescription>
              {myGuide
                ? `دورك الحالي: ${myGuide.title} — ${myGuide.summary}`
                : "لم يتم تحديد دور لك بعد. يُرجى مراجعة المدير العام."}
            </AlertDescription>
          </Alert>
        )}

        <div ref={printRef} className="space-y-6 bg-background">
          {myGuide && (
            <Card className="border-primary/40 shadow-md">
              <CardHeader className={`bg-gradient-to-l ${myGuide.color} text-white rounded-t-lg`}>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <UserCheck className="w-5 h-5" />
                    مهامك اليومية — {myGuide.title}
                  </span>
                  <Badge variant="secondary" className="text-foreground">
                    {filteredLinks.length} / {myGuide.links.length} صفحات
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="relative no-print">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ابحث عن صفحة أو مهمة..."
                    className="pr-9"
                  />
                </div>
                {filteredLinks.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6">
                    لا توجد نتائج مطابقة لبحثك.
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredLinks.map((l) => (
                      <Link key={l.path} to={l.path}>
                        <Card className="hover:border-primary hover:shadow transition cursor-pointer h-full">
                          <CardContent className="p-4 flex items-start gap-3">
                            <div className="p-2 rounded-md bg-primary/10 text-primary flex-shrink-0">
                              <l.icon className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm flex items-center justify-between gap-2">
                                <span>{l.label}</span>
                                <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground" />
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">{l.desc}</div>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="w-4 h-4" />
                صفحات مشتركة لكل الموظفين
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Link to="/notifications">
                  <Button variant="outline" className="w-full justify-start gap-2">
                    <Bell className="w-4 h-4" /> الإشعارات
                  </Button>
                </Link>
                <Link to="/permissions">
                  <Button variant="outline" className="w-full justify-start gap-2">
                    <ClipboardList className="w-4 h-4" /> صلاحياتي
                  </Button>
                </Link>
                <Link to="/org-chart">
                  <Button variant="outline" className="w-full justify-start gap-2">
                    <Network className="w-4 h-4" /> الهيكل التنظيمي
                  </Button>
                </Link>
                <Link to="/install">
                  <Button variant="outline" className="w-full justify-start gap-2">
                    <Package className="w-4 h-4" /> تثبيت التطبيق
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {isGeneralManager && (
          <Card className="no-print">
            <CardHeader className="space-y-3">
              <CardTitle className="text-base flex items-center gap-2">
                <UsersRound className="w-4 h-4" />
                مرجع كامل لجميع الأدوار (للمدير العام)
              </CardTitle>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={refQuery}
                  onChange={(e) => setRefQuery(e.target.value)}
                  placeholder="ابحث عن دور أو صفحة..."
                  className="pr-9"
                />
              </div>
            </CardHeader>
            <CardContent>
              {filteredOtherGuides.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">
                  لا توجد أدوار مطابقة.
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {filteredOtherGuides.map((g) => (
                    <Card key={g.role} className="overflow-hidden">
                      <div className={`h-2 bg-gradient-to-l ${g.color}`} />
                      <CardContent className="p-4">
                        <div className="font-semibold mb-1">{g.title}</div>
                        <div className="text-xs text-muted-foreground mb-3">{g.summary}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {g.links.map((l) => (
                            <Link key={l.path} to={l.path}>
                              <Badge variant="secondary" className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition gap-1">
                                <l.icon className="w-3 h-3" />
                                {l.label}
                              </Badge>
                            </Link>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
