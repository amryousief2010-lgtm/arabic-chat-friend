import { useLocation, Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Home, ArrowRight, Search, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/", { replace: true });
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(location.pathname + location.search);
      setCopied(true);
      toast.success("تم نسخ المسار");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("تعذّر نسخ المسار");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-muted/30 to-background p-4" dir="rtl">
      <div className="max-w-lg w-full text-center space-y-6">
        <div className="relative">
          <h1 className="text-[140px] leading-none font-extrabold bg-gradient-to-br from-primary to-accent bg-clip-text text-transparent select-none">
            404
          </h1>
          <Search className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-16 w-16 text-muted-foreground/20" />
        </div>

        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-foreground">الصفحة غير موجودة</h2>
          <p className="text-muted-foreground">
            عذراً، لم نتمكن من إيجاد الصفحة التي تبحث عنها.
          </p>
          <div className="inline-flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-md">
            <code className="text-xs text-foreground/80 font-mono ltr:text-left rtl:text-right" dir="ltr">
              {location.pathname}{location.search}
            </code>
            <button
              onClick={handleCopy}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="نسخ المسار"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
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
          إذا كنت تعتقد أن هذا خطأ، انسخ المسار وتواصل مع مسؤول النظام.
        </p>
      </div>
    </div>
  );
};

export default NotFound;
