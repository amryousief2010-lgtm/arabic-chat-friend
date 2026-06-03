import { useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Egg, FlaskConical, Beef, BookOpen, Printer, Search, AlertTriangle,
  CheckCircle2, Bird, Wheat, Warehouse, ShoppingCart, FileDown, ShieldCheck, XCircle
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { openPrintWindow, escapeHtml } from "@/lib/printPdf";

type Step = {
  title: string;
  points: string[];
  note?: string;
  warning?: string;
};

type Section = {
  id: string;
  title: string;
  subtitle: string;
  icon: any;
  roles: string[];
  permissions: string[];
  forbidden: string[];
  steps: Step[];
};

const SECTIONS: Section[] = [
  // ============== 1) FARM ==============
  {
    id: "farm",
    title: "مزرعة الأمهات",
    subtitle: "طريقة إدخال إنتاج البيض اليومي ونقل البيض للمعمل",
    icon: Egg,
    roles: ["general_manager", "executive_manager", "farm_manager", "production_manager"],
    permissions: [
      "مسؤول المزرعة: يدخل الإنتاج اليومي ويسجل الهالك وينشئ حركات النقل.",
      "المدير العام / التنفيذي: يعتمدون التصحيحات والإلغاءات.",
      "أي حركة معتمدة لا يمكن حذفها مباشرة — التصحيح يتم عن طريق طلب من المدير.",
    ],
    forbidden: [
      "تسجيل إنتاج بدون اختيار ملعب.",
      "تسجيل هالك بدون كتابة السبب.",
      "نقل كمية بيض أكبر من المتاح فعليًا في المزرعة.",
      "حذف حركة معتمدة بدون صلاحية مدير.",
    ],
    steps: [
      {
        title: "1) إدخال إنتاج البيض اليومي",
        points: [
          "افتح قسم «مزرعة الأمهات» من القائمة الجانبية.",
          "اضغط على «إنتاج البيض اليومي».",
          "اختر التاريخ (افتراضيًا اليوم).",
          "اختر رقم الملعب من القائمة.",
          "أدخل عدد البيض المنتج.",
          "لو يوجد بيض هالك أو مرفوض: سجله في خانة «الهالك» مع كتابة السبب (مكسور / غير صالح / مرفوض من المعمل).",
          "اضغط «حفظ».",
        ],
        note: "بعد الحفظ يظهر الإنتاج فورًا في Dashboard المزرعة (اليوم/الأسبوع/الشهر/السنة).",
      },
      {
        title: "2) نقل البيض إلى معمل التفريخ",
        points: [
          "افتح «نقل البيض للمعمل».",
          "اختر التاريخ ورقم الملعب وعدد البيض المنقول.",
          "اضغط «اعتماد النقل».",
        ],
        note: "بعد الاعتماد يقل البيض المتبقي في المزرعة ويظهر «وارد» في تبويب وارد المزرعة داخل معمل التفريخ.",
      },
      {
        title: "3) متابعة Dashboard المزرعة",
        points: [
          "إنتاج اليوم / الأسبوع / الشهر / السنة.",
          "أفضل ملعب إنتاجًا وأقل ملعب إنتاجًا.",
          "كمية البيض المنقول للمعمل ونسبة الهالك.",
          "زر طباعة وتصدير Excel متاح لأي تقرير.",
        ],
      },
    ],
  },

  // ============== 2) HATCHERY ==============
  {
    id: "hatchery",
    title: "معمل التفريخ",
    subtitle: "طريقة إدخال بيض المعمل ومتابعة الدفعات والفقس والخزنة",
    icon: FlaskConical,
    roles: ["general_manager", "executive_manager", "hatchery_manager", "production_manager"],
    permissions: [
      "مسؤول المعمل: إنشاء دفعات، تسجيل الفحص والفقس، إدخال حركات الخزنة.",
      "المدير العام / التنفيذي: اعتماد التصحيحات والإلغاءات وفتح أي دفعة مغلقة.",
    ],
    forbidden: [
      "إغلاق دفعة قبل تسجيل نتائج الفحص والفقس.",
      "تسجيل فقس بدون اختيار الدفعة.",
      "تسجيل مصروف بدون تصنيف.",
      "حذف إيصال خزنة معتمد.",
    ],
    steps: [
      {
        title: "1) إضافة دفعة بيض جديدة",
        points: [
          "افتح قسم «معمل التفريخ».",
          "اضغط «إضافة دفعة».",
          "اختر مصدر البيض: «نعام العاصمة» أو «عميل خارجي».",
          "لو خارجي: اختر اسم العميل من القائمة.",
          "أدخل عدد البيض.",
          "اختر الماكينة (M1 / M2 / M3 / Hatcher).",
          "أدخل تاريخ الدخول.",
          "اضغط «حفظ / اعتماد».",
        ],
      },
      {
        title: "2) متابعة الدفعات والفحص",
        points: [
          "افتح تبويب «الدفعات» لمتابعة كل الدفعات الجارية.",
          "عند الكشف الأول افتح «فحص الإخصاب» وسجل: المخصب، غير المخصب، الفاسد/المستبعد.",
          "عند الكشف الثاني سجل البيض الميت.",
          "نسبة الإخصاب تُحسب تلقائيًا.",
        ],
      },
      {
        title: "3) النقل للهاتشر والفقس",
        points: [
          "في يوم 42 سجل حركة «نقل للهاتشر».",
          "عند الفقس سجل عدد الكتاكيت الناتجة وعدد النافق.",
          "كتاكيت نعام العاصمة: تُنقل تلقائيًا للتحضين والتسمين.",
          "كتاكيت العملاء الخارجيين: تسجل خروج للعميل.",
        ],
      },
      {
        title: "4) خزنة المعمل — تسجيل إيراد",
        points: [
          "افتح تبويب «الخزنة».",
          "اختر نوع الحركة: «إيراد».",
          "اختر التصنيف: «إيراد تفريخ» أو «مبيعات كتاكيت» أو «تحصيل دفعات».",
          "أدخل العميل والدفعة والمبلغ.",
          "اضغط «حفظ» — الرصيد يُحدّث فورًا ويمكن طباعة الإيصال.",
        ],
      },
      {
        title: "5) خزنة المعمل — تسجيل مصروف",
        points: [
          "اختر نوع الحركة: «مصروف».",
          "اختر التصنيف: كهرباء / صيانة / رواتب / أدوية / مطهرات / مصاريف أخرى.",
          "أدخل المبلغ والوصف.",
          "اضغط «حفظ» واطبع إيصال الصرف.",
        ],
        warning: "لا يُقبل تسجيل أي مصروف بدون تصنيف واضح.",
      },
    ],
  },

  // ============== 3) BROODING ==============
  {
    id: "brooding",
    title: "التحضين والتسمين",
    subtitle: "متابعة الكتاكيت من الاستلام حتى البيع أو التحويل للمجزر",
    icon: Bird,
    roles: ["general_manager", "executive_manager", "brooding_manager", "production_manager"],
    permissions: [
      "مسؤول التحضين: إدخال الدفعات، النافق، صرف العلف، البيع، التحويل للمجزر.",
      "محمد خالد ومحمد شعلة: مشاهدة Dashboard فقط — لا ينفذون أي حركات.",
      "المدير العام / التنفيذي: اعتماد التصحيحات.",
    ],
    forbidden: [
      "تسجيل نافق بدون سبب.",
      "بيع عدد كتاكيت أكبر من العدد الحالي للدفعة.",
      "صرف علف أكبر من رصيد المخزون.",
      "تحويل عدد طيور أكبر من الموجود فعليًا.",
    ],
    steps: [
      {
        title: "1) استلام كتاكيت جديدة",
        points: [
          "افتح «التحضين والتسمين» ← «إضافة دفعة جديدة».",
          "اختر المصدر: معمل التفريخ / شراء خارجي / رصيد افتتاحي.",
          "أدخل عدد الكتاكيت والعمر وقت الدخول وتاريخ الدخول.",
          "اضغط «حفظ» — العمر الحالي يُحسب تلقائيًا يوميًا.",
        ],
      },
      {
        title: "2) تسجيل نافق",
        points: [
          "افتح الدفعة ← اضغط «حركة» ← اختر «تسجيل نافق».",
          "أدخل العدد النافق واكتب السبب.",
          "اضغط «حفظ».",
        ],
        note: "بعد الحفظ يقل العدد الحالي وتزيد تكلفة الطائر المتبقي تلقائيًا.",
      },
      {
        title: "3) صرف علف",
        points: [
          "افتح الدفعة ← «صرف علف».",
          "اختر نوع العلف وأدخل الكمية.",
          "السيستم يحسب سعر التكلفة حسب عمر الدفعة.",
          "اضغط «حفظ» واطبع إذن صرف العلف.",
        ],
        note: "بعد الحفظ يقل رصيد العلف وتزيد تكلفة الدفعة.",
      },
      {
        title: "4) بيع كتاكيت",
        points: [
          "افتح الدفعة ← «بيع كتاكيت».",
          "أدخل العدد المباع وسعر البيع.",
          "راجع الربح/الخسارة ثم اضغط «اعتماد البيع».",
        ],
        note: "لو البيع نقدي تزيد الخزنة تلقائيًا.",
      },
      {
        title: "5) تحويل للمجزر",
        points: [
          "اختر الدفعة ← «تحويل للمجزر».",
          "أدخل عدد الطيور والوزن القائم وسعر الكيلو القائم إن وجد.",
          "اضغط «اعتماد» — تظهر الحركة في سجل المجزر.",
        ],
      },
    ],
  },

  // ============== 4) FEED FACTORY ==============
  {
    id: "feed",
    title: "مصنع الأعلاف",
    subtitle: "شراء الخامات وتصنيع العلف وبيعه أو توريده للتحضين",
    icon: Wheat,
    roles: ["general_manager", "executive_manager", "feed_factory_manager", "production_manager"],
    permissions: [
      "مسؤول مصنع الأعلاف: شراء الخامات، فواتير التصنيع، البيع، توريد التحضين.",
      "المدير العام / التنفيذي: اعتماد الإلغاء أو التعديلات.",
    ],
    forbidden: [
      "استخدام سعر البيع في تكلفة توريد التحضين — يجب استخدام سعر التكلفة فقط.",
      "تصنيع علف بدون اختيار الخامات.",
      "حذف فاتورة معتمدة — يجب إلغاء بحركة عكسية معتمدة.",
    ],
    steps: [
      {
        title: "1) شراء خامات",
        points: [
          "افتح «مصنع الأعلاف» ← «شراء خامات».",
          "أدخل المورد واختر الصنف والكمية وسعر الوحدة.",
          "اختر طريقة الدفع (نقدي / آجل) — لو نقدي اختر الخزنة.",
          "اضغط «اعتماد».",
        ],
        note: "بعد الاعتماد يزيد مخزون الخامات وتخصم الخزنة لو الدفع نقدي.",
      },
      {
        title: "2) تصنيع علف",
        points: [
          "افتح «فاتورة تصنيع علف».",
          "اختر نوع العلف النهائي وأدخل الكمية المنتجة.",
          "اختر الخامات المستخدمة وراجع تكلفة التصنيع.",
          "اضغط «اعتماد» — تخصم الخامات ويزيد العلف الجاهز.",
        ],
      },
      {
        title: "3) بيع علف",
        points: [
          "افتح «مبيعات الأعلاف» ← اختر العميل ونوع العلف.",
          "أدخل الكمية وسعر البيع.",
          "اختر طريقة الدفع والخزنة.",
          "اضغط «اعتماد» — يقل العلف الجاهز وتزيد الخزنة لو نقدي.",
        ],
      },
      {
        title: "4) توريد علف للتحضين والتسمين",
        points: [
          "اختر «توريد علف للتحضين».",
          "أدخل نوع العلف والكمية.",
          "السعر بسعر التكلفة وليس سعر البيع.",
          "اضغط «اعتماد».",
        ],
        note: "النتيجة: يقل مخزون مصنع الأعلاف، يزيد مخزون علف التحضين، تخصم خزنة التحضين بسعر التكلفة، وتظهر الحركة في سجل الطرفين.",
        warning: "توريد العلف للتحضين ليس بيع خارجي — لا تستخدم سعر البيع.",
      },
      {
        title: "5) مرتجع أعلاف",
        points: [
          "سجل المرتجع من شاشة المرتجعات.",
          "أي مرتجع أعلاف يزود المخزون ويخصم الخزنة.",
        ],
      },
    ],
  },

  // ============== 5) MEAT FACTORY ==============
  {
    id: "meat",
    title: "مصنع اللحوم",
    subtitle: "شراء الخامات والتصنيع والبيع والنقل للمخزن الرئيسي",
    icon: Beef,
    roles: ["general_manager", "executive_manager", "meat_factory_manager", "production_manager"],
    permissions: [
      "مسؤول مصنع اللحوم: شراء، تصنيع، بيع، مرتجعات، نقل للمخزن الرئيسي.",
      "المدير العام / التنفيذي: اعتماد الإلغاء أو التعديل التصحيحي.",
    ],
    forbidden: [
      "تصنيع منتج بدون توفر الخامات أو العلب الكافية.",
      "بيع كمية أكبر من رصيد المنتج الجاهز.",
      "حذف حركة معتمدة — يجب التصحيح بإلغاء أو حركة عكسية بصلاحية المدير.",
    ],
    steps: [
      {
        title: "1) شراء خامات",
        points: [
          "افتح «مصنع اللحوم» ← «شراء خامات».",
          "أدخل المورد والصنف والكمية والسعر وطريقة الدفع.",
          "اضغط «اعتماد» — يزيد مخزون الخامات وتخصم الخزنة لو نقدي.",
        ],
      },
      {
        title: "2) شراء علب تغليف",
        points: [
          "اختر «شراء علب تغليف» ونوع العلبة (كفتة / برجر / سجق / كفتة رز).",
          "أدخل العدد وسعر العلبة وطريقة الدفع.",
          "اضغط «اعتماد» — يزيد رصيد العلب.",
        ],
      },
      {
        title: "3) تصنيع منتج",
        points: [
          "افتح «فاتورة تصنيع».",
          "اختر المنتج النهائي (كفتة / برجر / سجق / مفروم / حواوشي / كفتة رز).",
          "أدخل الكمية المنتجة والخامات الغذائية المستخدمة.",
          "أدخل العلب المستخدمة إن وُجدت.",
          "راجع إجمالي تكلفة التشغيلة ثم اضغط «اعتماد».",
        ],
        note: "بعد الاعتماد: تخصم الخامات والعلب، يزيد المنتج الجاهز، وتُحسب تكلفة الكيلو تلقائيًا.",
      },
      {
        title: "4) بيع منتج",
        points: [
          "اختر «مبيعات مصنع اللحوم» ← العميل والمنتج والكمية والسعر.",
          "اختر طريقة الدفع.",
          "اضغط «اعتماد» — يقل المنتج الجاهز وتزيد الخزنة لو نقدي.",
        ],
      },
      {
        title: "5) مرتجع مبيعات",
        points: [
          "اختر «مرتجع مبيعات».",
          "اختر العميل والمنتج والكمية واكتب سبب المرتجع.",
          "اختر الخزنة التي سيتم رد المبلغ منها.",
          "اضغط «اعتماد» — يزيد المنتج الجاهز وتخصم الخزنة.",
        ],
      },
      {
        title: "6) نقل للمخزن الرئيسي",
        points: [
          "اختر «نقل للمخزن الرئيسي» ← المنتج والكمية.",
          "اضغط «اعتماد».",
          "النتيجة: يقل مخزون مصنع اللحوم، يزيد المخزن الرئيسي، الخزنة لا تتأثر.",
          "اطبع إذن النقل.",
        ],
      },
    ],
  },

  // ============== 6) MAIN WAREHOUSE ==============
  {
    id: "warehouse",
    title: "المخزن الرئيسي",
    subtitle: "متابعة وارد وصادر المخزن الرئيسي",
    icon: Warehouse,
    roles: ["general_manager", "executive_manager", "warehouse_supervisor", "production_manager"],
    permissions: [
      "مسؤول المخزن: اعتماد الوارد والصادر وكل عمليات النقل.",
      "المدير العام / التنفيذي: اعتماد التصحيحات والإلغاءات.",
    ],
    forbidden: [
      "اعتماد نفس الوارد مرتين.",
      "إخراج كمية غير متاحة في المخزن.",
      "نقل لا يظهر في سجل الطرفين (مرسل ومستلم).",
    ],
    steps: [
      {
        title: "1) اعتماد الوارد",
        points: [
          "افتح «المخزن الرئيسي» ← راجع الوارد من: المجزر / مصنع اللحوم / مرتجعات العملاء أو الفروع.",
          "اضغط «اعتماد الوارد» — يزيد المخزون فورًا.",
        ],
      },
      {
        title: "2) تسجيل الصادر",
        points: [
          "اختر نوع الصادر: نقل للعجوزة / توريد هايبر هيلثي تيست / توريد كارفور / مندوب خاص / بيع مباشر.",
          "اختر الأصناف والكميات.",
          "اضغط «اعتماد» — يقل المخزون.",
        ],
      },
      {
        title: "3) التقارير والطباعة",
        points: [
          "كل حركة لها طباعة وExcel من زر التقارير.",
          "سجل حركات المخزن الرئيسي يعرض كل العمليات بفلاتر وبحث.",
        ],
      },
    ],
  },

  // ============== 7) ORDERS & SALES ==============
  {
    id: "orders",
    title: "الطلبات والمبيعات",
    subtitle: "طريقة تسجيل الطلبات ومتابعة الخصم من المخزون",
    icon: ShoppingCart,
    roles: ["general_manager", "executive_manager", "sales_manager", "sales_moderator", "marketing_sales_manager"],
    permissions: [
      "الموديراتور: إنشاء وتعديل طلباته فقط.",
      "مدير المبيعات / التسويق: مراجعة كل الطلبات وتعديل الأسعار حسب الصلاحية.",
      "المدير العام / التنفيذي: كامل الصلاحيات.",
    ],
    forbidden: [
      "تعديل سعر العروض بدون صلاحية مدير.",
      "تسجيل مرتجع من شاشة الطلبات — يجب استخدام شاشة المرتجعات.",
      "تعديل أو إلغاء طلب مُسلَّم بدون اعتماد المدير.",
    ],
    steps: [
      {
        title: "1) إنشاء طلب جديد",
        points: [
          "افتح صفحة «طلب جديد».",
          "ابحث عن العميل أو أضف عميل جديد.",
          "اختر المنتجات أو العرض.",
          "أدخل الكميات.",
          "اختر طريقة التسليم: من المخزن الرئيسي / من العجوزة / مندوب خاص / شحن.",
          "راجع الإجمالي ثم احفظ الطلب.",
        ],
      },
      {
        title: "2) تأكيد التسليم وخصم المخزون",
        points: [
          "عند تأكيد التسليم فقط يتم خصم المخزون.",
          "الطلبات غير المسلمة تظل محجوزة فقط ولا تخصم من المخزون الفعلي.",
        ],
      },
      {
        title: "3) الإلغاء والمرتجعات",
        points: [
          "إلغاء الطلب قبل التسليم لا يخصم مخزون.",
          "المرتجعات تُسجَّل من شاشة «المرتجعات» وليس من شاشة الطلب.",
        ],
      },
    ],
  },
];

export default function OperationsGuide() {
  const { isGeneralManager, isExecutiveManager, roles, loading } = useAuth();
  const [activeId, setActiveId] = useState<string>("farm");
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

  const buildSectionHtml = (s: Section) => {
    const stepsHtml = s.steps.map((step) => `
      <div style="margin-bottom:14px; padding:10px; border-right:4px solid #6d28d9; background:#fafafa; page-break-inside:avoid;">
        <h3 style="margin:0 0 6px 0; color:#4c1d95;">${escapeHtml(step.title)}</h3>
        <ol style="margin:0; padding-right:22px; line-height:1.9;">
          ${step.points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}
        </ol>
        ${step.note ? `<div style="margin-top:6px; padding:6px 10px; background:#eff6ff; border-right:3px solid #2563eb;"><b>ملاحظة:</b> ${escapeHtml(step.note)}</div>` : ""}
        ${step.warning ? `<div style="margin-top:6px; padding:6px 10px; background:#fff7ed; border-right:3px solid #ea580c;"><b>تنبيه:</b> ${escapeHtml(step.warning)}</div>` : ""}
      </div>
    `).join("");
    return `
      <h1 style="margin:0 0 4px 0; color:#6d28d9;">${escapeHtml(s.title)}</h1>
      <p style="margin:0 0 14px 0; color:#555; font-size:14px;">${escapeHtml(s.subtitle)}</p>
      ${stepsHtml}
      <h2 style="margin:18px 0 6px 0; color:#047857; page-break-after:avoid;">الصلاحيات</h2>
      <ul style="line-height:1.9;">${s.permissions.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
      <h2 style="margin:14px 0 6px 0; color:#b91c1c; page-break-after:avoid;">أخطاء ممنوعة</h2>
      <ul style="line-height:1.9;">${s.forbidden.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
    `;
  };

  const today = new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });

  const pdfWrapper = (titleHeader: string, bodyHtml: string) => `
    <div dir="rtl" style="font-family: 'Cairo','Tajawal','Segoe UI',Arial,sans-serif; color:#111; padding:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #6d28d9; padding-bottom:10px; margin-bottom:16px;">
        <div>
          <div style="font-size:22px; font-weight:800; color:#6d28d9;">نعام العاصمة</div>
          <div style="font-size:13px; color:#666;">دليل تشغيل الموظفين</div>
        </div>
        <div style="text-align:left; font-size:12px; color:#666;">
          <div>${escapeHtml(titleHeader)}</div>
          <div>تاريخ التصدير: ${escapeHtml(today)}</div>
        </div>
      </div>
      ${bodyHtml}
      <div style="margin-top:24px; padding-top:8px; border-top:1px solid #ddd; font-size:11px; color:#888; text-align:center;">
        نعام العاصمة — دليل تشغيل الموظفين — مستند داخلي
      </div>
    </div>
  `;

  const downloadPdf = async (filename: string, html: string) => {
    const html2pdf = (await import("html2pdf.js")).default;
    const container = document.createElement("div");
    container.innerHTML = html;
    container.style.position = "fixed";
    container.style.right = "-10000px";
    container.style.top = "0";
    container.style.width = "800px";
    document.body.appendChild(container);
    try {
      await (html2pdf() as any)
        .set({
          margin: [10, 10, 14, 10],
          filename,
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] },
        })
        .from(container.firstElementChild as HTMLElement)
        .save();
    } finally {
      document.body.removeChild(container);
    }
  };

  const printSection = () => {
    openPrintWindow(`دليل التشغيل — ${active.title}`, buildSectionHtml(active));
  };

  const exportSectionPdf = async () => {
    const html = pdfWrapper(active.title, buildSectionHtml(active));
    await downloadPdf(`دليل-تشغيل-${active.title}.pdf`, html);
  };

  const exportFullPdf = async () => {
    const indexHtml = `
      <div style="page-break-after:always;">
        <h1 style="color:#6d28d9; margin-bottom:8px;">دليل تشغيل الموظفين الكامل</h1>
        <p style="color:#555; margin-bottom:16px;">شركة نعام العاصمة — مستند داخلي للموظفين</p>
        <h2 style="color:#4c1d95;">الفهرس</h2>
        <ol style="line-height:2.2; font-size:15px;">
          ${visibleSections.map((s) => `<li><b>${escapeHtml(s.title)}</b> — ${escapeHtml(s.subtitle)}</li>`).join("")}
        </ol>
      </div>
    `;
    const body = indexHtml + visibleSections
      .map((s) => `<div style="page-break-before:always;">${buildSectionHtml(s)}</div>`)
      .join("");
    const html = pdfWrapper("الدليل الكامل", body);
    await downloadPdf("دليل-تشغيل-الموظفين-الكامل.pdf", html);
  };


  return (
    <DashboardLayout>
      <div className="container mx-auto p-4" dir="rtl">
        <Header title="دليل تشغيل الموظفين" subtitle="شرح عملي خطوة بخطوة لكل قسم — صالح للطباعة والإرسال" />

        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 mt-4">
          {/* Sidebar */}
          <Card className="p-3 h-fit md:sticky md:top-4">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-5 h-5 text-primary" />
              <h3 className="font-bold">فهرس الأقسام</h3>
            </div>
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute right-3 top-3 text-muted-foreground" />
              <Input
                placeholder="بحث داخل الدليل..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-10"
              />
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
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="text-right">{s.title}</span>
                  </button>
                );
              })}
            </nav>

            {isAdmin && (
              <Button size="sm" variant="outline" className="w-full mt-3" onClick={exportFullPdf}>
                <FileDown className="w-4 h-4 ml-1" />تصدير الدليل الكامل PDF
              </Button>
            )}
          </Card>

          {/* Content */}
          <Card className="p-6">
            <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-start gap-3">
                <active.icon className="w-7 h-7 text-primary flex-shrink-0 mt-1" />
                <div>
                  <h2 className="text-2xl font-bold">{active.title}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{active.subtitle}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={printSection}>
                  <Printer className="w-4 h-4 ml-1" />طباعة
                </Button>
                <Button size="sm" variant="outline" onClick={printSection}>
                  <FileDown className="w-4 h-4 ml-1" />تصدير PDF
                </Button>
              </div>
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

              {/* Permissions */}
              <div className="mt-6 p-4 rounded-lg border bg-emerald-50/50">
                <h3 className="font-bold text-base mb-2 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-700" />
                  الصلاحيات
                </h3>
                <ul className="space-y-1">
                  {active.permissions.map((p, i) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <span className="text-emerald-700">•</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Forbidden */}
              <div className="mt-3 p-4 rounded-lg border bg-red-50/50">
                <h3 className="font-bold text-base mb-2 flex items-center gap-2 text-red-700">
                  <XCircle className="w-5 h-5" />
                  أخطاء ممنوعة
                </h3>
                <ul className="space-y-1">
                  {active.forbidden.map((p, i) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <span className="text-red-700">✕</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
