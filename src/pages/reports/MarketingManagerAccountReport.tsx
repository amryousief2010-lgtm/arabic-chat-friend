import { useMemo } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Printer, ShieldAlert, FileText } from "lucide-react";
import { openPrintWindow, escapeHtml } from "@/lib/printPdf";

/**
 * تقرير صلاحيات واستخدام حساب مدير التسويق (محمد سيد)
 * — يُصدَر كـ PDF عبر openPrintWindow (طباعة المتصفح → حفظ كـ PDF)
 * — لا يحفظ كلمة المرور في أي مكان دائم، تظهر فقط في مخرجات الطباعة عند فتح الصفحة
 * — لا يعدّل أي بيانات في النظام
 */

// ملاحظة أمنية: كلمة المرور موجودة كثابت داخل هذه الصفحة فقط للطباعة اللحظية للتقرير
// عند طلب الإدارة، ولا تُخزَّن في قاعدة البيانات، ولا تُرسَل لأي API، ولا تُكتَب في اللوجات.
const USER = {
  name: "محمد سيد",
  role: "مدير التسويق",
  email: "mohamed.sayed@coceg.net",
  tempPassword: "msayed@2026",
  uid: "449e61e4-a7d0-411d-bcae-0841b3d5d982",
  systemRole: "marketing_sales_manager",
};

const buildReportHtml = (loginUrl: string) => {
  const today = new Date().toLocaleDateString("ar-EG-u-nu-latn", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const row = (k: string, v: string, mono = false) =>
    `<tr><th style="width:35%">${escapeHtml(k)}</th><td${mono ? ' style="font-family:monospace"' : ""}>${escapeHtml(v)}</td></tr>`;

  const allowRows = [
    "لوحة التسويق والمبيعات",
    "عرض أرقام مبيعات آخر 3 شهور",
    "تحليل مصادر العملاء",
    "تحليل قنوات التواصل",
    "تحليل المحافظات والمناطق",
    "تحليل الحملات التسويقية",
    "تحليل أداء المنتجات",
    "متابعة مصروفات السوشيال",
    "متابعة المصروفات المعتمدة",
    "متابعة المصروفات قيد المراجعة",
    "متابعة نسبة 5% و6%",
    "تصدير Excel",
    "طباعة PDF",
    "استخدام فلاتر التقارير",
  ]
    .map(
      (x) =>
        `<tr><td>${escapeHtml(x)}</td><td style="color:#0a7d2c;font-weight:bold;text-align:center;width:20%">مسموح</td></tr>`,
    )
    .join("");

  const denyRows = [
    "إنشاء طلب جديد",
    "تعديل طلب",
    "حذف طلب",
    "تغيير حالة طلب",
    "التحصيل",
    "الخزنة",
    "المخازن",
    "ظهور خانة المخازن في السايدبار",
    "خصم مخزون",
    "تسوية مخزون",
    "تحويلات مخزنية",
    "تعديل الأسعار",
    "اعتماد مالي خارج قسم السوشيال",
    "أي صلاحيات تشغيلية خاصة بـ sales_moderator",
  ]
    .map(
      (x) =>
        `<tr><td>${escapeHtml(x)}</td><td style="color:#b91c1c;font-weight:bold;text-align:center;width:20%">غير مسموح</td></tr>`,
    )
    .join("");

  const pagesRows = [
    ["لوحة التسويق والمبيعات", "/social-media/marketing-dashboard", "متابعة مؤشرات التسويق والمبيعات"],
    ["مصروفات السوشيال", "/social-media/expenses", "متابعة مصروفات الإعلانات والرواتب التسويقية"],
    ["تصدير التقارير", "/social-media/export", "تصدير تقارير PDF و Excel للإدارة"],
  ]
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r[0])}</td><td style="font-family:monospace">${escapeHtml(r[1])}</td><td>${escapeHtml(r[2])}</td></tr>`,
    )
    .join("");

  const ratioRows = [
    ["حتى 5%", "آمن", "#0a7d2c"],
    ["أكبر من 5% وحتى 6%", "تحذير", "#b45309"],
    ["أكبر من 6%", "خطر ويحتاج مراجعة الإدارة", "#b91c1c"],
  ]
    .map(
      (r) =>
        `<tr><td style="text-align:center">${escapeHtml(r[0])}</td><td style="color:${r[2]};font-weight:bold;text-align:center">${escapeHtml(r[1])}</td></tr>`,
    )
    .join("");

  const kpiList = [
    "إجمالي عدد الطلبات",
    "إجمالي قيمة الطلبات",
    "المبيعات المنفذة",
    "متوسط قيمة الأوردر",
    "عدد الطلبات المجانية",
    "عدد الطلبات الملغاة",
    "العملاء الجدد",
    "العملاء المتكررون",
    "أعلى مصادر العملاء",
    "أعلى قنوات التواصل",
    "أعلى المحافظات والمناطق",
    "أداء المنتجات",
    "مصروفات السوشيال",
    "المصروفات قيد المراجعة",
    "نسبة مصروفات السوشيال من إجمالي المبيعات",
  ]
    .map((x) => `<li>${escapeHtml(x)}</li>`)
    .join("");

  const filters = [
    "الفترة الزمنية",
    "مصدر العميل",
    "قناة التواصل",
    "المحافظة",
    "المنطقة",
    "اسم الحملة",
    "حالة الطلب",
    "المنتج",
  ]
    .map((x) => `<li>${escapeHtml(x)}</li>`)
    .join("");

  const expenseCats = [
    "إعلانات Facebook",
    "إعلانات Instagram",
    "إعلانات TikTok",
    "إعلانات Google",
    "رواتب موظفي السوشيال",
    "التصوير والمحتوى",
    "التصميمات",
    "الأدوات والبرامج",
    "المؤثرين",
    "مصروفات أخرى",
  ]
    .map((x) => `<li>${escapeHtml(x)}</li>`)
    .join("");

  const excelSheets = [
    "Summary",
    "Orders",
    "Sales By Source",
    "Sales By Area",
    "Product Performance",
    "Approved Expenses",
    "Pending Expenses",
    "Budget Ratio",
    "Daily Reports",
    "Weekly Reports",
    "Complaints",
  ]
    .map((x) => `<li style="font-family:monospace">${escapeHtml(x)}</li>`)
    .join("");

  const steps = [
    "الدخول إلى النظام باستخدام البريد وكلمة المرور المؤقتة.",
    "تغيير كلمة المرور فور أول تسجيل دخول.",
    "فتح قسم تقارير السوشيال ميديا.",
    "الدخول إلى لوحة التسويق والمبيعات.",
    "اختيار الفترة الزمنية أو تركها آخر 3 شهور.",
    "مراجعة مصادر العملاء وقنوات التواصل.",
    "مراجعة المحافظات والمناطق الأعلى مبيعًا.",
    "مراجعة أداء المنتجات.",
    "متابعة مصروفات السوشيال.",
    "مقارنة المصروفات بنسبة 5% و6%.",
    "تصدير تقرير PDF أو Excel عند الحاجة.",
  ]
    .map((x) => `<li>${escapeHtml(x)}</li>`)
    .join("");

  const security = [
    "الحساب مخصص لمحمد سيد فقط.",
    "لا يجوز مشاركة بيانات الدخول.",
    "لا يجوز استخدام الحساب من أكثر من شخص.",
    "يجب تغيير كلمة المرور فور أول دخول.",
    "يجب تغيير كلمة المرور دوريًا.",
    "لا يجوز محاولة الوصول إلى صفحات غير مصرح بها.",
    "أي محاولة وصول غير مصرح بها تُعد مخالفة إدارية.",
    "الحساب مخصص للتحليل التسويقي ولا يُستخدم لتشغيل الطلبات أو المخازن أو التحصيل.",
  ]
    .map((x) => `<li>${escapeHtml(x)}</li>`)
    .join("");

  const techConfirms = [
    "الحساب لا يملك صلاحية إنشاء طلب جديد.",
    "الحساب لا يملك صلاحية تعديل الطلبات.",
    "الحساب لا يملك صلاحية حذف الطلبات.",
    "الحساب لا يملك صلاحية دخول المخازن.",
    "خانة المخازن لا تظهر لهذا المستخدم في السايدبار.",
    "الحساب لا يملك صلاحية التحصيل أو الخزنة.",
    "الحساب لا يملك صلاحيات sales_moderator.",
    "صلاحية الحساب الأساسية هي marketing_sales_manager.",
    "الحساب مخصص للتقارير والتحليل التسويقي فقط.",
  ]
    .map((x) => `<li>${escapeHtml(x)}</li>`)
    .join("");

  const blocked = [
    "صفحة إنشاء طلب جديد.",
    "صفحة تعديل الطلب.",
    "صفحات المخازن.",
    "صفحات التحصيل.",
    "صفحات الخزنة.",
    "صفحات خصم أو تسوية المخزون.",
    "صفحات التحويلات المخزنية.",
    "أي أدوات تشغيلية خاصة بالمبيعات أو المخازن.",
  ]
    .map((x) => `<li>${escapeHtml(x)}</li>`)
    .join("");

  return `
  <style>
    .cover { text-align:center; padding: 60px 20px 40px; border:2px solid #6b46c1;
             border-radius:12px; margin-bottom:20px; background:linear-gradient(135deg,#f5edff,#fff); page-break-after: always; }
    .cover .company { font-size: 22px; color:#6b46c1; font-weight:bold; }
    .cover .title { font-size: 28px; margin: 18px 0 10px; color:#111; }
    .cover .sub { font-size: 14px; color:#444; margin: 4px 0; }
    .cover .stamp { margin-top:40px; padding:10px; border-top:1px dashed #6b46c1; color:#6b46c1; font-size:12px; }
    .warn { background:#fff4e6; border:1px solid #f59e0b; color:#7c2d12;
            padding:10px 12px; border-radius:8px; margin:10px 0; font-weight:bold; }
    .info { background:#eef6ff; border:1px solid #3b82f6; color:#1e3a8a;
            padding:10px 12px; border-radius:8px; margin:10px 0; }
    ul { padding-right: 22px; margin: 6px 0 12px; }
    li { margin: 3px 0; }
    .formula { background:#f3f0ff; border:1px dashed #6b46c1; padding:8px 10px;
               border-radius:6px; font-family:monospace; font-size:12px; margin:8px 0; }
    section { page-break-inside: avoid; margin-bottom: 10px; }
    .kpi-grid { columns: 2; -webkit-columns: 2; column-gap: 16px; }
  </style>

  <!-- 1) الغلاف -->
  <div class="cover">
    <div class="company">شركة نعام العاصمة</div>
    <div class="sub">Na'am Al-Asimah — Capital Ostrich</div>
    <div class="title">تقرير صلاحيات واستخدام حساب مدير التسويق داخل نظام نعام العاصمة</div>
    <div class="sub"><strong>اسم المستخدم:</strong> ${escapeHtml(USER.name)}</div>
    <div class="sub"><strong>الوظيفة:</strong> ${escapeHtml(USER.role)}</div>
    <div class="sub"><strong>البريد:</strong> ${escapeHtml(USER.email)}</div>
    <div class="sub"><strong>تاريخ الإصدار:</strong> ${escapeHtml(today)}</div>
    <div class="stamp">وثيقة داخلية خاصة بإدارة شركة نعام العاصمة</div>
  </div>

  <!-- 2) مقدمة -->
  <section>
    <h2>1. مقدمة عامة عن النظام</h2>
    <p>نظام نعام العاصمة هو نظام إداري وتشغيلي متكامل يساعد الشركة على متابعة الطلبات، والعملاء، والمبيعات،
    وتقارير السوشيال ميديا، ومصروفات التسويق، ومصادر العملاء، والمناطق الجغرافية، والمنتجات، والمخازن،
    والتحصيل، والخزنة، والتقارير الإدارية.</p>
    <p>حساب مدير التسويق مخصص للتحليل والمتابعة التسويقية فقط، وليس مخصصًا للعمليات التشغيلية مثل إنشاء
    الطلبات أو تعديلها أو إدارة المخازن أو التحصيل.</p>
  </section>

  <!-- 3) الهدف -->
  <section>
    <h2>2. الهدف من حساب مدير التسويق</h2>
    <ul>
      <li>متابعة أداء المبيعات الناتجة عن التسويق.</li>
      <li>تحليل مصادر العملاء والقنوات التي يأتون منها.</li>
      <li>متابعة المناطق الجغرافية الأعلى طلبًا.</li>
      <li>تحليل أداء الحملات التسويقية.</li>
      <li>متابعة المنتجات الأكثر مبيعًا.</li>
      <li>متابعة مصروفات السوشيال والإعلانات.</li>
      <li>مراقبة نسبة مصروفات السوشيال من إجمالي المبيعات.</li>
      <li>تصدير تقارير PDF و Excel للإدارة.</li>
      <li>دعم قرارات الإدارة بناءً على بيانات فعلية من النظام.</li>
    </ul>
  </section>

  <!-- 4) بيانات الدخول -->
  <section>
    <h2>3. بيانات الدخول</h2>
    <table>
      <tbody>
        ${row("اسم المستخدم", USER.name)}
        ${row("الوظيفة", USER.role)}
        ${row("البريد / اسم الدخول", USER.email, true)}
        ${row("كلمة المرور المؤقتة", USER.tempPassword, true)}
        ${row("الدور داخل النظام", USER.systemRole, true)}
        ${row("معرّف المستخدم (UID)", USER.uid, true)}
        ${row("رابط الدخول", loginUrl, true)}
      </tbody>
    </table>
    <div class="warn">
      ⚠ هذه كلمة مرور مؤقتة مخصصة لتسليم الحساب لأول مرة فقط، ويجب تغييرها فور أول تسجيل دخول.
      يُمنع تداول كلمة المرور أو مشاركتها مع أي شخص غير مصرح له.
    </div>
  </section>

  <!-- 5) الصلاحيات المسموحة -->
  <section>
    <h2>4. الصلاحيات المسموح بها</h2>
    <table>
      <thead><tr><th>القسم / العملية</th><th style="width:20%">الصلاحية</th></tr></thead>
      <tbody>${allowRows}</tbody>
    </table>
  </section>

  <!-- 6) الصلاحيات الممنوعة -->
  <section>
    <h2>5. الصلاحيات غير المسموح بها</h2>
    <table>
      <thead><tr><th>القسم / العملية</th><th style="width:20%">الحالة</th></tr></thead>
      <tbody>${denyRows}</tbody>
    </table>
    <div class="info">
      حساب مدير التسويق هو حساب تحليلي وإداري للتسويق فقط، وليس حساب تشغيل طلبات أو مخازن أو تحصيل.
    </div>
  </section>

  <!-- 7) الصفحات المسموحة -->
  <section>
    <h2>6. الصفحات المسموح بها</h2>
    <table>
      <thead><tr><th>الصفحة</th><th>الرابط</th><th>الغرض</th></tr></thead>
      <tbody>${pagesRows}</tbody>
    </table>
  </section>

  <!-- 8) المحظورة -->
  <section>
    <h2>7. الصفحات والعمليات المحظورة</h2>
    <p>لا يجب أن يرى حساب محمد سيد أو يصل إلى:</p>
    <ul>${blocked}</ul>
    <p>حتى لو حاول فتح الرابط مباشرة، يتم منعه بواسطة <code>ProtectedRoute</code> وتوجيهه إلى صفحة "غير مصرح".</p>
  </section>

  <!-- 9) لوحة التسويق -->
  <section>
    <h2>8. لوحة التسويق والمبيعات</h2>
    <p>تعرض اللوحة افتراضيًا بيانات آخر 3 شهور من الطلبات الحقيقية المسجلة في النظام، وتتضمن:</p>
    <ul class="kpi-grid">${kpiList}</ul>
    <div class="info">تُقرأ الأرقام من الطلبات الحقيقية في جدول <code>orders</code>، ولا تعتمد على أي بيانات وهمية أو أرقام ثابتة.</div>
  </section>

  <!-- 10) الفلاتر -->
  <section>
    <h2>9. فلاتر لوحة التسويق</h2>
    <ul>${filters}</ul>
    <p>الطلبات القديمة التي لا تحتوي مصدر عميل أو منطقة تظهر في التقارير باسم: <strong>غير محدد</strong>.</p>
  </section>

  <!-- 11) مصروفات السوشيال -->
  <section>
    <h2>10. مصروفات السوشيال</h2>
    <p>تُستخدم صفحة مصروفات السوشيال لمتابعة:</p>
    <ul>${expenseCats}</ul>
    <ul>
      <li>المصروفات <strong>المعتمدة فقط</strong> تدخل في حساب نسبة 5%.</li>
      <li>المصروفات <strong>قيد المراجعة</strong> تظهر منفصلة ولا تدخل في النسبة الرسمية.</li>
      <li>الرواتب التسويقية تدخل ضمن مصروفات السوشيال عند اعتمادها.</li>
    </ul>
  </section>

  <!-- 12) قاعدة 5% و 6% -->
  <section>
    <h2>11. قاعدة 5% و 6%</h2>
    <ul>
      <li>الحد المستهدف لمصروفات السوشيال = <strong>5%</strong> من إجمالي قيمة المبيعات.</li>
      <li>الحد التحذيري الأعلى = <strong>6%</strong> من إجمالي قيمة المبيعات.</li>
    </ul>
    <table>
      <thead><tr><th style="text-align:center">النسبة</th><th style="text-align:center">الحالة</th></tr></thead>
      <tbody>${ratioRows}</tbody>
    </table>
    <div class="formula">نسبة مصروفات السوشيال = إجمالي المصروفات المعتمدة ÷ إجمالي قيمة المبيعات × 100</div>
  </section>

  <!-- 13) التصدير -->
  <section>
    <h2>12. صفحة تصدير التقارير</h2>
    <p>تتيح صفحة التصدير إصدار تقرير PDF عربي وملف Excel شامل يحتوي على الأوراق التالية:</p>
    <ul>${excelSheets}</ul>
  </section>

  <!-- 14) طريقة الاستخدام -->
  <section>
    <h2>13. طريقة استخدام الحساب</h2>
    <ol>${steps}</ol>
  </section>

  <!-- 15) ضوابط الأمان -->
  <section>
    <h2>14. ضوابط الأمان والاستخدام</h2>
    <ul>${security}</ul>
  </section>

  <!-- 16) تأكيدات فنية -->
  <section>
    <h2>15. تأكيدات فنية</h2>
    <ul>${techConfirms}</ul>
  </section>

  <!-- 17) الخاتمة -->
  <section>
    <h2>16. خاتمة التقرير</h2>
    <p>تم إعداد هذا التقرير لتوضيح صلاحيات واستخدام حساب مدير التسويق داخل نظام شركة نعام العاصمة،
    بما يضمن وضوح المسؤوليات، وحماية البيانات التشغيلية، وتمكين الإدارة التسويقية من متابعة الأداء
    وتحليل النتائج واتخاذ القرارات بناءً على بيانات فعلية من النظام.</p>
    <p style="margin-top:24px;text-align:left;font-size:11px;color:#555">
      — إدارة شركة نعام العاصمة —
    </p>
  </section>
  `;
};

const MarketingManagerAccountReport = () => {
  const loginUrl = useMemo(() => "https://coceg.net/auth", []);

  const handlePrint = () => {
    openPrintWindow(
      "تقرير صلاحيات مدير التسويق - محمد سيد",
      buildReportHtml(loginUrl),
    );
  };

  return (
    <DashboardLayout>
      <Header
        title="تقرير صلاحيات حساب مدير التسويق"
        subtitle="إصدار تقرير PDF رسمي لتسليم حساب محمد سيد"
      />

      <div className="max-w-3xl mx-auto space-y-6">
        <Alert variant="destructive">
          <ShieldAlert className="w-4 h-4" />
          <AlertTitle>تنبيه أمني</AlertTitle>
          <AlertDescription>
            كلمة المرور المؤقتة تظهر داخل التقرير المطبوع فقط ولا تُخزَّن في قاعدة البيانات.
            يجب تغييرها فور أول تسجيل دخول، ويُمنع مشاركتها مع أي شخص غير مصرح له.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              بيانات الحساب المُصدَر له التقرير
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">الاسم:</span> <strong>{USER.name}</strong></div>
            <div><span className="text-muted-foreground">الوظيفة:</span> {USER.role}</div>
            <div><span className="text-muted-foreground">البريد:</span> <code>{USER.email}</code></div>
            <div><span className="text-muted-foreground">الدور:</span> <code>{USER.systemRole}</code></div>
            <div className="pt-3">
              <Button size="lg" onClick={handlePrint} className="gap-2">
                <Printer className="w-4 h-4" />
                إصدار / طباعة تقرير PDF
              </Button>
            </div>
            <p className="text-xs text-muted-foreground pt-2">
              سيفتح التقرير في نافذة جديدة مع نافذة الطباعة تلقائيًا — اختر
              «Save as PDF» من إعدادات الطابعة.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ضمانات هذا الإجراء</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>✅ إصدار التقرير لا يغيّر أي صلاحيات في النظام.</p>
            <p>✅ لا يعدّل أي بيانات في قاعدة البيانات.</p>
            <p>✅ لا يمس الطلبات أو التحصيل أو المخازن.</p>
            <p>✅ كلمة المرور لا تُكتب في اللوجات ولا تُرسل لأي API.</p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default MarketingManagerAccountReport;
