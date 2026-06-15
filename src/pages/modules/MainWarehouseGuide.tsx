import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BookOpen, CheckCircle2, AlertTriangle } from "lucide-react";

const sections: { title: string; items: string[] }[] = [
  {
    title: "1) قاعدة الطلبات والمخزون",
    items: [
      "تسجيل الطلب ⇐ لا يخصم من المخزون.",
      "الطلب يحجز الكمية فقط (reserved) إن كان نظام الحجز مفعلًا.",
      "الخصم الفعلي يتم عند خروج الطلب من المخزن بحالة dispatched.",
      "الحالة delivered = تأكيد تسليم العميل فقط، بدون أي حركة مخزون جديدة.",
    ],
  },
  {
    title: "2) تاريخ بداية التشغيل الفعلي",
    items: [
      "يبقى التاريخ فارغًا (NULL) لحين إدخال الرصيد الافتتاحي لكل صنف.",
      "بعد اعتماد الرصيد، تحدد التاريخ من شاشة (تواريخ بداية التشغيل الفعلي).",
      "أي حركة صادر/تحويل/تسوية قبل التاريخ تُرفض على مستوى قاعدة البيانات.",
      "كل الحركات قبل التاريخ تعتبر تاريخية فقط ولا تؤثر على الرصيد.",
    ],
  },
  {
    title: "3) الرصيد الافتتاحي",
    items: [
      "افتح شاشة (الرصيد الافتتاحي للمخازن).",
      "اختر المخزن (الرئيسي / العجوزة) واكتب لكل صنف: الكمية الفعلية + سعر التكلفة + ملاحظات.",
      "احفظ كمسودة أولًا، ثم يطلب اعتماد المدير العام أو التنفيذي.",
      "بعد الاعتماد تُسجَّل حركة opening_balance بمرجع فريد لا يقبل التكرار.",
    ],
  },
  {
    title: "4) منع تكرار الحركات",
    items: [
      "كل حركة في inventory_movements لها reference_id (يولَّد تلقائيًا إن لم يُمرَّر).",
      "أنماط شائعة: opening_balance_{wh}_{item}_{date} — slaughter_to_main_{batch}_{item} — meat_factory_to_main_{invoice}_{item} — main_to_agouza_{transfer}_{item} — order_dispatch_{order}_{item} — return_order_{order}_{item} — stock_adjustment_{wh}_{item}_{date}.",
      "إعادة محاولة نفس الحركة لا تُسجَّل مرة أخرى.",
    ],
  },
  {
    title: "5) التحويلات بين المخازن",
    items: [
      "إنشاء تحويل ⇐ عند الإرسال يُخصم من المصدر.",
      "عند الاستلام يضاف إلى الوجهة. لو الاستلام ناقص ⇒ partially_received أو needs_manager_review.",
      "لا يوجد تعديل يدوي على الرصيد خارج هذه الدورة.",
    ],
  },
  {
    title: "6) الجرد والتسويات",
    items: [
      "لا يجوز تعديل رصيد الصنف مباشرة.",
      "أي فرق جرد يمر بتسوية: (نظام / فعلي / فرق / سبب / اعتماد مدير / حركة adjustment / Audit Log).",
      "زيادة ⇒ حركة وارد تسوية. نقص ⇒ حركة صادر تسوية.",
    ],
  },
];

export default function MainWarehouseGuide() {
  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 max-w-4xl mx-auto" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <BookOpen className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">دليل تشغيل المخزن الرئيسي</h1>
            <p className="text-sm text-muted-foreground">القواعد المعتمدة لدورة عمل المخازن الرئيسي والعجوزة.</p>
          </div>
          <Badge className="ms-auto bg-primary/10 text-primary">المرحلة 1</Badge>
        </div>

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            لا تُدخل تاريخ بداية تشغيل قبل اعتماد الرصيد الافتتاحي. الترتيب الصحيح: جرد ⇐ رصيد افتتاحي ⇐ اعتماد ⇐ تحديد التاريخ.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 gap-4">
          {sections.map((s, i) => (
            <Card key={i}>
              <CardHeader><CardTitle className="text-base">{s.title}</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {s.items.map((it, j) => (
                    <li key={j} className="flex gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
