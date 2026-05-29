import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollText, Shield, Sparkles, Wrench, Package, FileSpreadsheet, Printer, Lock, Beef } from "lucide-react";

type UpdateType = "feature" | "security" | "fix" | "export";

type UpdateEntry = {
  date: string;
  type: UpdateType;
  title: string;
  description: string;
  module?: string;
  icon?: typeof Sparkles;
};

const updates: UpdateEntry[] = [
  {
    date: "2026-05-29",
    type: "feature",
    title: "طلبات الكتاكيت وربطها بالتارجت والقبض",
    description: "قسم جديد \"طلبات الكتاكيت\" يسمح للمسوقات بتسجيل وتعديل طلبات الكتاكيت (بيانات العميل، العمر، السعر، العدد)، مع تقييد تحديث الحالة والحذف لمديرة المبيعات فقط. أُضيفت أعمدة رقم الطلب والمسوقة والإجراءات، وفلاتر للشهر والسنة والمسوقة وبحث بالاسم/الهاتف. في جدول البيان أُضيفت صفوف عدد الكتاكيت وسعر بونص الكتكوت (قابل للتعديل من المدير العام/التنفيذي/مدير المبيعات بقيمة افتراضية 50ج) وبونص الكتاكيت. في جدول القبض أُضيف بونص الكتاكيت أسفل بونص اللحوم بالعظم ويُدخل ضمن إجمالي القبض. لا يُحتسب البونص إلا للطلبات بحالة \"تم التسليم\" فقط.",
    module: "المبيعات والمنسقين",
    icon: Sparkles,
  },
  {
    date: "2026-05-25",
    type: "export",
    title: "تصدير CSV + تقرير PDF لملخص المخزون",
    description: "أُضيف زرّا تصدير CSV (متوافق مع Excel وأنظمة ERP) وتوليد تقرير PDF احترافي لملخص المخزون والمنتجات مع تاريخ الإصدار وإحصاءات شاملة (إجمالي/نشط/قيمة/قارب النفاد).",
    module: "المنتجات",
    icon: FileSpreadsheet,
  },
  {
    date: "2026-05-25",
    type: "feature",
    title: "صفحة سجل التحديثات",
    description: "صفحة مرجعية تعرض جميع التحديثات والإضافات الأمنية المنفذة على النظام مرتبة بحسب التاريخ.",
    module: "النظام",
    icon: ScrollText,
  },
  {
    date: "2026-05-25",
    type: "export",
    title: "طباعة وتصدير دفعات الذبح المكتملة",
    description: "إضافة زر طباعة PDF احترافي بشعار الشركة وزر تصدير Excel لكل دفعة ذبح مكتملة في قسم المجزر، يتضمن جميع القطعيات والباركود والأوزان والتكاليف والوجهات.",
    module: "المجزر وإنتاج اللحوم",
    icon: Beef,
  },
  {
    date: "2026-05-24",
    type: "security",
    title: "تأمين شامل لوظائف الخادم (Edge Functions)",
    description: "حذف دوال bootstrap-private-rep وseed-moderators (كانت تحتوي كلمات مرور ثابتة). تأمين update-user-email وsuggest-product-price بالتحقق من JWT وفرض صلاحيات الأدوار وتنقية المدخلات.",
    module: "الأمان",
    icon: Shield,
  },
  {
    date: "2026-05-24",
    type: "security",
    title: "إيقاف بث الطلبات الفوري عبر القنوات العامة",
    description: "إزالة جدول orders من قناة supabase_realtime لمنع تسرب بيانات الطلبات لمشتركين خارج نطاق صلاحياتهم؛ الاستعلامات العادية تظل محمية بسياسات RLS.",
    module: "الأمان",
    icon: Lock,
  },
  {
    date: "2026-05-24",
    type: "feature",
    title: "تصدير Excel لجميع المنتجات",
    description: "زر تصدير شامل في صفحة المنتجات يصدّر ملف Excel بالأعمدة: الباركود، الاسم، التصنيف، الوحدة، السعر، الكمية، إجمالي القيمة، الحالة.",
    module: "المنتجات",
    icon: Package,
  },
  {
    date: "2026-05-23",
    type: "feature",
    title: "احتساب حواوشي ضمن المصنعات",
    description: "تم إدراج منتج حواوشي ضمن نطاق الكميات المصنعة في جدولي البيان والقبض وأجور المنسقين.",
    module: "المبيعات والمنسقين",
    icon: Sparkles,
  },
  {
    date: "2026-05-22",
    type: "fix",
    title: "تحسين أداء جلب البيانات الكبيرة",
    description: "تحسين الاستعلامات لجلب السجلات على دفعات من 1000 سجل لمنع تدهور الأداء على المجموعات الكبيرة.",
    module: "النظام",
    icon: Wrench,
  },
  {
    date: "2026-05-20",
    type: "security",
    title: "تفعيل حماية كلمات المرور المسرّبة",
    description: "تفعيل فحص Have I Been Pwned لرفض كلمات المرور المسرّبة في تسجيل المستخدمين الجدد وتغيير كلمات المرور.",
    module: "الأمان",
    icon: Shield,
  },
  {
    date: "2026-05-18",
    type: "feature",
    title: "إذن ذبح النعام القابل للطباعة",
    description: "نموذج طلب ذبح نعام بشعار الشركة وبيانات المجزر، يدعم إضافة عدة سطور للذبائح وقابل للطباعة على A4.",
    module: "المجزر",
    icon: Printer,
  },
];

const typeMap: Record<UpdateType, { label: string; cls: string; Icon: typeof Sparkles }> = {
  feature: { label: "ميزة جديدة", cls: "bg-purple-500/15 text-purple-700 border-purple-300", Icon: Sparkles },
  security: { label: "أمان", cls: "bg-red-500/15 text-red-700 border-red-300", Icon: Shield },
  fix: { label: "إصلاح", cls: "bg-amber-500/15 text-amber-700 border-amber-300", Icon: Wrench },
  export: { label: "تصدير وطباعة", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-300", Icon: FileSpreadsheet },
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
};

const UpdatesLog = () => {
  const grouped = updates.reduce<Record<string, UpdateEntry[]>>((acc, u) => {
    (acc[u.date] ||= []).push(u);
    return acc;
  }, {});
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <DashboardLayout>
      <Header
        title="سجل التحديثات"
        subtitle="آخر التغييرات والإضافات الأمنية المنفذة على النظام مرتبة حسب تاريخ التنفيذ"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {(Object.keys(typeMap) as UpdateType[]).map((t) => {
          const count = updates.filter((u) => u.type === t).length;
          const { label, cls, Icon } = typeMap[t];
          return (
            <Card key={t}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-2xl font-bold">{count}</p>
                </div>
                <div className={`p-2 rounded-lg border ${cls}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="space-y-6">
        {sortedDates.map((date) => (
          <div key={date}>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-px flex-1 bg-border" />
              <Badge variant="outline" className="bg-gradient-to-r from-primary/10 to-accent/10 text-foreground font-bold px-3 py-1">
                {formatDate(date)}
              </Badge>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="grid gap-3">
              {grouped[date].map((u, i) => {
                const meta = typeMap[u.type];
                const Icon = u.icon || meta.Icon;
                return (
                  <Card key={i} className="hover:shadow-md transition-shadow border-r-4" style={{ borderRightColor: u.type === "security" ? "#dc2626" : u.type === "feature" ? "#7c3aed" : u.type === "export" ? "#059669" : "#d97706" }}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Icon className="w-5 h-5 text-primary" />
                          {u.title}
                        </CardTitle>
                        <div className="flex gap-2">
                          <Badge variant="outline" className={meta.cls}>{meta.label}</Badge>
                          {u.module && <Badge variant="secondary" className="text-xs">{u.module}</Badge>}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-sm text-muted-foreground leading-relaxed">{u.description}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </DashboardLayout>
  );
};

export default UpdatesLog;
