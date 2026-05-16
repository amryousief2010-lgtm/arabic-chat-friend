import { useLocation, Link } from "react-router-dom";
import { ShieldAlert, Home, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const ROLE_LABELS: Record<string, string> = {
  general_manager: "المدير العام",
  executive_manager: "المدير التنفيذي",
  sales_manager: "مدير المبيعات",
  marketing_sales_manager: "مدير التسويق والمبيعات",
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
  const { role } = useAuth();
  const attempted = (location.state as { from?: string })?.from || location.pathname;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-destructive/5 to-background p-4" dir="rtl">
      <div className="max-w-lg w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="h-24 w-24 rounded-full bg-destructive/10 flex items-center justify-center">
            <ShieldAlert className="h-12 w-12 text-destructive" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">غير مصرّح بالدخول</h1>
          <p className="text-muted-foreground">
            ليس لديك الصلاحية لعرض هذه الصفحة.
          </p>
          {role && (
            <p className="text-sm text-muted-foreground">
              دورك الحالي: <span className="font-semibold text-foreground">{ROLE_LABELS[role] ?? role}</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground/70 font-mono bg-muted/50 inline-block px-3 py-1 rounded">
            {attempted}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <Button asChild size="lg" className="gap-2">
            <Link to="/">
              <Home className="h-4 w-4" />
              العودة للرئيسية
            </Link>
          </Button>
          <Button variant="outline" size="lg" className="gap-2" onClick={() => window.history.back()}>
            <ArrowRight className="h-4 w-4 rotate-180" />
            الرجوع للخلف
          </Button>
        </div>

        <p className="text-xs text-muted-foreground pt-6">
          إذا كنت تحتاج للوصول لهذه الصفحة، تواصل مع المدير العام لطلب الصلاحية المناسبة.
        </p>
      </div>
    </div>
  );
};

export default Unauthorized;
