import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Lock, Database, UserCheck, FileText, Mail } from "lucide-react";

export default function Trust() {
  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-primary">
            <Shield className="w-6 h-6" />
            <span className="text-sm font-medium">الأمان والخصوصية</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold">مركز الثقة</h1>
          <p className="text-muted-foreground leading-relaxed">
            هذه الصفحة يديرها فريق "كابيتال أوستريتش" للإجابة على الأسئلة الشائعة حول
            الأمان والخصوصية وحماية البيانات داخل نظام إدارة المبيعات. المحتوى قابل للتعديل
            من قِبل الإدارة ولا يُعدّ شهادة مستقلة.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-primary" />
              الوصول والمصادقة
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed">
            <p>• تسجيل الدخول يتم عبر حساب موظف بكلمة مرور خاصة وجلسات آمنة.</p>
            <p>• كل مستخدم يحصل على دور (أو أكثر) يحدد ما يستطيع رؤيته وتعديله.</p>
            <p>• الصلاحيات الحساسة (المخازن، الخزائن، المرتبات، الطلبات المالية) مقصورة على المدراء المعنيين.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-primary" />
              حماية البيانات
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed">
            <p>• الاتصال بين متصفح المستخدم والخوادم مشفّر باستخدام HTTPS.</p>
            <p>• قواعد الوصول على مستوى الصف (Row-Level Security) مفعّلة على جداول البيانات الحساسة.</p>
            <p>• المرفقات المالية والإيصالات تُحفظ في خزائن خاصة لا يصل إليها إلا الموظفون المخوّلون.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              البنية التحتية
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed">
            <p>• النظام يعمل على بنية Lovable Cloud المدارة، مع نسخ احتياطية دورية لقاعدة البيانات.</p>
            <p>• تحديثات النظام يتم نشرها بشكل مستمر ومراجعتها قبل التطبيق.</p>
            <p>• مسؤولية حماية حسابات الموظفين (كلمات المرور، الأجهزة) مشتركة بين الإدارة والمستخدم.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              جمع البيانات والاحتفاظ بها
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed">
            <p>• النظام يستخدم داخلياً لإدارة عمليات الشركة، ولا تُشارك البيانات مع أطراف خارجية إلا للضرورة التشغيلية (شركات الشحن، بوابات الدفع).</p>
            <p>• تُحفظ سجلات العمليات والتدقيق لأغراض المراجعة المالية والإدارية.</p>
            <p>• لطلب حذف بيانات أو الاستفسار عنها، يرجى التواصل مع إدارة النظام.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              التواصل والإبلاغ عن مشكلات الأمان
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed">
            <p>
              لأي مخاوف تتعلق بالأمان أو الخصوصية أو الإبلاغ عن ثغرة محتملة، يرجى
              التواصل مع الإدارة العامة عبر القنوات الداخلية للشركة.
            </p>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center pt-4">
          هذه الصفحة محتوى يديره مالك التطبيق ولا يمثل تحققاً مستقلاً من Lovable.
        </p>
      </div>
    </div>
  );
}
