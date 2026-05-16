import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Home, ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-muted/30 to-background p-4" dir="rtl">
      <div className="max-w-lg w-full text-center space-y-6">
        <div className="relative">
          <h1 className="text-[140px] leading-none font-extrabold bg-gradient-to-br from-primary to-accent bg-clip-text text-transparent select-none">
            404
          </h1>
          <Search className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-16 w-16 text-muted-foreground/20" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-foreground">الصفحة غير موجودة</h2>
          <p className="text-muted-foreground">
            عذراً، لم نتمكن من إيجاد الصفحة التي تبحث عنها.
          </p>
          <p className="text-xs text-muted-foreground/70 font-mono bg-muted/50 inline-block px-3 py-1 rounded">
            {location.pathname}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <Button asChild size="lg" className="gap-2">
            <Link to="/">
              <Home className="h-4 w-4" />
              العودة للرئيسية
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="gap-2" onClick={(e) => { e.preventDefault(); window.history.back(); }}>
            <a href="#">
              <ArrowRight className="h-4 w-4 rotate-180" />
              الرجوع للخلف
            </a>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground pt-6">
          إذا كنت تعتقد أن هذا خطأ، تواصل مع مسؤول النظام.
        </p>
      </div>
    </div>
  );
};

export default NotFound;
