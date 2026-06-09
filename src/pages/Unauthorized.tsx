import { useLocation, Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { ShieldAlert, Home, ArrowRight, Copy, Check, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const ROLE_LABELS: Record<string, string> = {
  general_manager: "المدير العام",
  executive_manager: "المدير التنفيذي",
  sales_manager: "مدير المبيعات",
  marketing_sales_manager: "مدير المبيعات",
  accountant: "محاسب",
  financial_manager: "المدير المالي",
  warehouse_supervisor: "مشرف المخازن",
  production_manager: "مدير الإنتاج",
  quality_manager: "مدير الجودة",
  meat_factory_manager: "مدير مصنع اللحوم",
  feed_factory_manager: "مدير مصنع الأعلاف",
  hr_manager: "مدير الموارد البشرية",
  sales_moderator: "موظفة مبيعات",
  private_delivery_rep: "مندوب توصيل خاص",
};

const Unauthorized = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const [copied, setCopied] = useState(false);

  const attempted = (location.state as { from?: string })?.from || "/";
  const reason = !user
    ? "لم يتم تسجيل الدخول أو انتهت الجلسة"
    : !role
      ? "لم يتم تعيين دور لحسابك بعد"
      : "دورك الحالي لا يملك صلاحية الوصول لهذه الصفحة";

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/", { replace: true });
    }
  };

  const handleCopy = async () => {
    const debugInfo = `Route: ${attempted}\nRole: ${role ?? "none"}\nReason: ${reason}`;
    try {
      await navigator.clipboard.writeText(debugInfo);
      setCopied(true);
      toast.success("تم نسخ تفاصيل الخطأ");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("تعذّر النسخ");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-destructive/5 to-background p-4" dir="rtl">
      <div className="max-w-lg w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="h-24 w-24 rounded-full bg-destructive/10 flex items-center justify-center">
            <ShieldAlert className="h-12 w-12 text-destructive" />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-foreground">غير مصرّح بالدخول</h1>
          <p className="text-muted-foreground">{reason}</p>

          <div className="bg-muted/50 rounded-lg p-4 text-right space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">المسار المطلوب:</span>
              <code className="font-mono text-foreground/90 text-xs bg-background/60 px-2 py-1 rounded" dir="ltr">
                {attempted}
              </code>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">الدور الحالي:</span>
              <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                <UserCog className="h-3.5 w-3.5" />
                {role ? (ROLE_LABELS[role] ?? role) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">سبب الرفض:</span>
              <span className="text-destructive font-medium text-xs">{reason}</span>
            </div>
          </div>

          <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-2">
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            نسخ تفاصيل الخطأ
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Button asChild size="lg" className="gap-2">
            <Link to="/">
              <Home className="h-4 w-4" />
              العودة للرئيسية
            </Link>
          </Button>
          <Button variant="outline" size="lg" className="gap-2" onClick={handleBack}>
            <ArrowRight className="h-4 w-4 rotate-180" />
            الرجوع للخلف
          </Button>
        </div>

        <p className="text-xs text-muted-foreground pt-6">
          إذا كنت تحتاج للوصول لهذه الصفحة، انسخ التفاصيل أعلاه وتواصل مع المدير العام.
        </p>
      </div>
    </div>
  );
};

export default Unauthorized;
