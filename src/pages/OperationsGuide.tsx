import { useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Egg, FlaskConical, Beef, BookOpen, Printer, Search, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";

type Section = {
  id: string;
  title: string;
  icon: any;
  roles: string[]; // role keys that may see this section
  steps: {
    title: string;
    points: string[];
    note?: string;
    warning?: string;
  }[];
};

const SECTIONS: Section[] = [
  {
    id: "hatchery",
    title: "شرح دورة معمل التفريخ",
    icon: FlaskConical,
    roles: ["general_manager", "executive_manager", "hatchery_manager", "production_manager"],
    steps: [
      {
        title: "1) استقبال البيض",
        points: [
          "استقبال البيض من مزرعة الأمهات عن طريق تبويب «وارد المزرعة».",
          "استقبال البيض من العملاء الخارجيين بإنشاء دفعة جديدة باسم العميل.",
          "تسجيل عدد البيض المستلم والبيض الفاسد عند الاستلام.",
          "إنشاء رقم دفعة تلقائي مع اختيار الماكينة وتاريخ الدخول.",
        ],
        note: "يجب اعتماد الكمية الواردة من مزرعة الأمهات قبل إنشاء الدفعة.",
      },
      {
        title: "2) متابعة الدفعات داخل المعمل",
        points: [
          "مرحلة الحضانة: من يوم 0 إلى يوم 15.",
          "الفحص الأول (الكشف 1): تسجيل عدد البيض المخصب وغير المخصب.",
          "الفحص الثاني (الكشف 2): تسجيل البيض الميت.",
          "نقل الدفعة إلى الهاتشر يوم 42.",
          "الفقس وإغلاق الدفعة يوم 45 تقريبًا.",
        ],
        warning: "أي تأخير في الكشف أو النقل للهاتشر يؤثر على نسبة الفقس.",
      },
      {
        title: "3) فحص الإخصاب",
        points: [
          "تسجيل البيض المخصب وغير المخصب وقت الكشف الأول.",
          "نسبة الإخصاب = (المخصب ÷ المفحوص) × 100.",
          "البيض غير المخصب يحتسب على العميل الخارجي بالسعر المتفق عليه.",
        ],
      },
      {
        title: "4) الفقس وخروج الكتاكيت",
        points: [
          "تسجيل عدد الكتاكيت الناتجة لكل دفعة.",
          "كتاكيت نعام العاصمة تُنقل لقسم التحضين والتسمين.",
          "كتاكيت العملاء الخارجيين تسلم للعميل أو تُباع.",
          "تسجيل النافق داخل الهاتشر للحساب المالي.",
        ],
      },
      {
        title: "5) خزنة معمل التفريخ",
        points: [
          "تسجيل إيرادات: مبيعات كتاكيت، إيراد تفريخ عملاء خارجيين، تحصيل دفعات.",
          "تسجيل مصروفات: كهرباء، صيانة، رواتب، أدوية، مطهرات، نقل.",
          "ربط الحركة بالعميل أو الدفعة عند الإمكان.",
          "طباعة إيصال لكل حركة قبض أو صرف.",
        ],
        note: "الرصيد الحالي يُحدّث تلقائيًا بعد كل حركة.",
      },
      {
        title: "6) التقارير",
        points: [
          "تقرير العملاء وعدد دفعات كل عميل.",
          "تقرير البيض الداخل (يومي/أسبوعي/شهري/سنوي).",
          "تقرير الإخصاب والفقس.",
          "تقرير الكتاكيت الناتجة (نعام العاصمة / خارجي).",
          "تقرير الخزنة والربح والخسارة.",
        ],
      },
    ],
  },
  {
    id: "farm",
    title: "شرح دورة مزرعة الأمهات",
    icon: Egg,
    roles: ["general_manager", "executive_manager", "farm_manager", "production_manager"],
    steps: [
      {
        title: "1) تسجيل إنتاج البيض اليومي",
        points: [
          "اختيار التاريخ والملعب والمسؤول.",
          "تسجيل عدد البيض الناتج وحالته.",
          "حفظ الإنتاج يتم احتسابه فورًا في Dashboard المزرعة.",
        ],
      },
      {
        title: "2) متابعة الملاعب",
        points: [
          "كل ملعب يحتوي على عدد محدد من الذكور والإناث والأسر.",
          "ترتيب الملاعب يظهر في Dashboard: أعلى إنتاج وأقل إنتاج.",
          "متابعة الانخفاض المفاجئ في إنتاج ملعب معين.",
        ],
        warning: "أقل ملعب إنتاجًا يحتاج لمراجعة عاجلة للأسر والإضاءة والتغذية.",
      },
      {
        title: "3) نقل البيض لمعمل التفريخ",
        points: [
          "إنشاء حركة نقل بعدد البيض المراد إرساله.",
          "الحركة تظهر في تبويب «وارد المزرعة» داخل المعمل بانتظار الاستلام.",
          "بعد اعتماد الاستلام داخل المعمل تُنشأ الدفعة تلقائيًا.",
        ],
      },
      {
        title: "4) الهالك والمرفوض",
        points: [
          "تسجيل البيض الهالك يوميًا مع السبب (مكسور / غير صالح / مرفوض من المعمل).",
          "نسبة الهالك = (الهالك ÷ الإنتاج الكلي) × 100.",
        ],
      },
      {
        title: "5) Dashboard المزرعة",
        points: [
          "إنتاج اليوم / الأسبوع / الشهر / السنة.",
          "أفضل وأقل ملعب إنتاجًا، Top 5 و Bottom 5.",
          "كمية البيض المنقول لمعمل التفريخ.",
          "نسبة الهالك العامة.",
        ],
      },
      {
        title: "6) التقارير",
        points: [
          "تقرير إنتاج البيض اليومي/الشهري.",
          "تقرير الملاعب.",
          "تقرير النقل للمعمل.",
          "تقرير الهالك والمرفوض.",
        ],
      },
    ],
  },
  {
    id: "meat",
    title: "شرح دورة مصنع اللحوم",
    icon: Beef,
    roles: ["general_manager", "executive_manager", "meat_factory_manager", "production_manager"],
    steps: [
      {
        title: "1) مخزن خامات مصنع اللحوم",
        points: [
          "إضافة الخامات (لحوم خام، بهارات، إضافات...).",
          "تسجيل فواتير الشراء وتحديث رصيد الخامات.",
          "متوسط التكلفة يُحتسب تلقائيًا بعد كل عملية شراء.",
        ],
      },
      {
        title: "2) مخزن علب التغليف",
        points: [
          "علب الكفتة، البرجر، السجق، الكفتة بالأرز.",
          "تسجيل المشتريات وخصم العلب عند التصنيع.",
        ],
      },
      {
        title: "3) التصنيع",
        points: [
          "اختيار المنتج النهائي وكمية الإنتاج.",
          "إدخال الخامات الغذائية والعلب المستخدمة.",
          "اعتماد فاتورة التصنيع: يخصم الخامات والعلب ويضيف المنتج الجاهز.",
          "حساب تكلفة الكيلو تلقائيًا من إجمالي التكلفة ÷ الكمية المنتجة.",
        ],
        warning: "بعد اعتماد فاتورة التصنيع لا يمكن تعديلها — تتطلب إذن مدير.",
      },
      {
        title: "4) المبيعات والمرتجعات",
        points: [
          "فاتورة بيع نقدي تضيف للخزنة تلقائيًا.",
          "فاتورة بيع آجل تُسجل على العميل.",
          "المرتجع يرجع المنتج الجاهز للمخزن ويخصم من الخزنة.",
          "ربط المرتجع بالفاتورة الأصلية للتتبع.",
        ],
      },
      {
        title: "5) النقل للمخزن الرئيسي",
        points: [
          "اختيار المنتج والكمية وإنشاء إذن النقل.",
          "بعد الاعتماد: يخصم من مصنع اللحوم ويضاف للمخزن الرئيسي.",
          "طباعة إذن النقل.",
        ],
      },
      {
        title: "6) خزنة مصنع اللحوم",
        points: [
          "إيرادات: مبيعات نقدية.",
          "مصروفات: شراء خامات نقدي، شراء علب نقدي، مرتجعات، مصاريف تشغيل.",
          "متابعة الرصيد الحالي وسجل الحركات.",
        ],
      },
      {
        title: "7) Dashboard مصنع اللحوم",
        points: [
          "قيمة الخامات والعلب والمنتج الجاهز.",
          "المبيعات والمشتريات والربح.",
          "المنتجات التي وصلت لحد التنبيه.",
        ],
      },
    ],
  },
];

export default function OperationsGuide() {
  const { isGeneralManager, isExecutiveManager, roles, loading } = useAuth();
  const [activeId, setActiveId] = useState<string>("hatchery");
  const [search, setSearch] = useState("");

  const userRoles = roles || [];
  const isAdmin = isGeneralManager || isExecutiveManager;

  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => isAdmin || s.roles.some((r) => userRoles.includes(r as any))),
    [isAdmin, userRoles]
  );

  if (loading) return null;
  if (visibleSections.length === 0) return <Navigate to="/unauthorized" replace />;

  const active = visibleSections.find((s) => s.id === activeId) || visibleSections[0];

  const filteredSteps = active.steps.filter((step) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return step.title.toLowerCase().includes(q) || step.points.some((p) => p.toLowerCase().includes(q));
  });

  const print = () => window.print();

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4" dir="rtl">
        <Header title="دليل التشغيل" subtitle="فهرس شرح استخدام السيستم خطوة بخطوة" />

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 mt-4">
          {/* Sidebar */}
          <Card className="p-3 h-fit sticky top-4">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-5 h-5" />
              <h3 className="font-bold">الفهرس</h3>
            </div>
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute right-3 top-3 text-muted-foreground" />
              <Input placeholder="بحث داخل الدليل..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-10" />
            </div>
            <nav className="space-y-1">
              {visibleSections.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    className={`w-full flex items-center gap-2 text-right p-2 rounded-md text-sm transition-colors ${
                      active.id === s.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{s.title}</span>
                  </button>
                );
              })}
            </nav>
          </Card>

          {/* Content */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <active.icon className="w-6 h-6 text-primary" />
                <h2 className="text-2xl font-bold">{active.title}</h2>
              </div>
              <Button size="sm" variant="outline" onClick={print}>
                <Printer className="w-4 h-4 ml-1" />طباعة هذا الشرح
              </Button>
            </div>

            <div className="space-y-5">
              {filteredSteps.map((step, i) => (
                <div key={i} className="border-r-4 border-primary pr-4">
                  <h3 className="font-bold text-lg mb-2">{step.title}</h3>
                  <ul className="space-y-1.5">
                    {step.points.map((p, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                  {step.note && (
                    <div className="mt-2 p-2 rounded bg-blue-50 text-sm text-blue-900 flex items-start gap-2">
                      <Badge variant="secondary">ملاحظة</Badge>
                      <span>{step.note}</span>
                    </div>
                  )}
                  {step.warning && (
                    <div className="mt-2 p-2 rounded bg-orange-50 text-sm text-orange-900 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{step.warning}</span>
                    </div>
                  )}
                </div>
              ))}
              {filteredSteps.length === 0 && (
                <p className="text-center text-muted-foreground py-8">لا توجد نتائج للبحث.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
