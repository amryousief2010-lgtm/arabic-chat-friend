import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { DATASETS, SECTION_LABELS, FOREIGN_KEYS } from "../catalog.generated";

const SECTION_NOTES: Record<string, string> = {
  sales_orders:
    "تسجيل الطلبات وبنودها والبوكسات المرتبطة بها وسجل تغيير الحالة وطلبات التعديل والطلبات المكررة.",
  catalog: "المنتجات وأسعار البيع وتاريخ التكلفة وصناديق العروض ومكوناتها ومواد التغليف.",
  customers: "بيانات العملاء (تظهر الحقول الحساسة فقط للأدوار المصرح لها عبر سياسات الأمان).",
  inventory:
    "المخازن والأصناف والأرصدة والحجز والحركات والتحويلات والجرد والتسويات والمواقع الفرعية.",
  meat_factory: "مصنع اللحوم: الوصفات والخامات وأوامر التصنيع والإنتاج والتعبئة والمبيعات والمرتجعات والتكاليف.",
  feed_factory: "مصنع الأعلاف: الوصفات والخامات ودفعات الإنتاج وفواتيرها والمبيعات الداخلية والخزينة.",
  slaughterhouse: "المجزر: النعام القائم والدفعات والمخرجات وتكاليفها والعمالة والعُهد والتحويلات.",
  farm_hatchery: "مزرعة الأم والفقاسة والحضانة وتجارة الكتاكيت والشحنات بين الوحدات.",
  catering: "الكاترينج: المنتجات والوصفات والطلبات والمشتريات والفواتير.",
  finance: "خزينة المعمل والخزينة الرئيسية وخزائن المصانع والتحويلات والعُهد والمديونيات والتسويات.",
  hr: "الموظفين والأدوار والصلاحيات والخصومات والرواتب والمستندات والنقل والتدقيق.",
  communication: "الرسائل الداخلية والردود والمرفقات والإشعارات وسجل البريد.",
  marketing: "تقارير السوشيال ميديا والتارجت وأسعار الكيلو وإعدادات البونص.",
  delivery: "شركات الشحن (زودكس/بسطة) والمناديب والمسارات والتحصيل والعُهد والتسويات والبوالص.",
  admin: "الاستيراد والتدقيق ومهام جودة البيانات وسجلات المراجعة والفروع.",
  other: "جداول مساعدة أو إعدادات عامة.",
};

const BUSINESS_RULES = [
  "العملة: الجنيه المصري (EGP). الأوزان بالكيلوجرام ما لم يُذكر غير ذلك.",
  "التوقيت: كل الطوابع الزمنية مخزّنة UTC، والعمل التشغيلي يُحسب بتوقيت القاهرة (Africa/Cairo).",
  "قيمة الطلبات (Orders value) = مجموع orders.total لكل الطلبات المسجّلة بغض النظر عن الحالة.",
  "المبيعات المسلّمة (Delivered sales) = مجموع orders.total للطلبات بحالة delivered فقط، وهي المقياس المعتمد للمبيعات.",
  "التحصيل الفعلي (Collected) = المبالغ المودعة فعليًا في الخزائن (main_treasury_transactions / courier_daily_cash_deposits / lab_treasury_movements) وقد يختلف عن المبيعات المسلّمة بسبب فروق التوقيت.",
  "الإلغاءات: الطلبات بحالة cancelled تُستبعد من المبيعات ومن التارجت.",
  "المرتجعات: تظهر في حالات الطلب (returned) وفي جداول المرتجعات لكل وحدة (meat_factory_sales_returns / feed_sales_returns).",
  "الشحن: delivery_fee منفصل عن subtotal، وorders.total = subtotal - discount + delivery_fee.",
  "الهدايا: بنود order_items بسعر صفر ولا تدخل في الإجماليات.",
  "المخزون: الرصيد الفعلي current_stock، المحجوز reserved_stock، المتاح available_stock = الفعلي - المحجوز - المحظور، لكل صنف داخل مخزن محدد ووحدة قياس محددة.",
  "منذ قرار الجرد اليدوي، لا يتم خصم مخزون المخزن الرئيسي تلقائيًا من الطلبات؛ الخصم يدوي عبر حركات المخزون.",
  "products.stock حقل تجميعي قديم على مستوى المنتج ولا يُعتمد لأرصدة المخازن — استخدم أداة inventory_balances.",
  "كل القراءات تتم بصلاحيات المستخدم الموقّع (RLS)، لذلك قد تختلف النتائج حسب الدور.",
];

export default defineTool({
  name: "system_map",
  title: "System map",
  description:
    "خريطة النظام: الأقسام ووظائفها ومصادر البيانات (جداول/عروض) والعلاقات بينها وقواعد العمل والمؤشرات. ابدأ بهذه الأداة لفهم النظام قبل الاستعلام.",
  inputSchema: {
    section: z.string().optional().describe("اختياري: اسم قسم لعرض تفاصيله فقط، مثل inventory أو sales_orders."),
    include_datasets: z.boolean().optional().describe("تضمين قائمة مصادر البيانات لكل قسم (افتراضي true)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ section, include_datasets }) => {
    const withData = include_datasets !== false;
    const sections = Object.keys(SECTION_LABELS)
      .filter((s) => !section || s === section)
      .map((s) => {
        const items = DATASETS.filter((d) => d.section === s);
        return {
          section: s,
          label_ar: SECTION_LABELS[s],
          purpose: SECTION_NOTES[s] ?? "",
          datasets_count: items.length,
          ...(withData ? { datasets: items.map((d) => d.name) } : {}),
        };
      });

    const relations = section
      ? FOREIGN_KEYS.filter((f) =>
          DATASETS.some((d) => d.section === section && d.name === f.table),
        )
      : undefined;

    const payload = {
      app: "نظام إدارة نعام العاصمة (Naam Al-Asima / Capital Ostrich)",
      access: "قراءة فقط، بصلاحيات المستخدم الموقّع (Row Level Security).",
      currency: "EGP",
      timezone: "Africa/Cairo",
      generated_at: new Date().toISOString(),
      total_datasets: DATASETS.length,
      sections,
      ...(relations ? { relations } : { relations_count: FOREIGN_KEYS.length }),
      business_rules: BUSINESS_RULES,
      tools_guide: {
        list_datasets: "استعراض/بحث مصادر البيانات وأعمدتها.",
        query_dataset: "استعلام عام مع فلاتر وترتيب وترقيم صفحات وعدد إجمالي.",
        get_record: "قراءة سجل واحد مع سجلاته المرتبطة.",
        inventory_balances: "أرصدة المخازن (فعلي/محجوز/متاح) بالوحدة والمخزن.",
        inventory_movements: "حركات الأصناف والتحويلات والجرد والهالك.",
        sales_report: "فصل قيمة الطلبات عن المبيعات المسلّمة والتحصيل.",
        manufacturing_report: "التصنيع والإنتاج الفعلي والتكاليف.",
        finance_report: "أرصدة الخزائن والمصروفات والإيرادات والمديونيات.",
      },
      code_review_note:
        "مراجعة كود المشروع غير متاحة عبر هذا الربط (أدوات البيانات فقط). لمشاركة الكود للمراجعة استخدم زر GitHub داخل Lovable لربط المستودع، أو تصدير نسخة ZIP من المشروع — بدون ملف .env أو أي مفاتيح سرية.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
