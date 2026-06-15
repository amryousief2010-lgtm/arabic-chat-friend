import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Warehouse, ArrowDownToLine, ArrowUpFromLine, RefreshCw, ShieldCheck, FileText, Repeat, AlertTriangle, BookOpen } from "lucide-react";

const Section = ({ title, icon: Icon, children, tone = "primary" }: any) => (
  <Card className="border-r-4" style={{ borderRightColor: `hsl(var(--${tone}))` }}>
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-lg">
        <Icon className="w-5 h-5 text-primary" />
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent className="text-sm leading-7 space-y-2">{children}</CardContent>
  </Card>
);

const Row = ({ k, v, color }: { k: string; v: string; color?: string }) => (
  <div className="flex justify-between border-b border-dashed border-muted pb-1.5">
    <span className="text-muted-foreground">{k}</span>
    <span className={`font-semibold ${color || ""}`}>{v}</span>
  </div>
);

const MainWarehouseGuide = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl mx-auto pb-12">
        {/* Hero */}
        <div className="flex items-center gap-4 bg-gradient-to-l from-primary/10 to-transparent p-5 rounded-2xl">
          <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center">
            <BookOpen className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">دليل تشغيل المخزن الرئيسي</h1>
            <p className="text-muted-foreground mt-1">
              شرح دورة الوارد والصادر، المحجوز والمتاح، منع التكرار، والصلاحيات
            </p>
          </div>
        </div>

        {/* 1. Definition */}
        <Section title="١. تعريف المخزن الرئيسي" icon={Warehouse}>
          <p>المخزن الرئيسي هو المركز الرئيسي لاستلام وصرف المنتجات الجاهزة. يقوم بـ:</p>
          <ul className="list-disc pr-6 space-y-1">
            <li>استقبال المنتجات الجاهزة من <strong>المجزر</strong> و<strong>مصنع اللحوم</strong>.</li>
            <li>استقبال التحويلات الراجعة من <strong>فرع العجوزة</strong> أو <strong>هايبر/كارفور/العملاء</strong>.</li>
            <li>صرف منتجات إلى <strong>العجوزة، هايبر هيلثي، كارفور، طلبات العملاء، صرف مباشر</strong>.</li>
            <li>الخصم من المخزون يتم عند <strong>التسليم الفعلي فقط</strong>.</li>
            <li>الاحتفاظ بسجل حركات كامل (وارد / صادر / تحويل / مرتجع / تسوية).</li>
          </ul>
        </Section>

        {/* 2. Inbound */}
        <Section title="٢. مصادر الوارد" icon={ArrowDownToLine} tone="emerald-500">
          <div className="grid md:grid-cols-2 gap-3">
            <div className="border rounded-lg p-3">
              <Badge className="mb-2 bg-emerald-500/15 text-emerald-700">من المجزر</Badge>
              <p>بعد الذبح، يتم توزيع الناتج. لو الوجهة = المخزن الرئيسي:</p>
              <ul className="list-disc pr-5 mt-1 space-y-0.5 text-xs">
                <li>تدخل الكمية في رصيد المخزن الرئيسي.</li>
                <li>تُسجَّل حركة وارد مع <code>stock_before</code> و<code>stock_after</code>.</li>
                <li>تُربط برقم عملية الذبح <code>slaughter_batch_id</code>.</li>
              </ul>
            </div>
            <div className="border rounded-lg p-3">
              <Badge className="mb-2 bg-blue-500/15 text-blue-700">من مصنع اللحوم</Badge>
              <p>عند توريد منتج نهائي من المصنع:</p>
              <ul className="list-disc pr-5 mt-1 space-y-0.5 text-xs">
                <li>يدخل في رصيد المخزن الرئيسي.</li>
                <li>تُربط الحركة برقم فاتورة التصنيع.</li>
                <li>لا يتم تكرار الوارد عند تحديث الصفحة (reference_id فريد).</li>
              </ul>
            </div>
            <div className="border rounded-lg p-3">
              <Badge className="mb-2 bg-amber-500/15 text-amber-700">مرتجع من العجوزة</Badge>
              <p>الفرع يرجّع منتجات → خصم من العجوزة + إضافة للرئيسي + تسجيل حركة تحويل/مرتجع.</p>
            </div>
            <div className="border rounded-lg p-3">
              <Badge className="mb-2 bg-purple-500/15 text-purple-700">مرتجع عميل / هايبر</Badge>
              <p>بعد الاعتماد، يدخل للمخزن الرئيسي مع تسجيل السبب وحالة المنتج.</p>
            </div>
          </div>
        </Section>

        {/* 3. Outbound */}
        <Section title="٣. مصادر الصادر" icon={ArrowUpFromLine} tone="orange-500">
          <ol className="list-decimal pr-6 space-y-2">
            <li><strong>تحويل إلى فرع العجوزة:</strong> خصم من الرئيسي + إضافة للعجوزة بعد الاستلام/الاعتماد. تظهر <code>stock_before/after</code> للطرفين.</li>
            <li><strong>توريد هايبر / كارفور:</strong> خصم من الرئيسي + تسجيل باسم الجهة ورقم إذن التوريد.</li>
            <li><strong>طلبات العملاء:</strong> لا تُخصم مباشرة — تُحجز فقط. الخصم الفعلي عند <code>delivered</code>.</li>
            <li><strong>صرف مباشر:</strong> خصم فوري مع تسجيل السبب والمستخدم.</li>
            <li><strong>تالف / تسوية جرد:</strong> تُسجَّل حركة تسوية بسبب واضح — ممنوع الحذف الصامت.</li>
          </ol>
        </Section>

        {/* 4. Available vs Reserved */}
        <Section title="٤. الرصيد الفعلي / المحجوز / المتاح" icon={RefreshCw} tone="blue-500">
          <div className="grid md:grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground">الرصيد الفعلي</div>
              <div className="text-2xl font-bold mt-1">100</div>
              <div className="text-xs mt-1">الموجود في المخزن</div>
            </div>
            <div className="rounded-lg bg-amber-500/10 p-3">
              <div className="text-xs text-amber-700">المحجوز</div>
              <div className="text-2xl font-bold mt-1">20</div>
              <div className="text-xs mt-1">طلبات مفتوحة لم تُسلَّم</div>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-3">
              <div className="text-xs text-emerald-700">المتاح للبيع</div>
              <div className="text-2xl font-bold mt-1">80</div>
              <div className="text-xs mt-1">الفعلي − المحجوز</div>
            </div>
          </div>
          <p className="text-center font-mono text-sm bg-muted/30 rounded p-2 mt-2">
            المتاح = الرصيد الفعلي − المحجوز
          </p>
        </Section>

        {/* 5. When to deduct */}
        <Section title="٥. متى يُخصم المخزون؟" icon={ShieldCheck} tone="red-500">
          <p>الخصم <strong>لا يتم</strong> عند تسجيل الطلب. يتم فقط عند:</p>
          <ul className="list-disc pr-6 space-y-1">
            <li>التسليم للعميل (<code>delivered</code>).</li>
            <li>تحويل فعلي لفرع أو جهة.</li>
            <li>توريد فعلي لهايبر أو كارفور.</li>
            <li>صرف مباشر.</li>
            <li>هالك أو تسوية جرد <em>معتمدة</em>.</li>
          </ul>
        </Section>

        {/* 6. Movement Log */}
        <Section title="٦. سجل الحركات" icon={FileText} tone="violet-500">
          <p>كل حركة تحتوي على الحقول التالية:</p>
          <div className="grid md:grid-cols-2 gap-2 text-xs">
            <Row k="التاريخ" v="created_at" />
            <Row k="نوع الحركة" v="in / out / transfer / return / adjustment / waste" />
            <Row k="الصنف + الوحدة" v="item_id + unit" />
            <Row k="الكمية" v="quantity" />
            <Row k="الرصيد قبل / بعد" v="stock_before / stock_after" />
            <Row k="المصدر / الوجهة" v="source / destination" />
            <Row k="المرجع" v="reference_id" />
            <Row k="المستخدم" v="created_by" />
          </div>
        </Section>

        {/* 7. Idempotency */}
        <Section title="٧. منع التكرار" icon={Repeat} tone="cyan-500">
          <p>كل حركة لها <code>reference_id</code> فريد. لو تم تنفيذها سابقًا، يتم تجاهلها برسالة "مسجلة مسبقًا".</p>
          <div className="bg-muted/40 rounded p-3 font-mono text-xs space-y-1">
            <div>slaughter_to_main_<span className="text-primary">{`{slaughter_batch_id}`}</span>_<span className="text-primary">{`{item_id}`}</span></div>
            <div>meat_factory_to_main_<span className="text-primary">{`{manufacturing_invoice_id}`}</span>_<span className="text-primary">{`{item_id}`}</span></div>
            <div>main_to_agouza_<span className="text-primary">{`{transfer_id}`}</span>_<span className="text-primary">{`{item_id}`}</span></div>
            <div>order_delivery_<span className="text-primary">{`{order_id}`}</span>_<span className="text-primary">{`{item_id}`}</span></div>
          </div>
        </Section>

        {/* 8. Permissions */}
        <Section title="٨. الصلاحيات" icon={ShieldCheck} tone="primary">
          <div className="grid md:grid-cols-2 gap-3 text-xs">
            <div className="border rounded p-3">
              <div className="font-bold mb-1">المدير العام / التنفيذي</div>
              رؤية كل المخازن، اعتماد التحويلات والتسويات، مراجعة التقارير، تعديل أخطاء بصلاحية إدارية.
            </div>
            <div className="border rounded p-3">
              <div className="font-bold mb-1">مسؤول المخزن الرئيسي</div>
              تسجيل وارد/صادر، استلام تحويل، تجهيز طلبات، طباعة تقارير. <em>لا يحذف حركات معتمدة.</em>
            </div>
            <div className="border rounded p-3">
              <div className="font-bold mb-1">مشرف المخازن</div>
              متابعة الأرصدة، مراجعة الحركات والتحويلات.
            </div>
            <div className="border rounded p-3">
              <div className="font-bold mb-1">المبيعات / الموديريتر</div>
              تسجيل طلبات العملاء، رؤية المتاح للبيع فقط. <em>ممنوع تعديل الرصيد يدويًا.</em>
            </div>
          </div>
        </Section>

        {/* 9. Reports */}
        <Section title="٩. التقارير المتاحة" icon={FileText} tone="emerald-500">
          <div className="grid md:grid-cols-2 gap-2 text-sm">
            {[
              "تقرير الرصيد الحالي",
              "تقرير الوارد",
              "تقرير الصادر",
              "تقرير التحويلات",
              "تقرير المرتجعات",
              "تقرير الهالك والتسويات",
              "تقرير المتاح والمحجوز",
              "تقرير حركة صنف معين",
              "تقرير جرد يومي / شهري",
              "تقرير قيمة المخزون",
            ].map((r) => (
              <div key={r} className="flex items-center gap-2 border rounded p-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span>{r}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">كل تقرير قابل للطباعة وتصدير Excel و PDF (عبر openPrintWindow بدعم العربية).</p>
        </Section>

        {/* 10. Workflow */}
        <Section title="١٠. دورة العمل العملية" icon={Repeat} tone="orange-500">
          <ol className="list-decimal pr-6 space-y-1.5">
            <li>المجزر أو مصنع اللحوم يرسل منتج للمخزن الرئيسي.</li>
            <li>مسؤول المخزن يستلم الكمية في النظام.</li>
            <li>النظام يضيف الكمية للرصيد ويسجل الحركة.</li>
            <li>تظهر الكمية في "المتاح للبيع".</li>
            <li>المبيعات تسجل طلب → الكمية تتحجز فقط.</li>
            <li>عند التسليم، يخصم النظام من الرصيد الفعلي.</li>
            <li>التحويلات والتوريدات تخصم بحركة تحويل/توريد.</li>
            <li>كل الحركات تظهر في السجل والتقارير.</li>
            <li>الجرد يقارن الرصيد الفعلي بالنظام، والفروقات تُسجَّل كتسويات معتمدة.</li>
          </ol>
        </Section>

        {/* 11. Safety */}
        <Section title="١١. تنبيهات أمان" icon={AlertTriangle} tone="red-500">
          <ul className="list-disc pr-6 space-y-1 text-amber-800">
            <li>لا تخصم/تضيف رصيدًا يدويًا — كل تعديل يجب أن يكون عبر حركة موثقة.</li>
            <li>لا تحذف حركة معتمدة — استخدم تسوية مضادة بسبب واضح.</li>
            <li>تأكد دائمًا أن <code>reference_id</code> فريد قبل الإدخال.</li>
            <li>الطلب المفتوح يحجز ولا يخصم — التسليم هو ما يخصم.</li>
          </ul>
        </Section>

        {/* Test scenario */}
        <Section title="١٢. مثال اختبار سريع" icon={ShieldCheck} tone="blue-500">
          <ol className="list-decimal pr-6 space-y-1">
            <li>وارد 10 كجم من المجزر → الرصيد +10.</li>
            <li>طلب عميل 3 كجم → المحجوز +3، المتاح −3 (الفعلي ثابت).</li>
            <li>تسليم الطلب → الفعلي −3، المحجوز −3.</li>
            <li>تحويل 2 كجم للعجوزة → الفعلي −2 (المخزن الرئيسي).</li>
            <li>محاولة تكرار نفس حركة الوارد → النظام يرفضها (reference_id موجود).</li>
          </ol>
        </Section>
      </div>
    </DashboardLayout>
  );
};

export default MainWarehouseGuide;
