import { useRef, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { ROLE_GUIDES, type RoleGuide } from "@/data/roleGuides";
import { toast } from "sonner";
import {
  BookOpen,
  Package,
  Bell,
  ClipboardList,
  UsersRound,
  UserCheck,
  Network,
  ArrowLeft,
  Sparkles,
  Search,
  Printer,
  Download,
  CheckCircle2,
  RotateCcw,
  CalendarClock,
} from "lucide-react";


export default function QuickGuide() {
  const { user, role, profile, isGeneralManager } = useAuth();
  const printRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [refQuery, setRefQuery] = useState("");
  const [downloading, setDownloading] = useState(false);
  const { completed, toggle, setMany } = useTaskProgress(user?.id);

  const myGuide = ROLE_GUIDES.find((g) => g.role === role);
  const otherGuides = ROLE_GUIDES.filter((g) => g.role !== role);

  const normalized = query.trim().toLowerCase();
  const filteredLinks = useMemo(() => {
    if (!myGuide) return [];
    if (!normalized) return myGuide.links;
    return myGuide.links.filter(
      (l) =>
        l.label.toLowerCase().includes(normalized) ||
        l.desc.toLowerCase().includes(normalized) ||
        l.path.toLowerCase().includes(normalized),
    );
  }, [myGuide, normalized]);

  const refNormalized = refQuery.trim().toLowerCase();
  const filteredOtherGuides = useMemo(() => {
    if (!refNormalized) return otherGuides;
    return otherGuides
      .map((g) => {
        const matchRole =
          g.title.toLowerCase().includes(refNormalized) ||
          g.summary.toLowerCase().includes(refNormalized) ||
          g.role.toLowerCase().includes(refNormalized);
        const links = g.links.filter(
          (l) =>
            l.label.toLowerCase().includes(refNormalized) ||
            l.desc.toLowerCase().includes(refNormalized),
        );
        if (matchRole) return g;
        if (links.length) return { ...g, links };
        return null;
      })
      .filter(Boolean) as RoleGuide[];
  }, [otherGuides, refNormalized]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = async () => {
    if (!printRef.current || !myGuide) return;
    try {
      setDownloading(true);
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`دليل-${myGuide.title}.pdf`);
      toast.success("تم تحميل الدليل بصيغة PDF");
    } catch (e) {
      console.error(e);
      toast.error("تعذّر إنشاء ملف PDF");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <DashboardLayout>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
      <div className="space-y-6" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">دليل الموظف السريع</h1>
              <p className="text-sm text-muted-foreground">
                صفحاتك اليومية حسب دورك في الشركة — للوصول السريع للمهام المتكررة.
              </p>
            </div>
          </div>
          {myGuide && (
            <div className="flex gap-2 no-print">
              <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
                <Printer className="w-4 h-4" /> طباعة
              </Button>
              <Button size="sm" onClick={handleDownloadPdf} disabled={downloading} className="gap-2">
                <Download className="w-4 h-4" />
                {downloading ? "جارٍ التحميل..." : "تحميل PDF"}
              </Button>
            </div>
          )}
        </div>

        {profile && (
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertTitle>
              مرحبًا {profile.full_name || profile.email} 👋
            </AlertTitle>
            <AlertDescription>
              {myGuide
                ? `دورك الحالي: ${myGuide.title} — ${myGuide.summary}`
                : "لم يتم تحديد دور لك بعد. يُرجى مراجعة المدير العام."}
            </AlertDescription>
          </Alert>
        )}

        <div ref={printRef} className="space-y-6 bg-background">
          {myGuide && (
            <Card className="border-primary/40 shadow-md">
              <CardHeader className={`bg-gradient-to-l ${myGuide.color} text-white rounded-t-lg`}>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <UserCheck className="w-5 h-5" />
                    مهامك اليومية — {myGuide.title}
                  </span>
                  <Badge variant="secondary" className="text-foreground">
                    {filteredLinks.length} / {myGuide.links.length} صفحات
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="relative no-print">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ابحث عن صفحة أو مهمة..."
                    className="pr-9"
                  />
                </div>
                {filteredLinks.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6">
                    لا توجد نتائج مطابقة لبحثك.
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredLinks.map((l) => (
                      <Link key={l.path} to={l.path}>
                        <Card className="hover:border-primary hover:shadow transition cursor-pointer h-full">
                          <CardContent className="p-4 flex items-start gap-3">
                            <div className="p-2 rounded-md bg-primary/10 text-primary flex-shrink-0">
                              <l.icon className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm flex items-center justify-between gap-2">
                                <span>{l.label}</span>
                                <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground" />
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">{l.desc}</div>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="w-4 h-4" />
                صفحات مشتركة لكل الموظفين
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Link to="/notifications">
                  <Button variant="outline" className="w-full justify-start gap-2">
                    <Bell className="w-4 h-4" /> الإشعارات
                  </Button>
                </Link>
                <Link to="/permissions">
                  <Button variant="outline" className="w-full justify-start gap-2">
                    <ClipboardList className="w-4 h-4" /> صلاحياتي
                  </Button>
                </Link>
                <Link to="/org-chart">
                  <Button variant="outline" className="w-full justify-start gap-2">
                    <Network className="w-4 h-4" /> الهيكل التنظيمي
                  </Button>
                </Link>
                <Link to="/install">
                  <Button variant="outline" className="w-full justify-start gap-2">
                    <Package className="w-4 h-4" /> تثبيت التطبيق
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {isGeneralManager && (
          <Card className="no-print">
            <CardHeader className="space-y-3">
              <CardTitle className="text-base flex items-center gap-2">
                <UsersRound className="w-4 h-4" />
                مرجع كامل لجميع الأدوار (للمدير العام)
              </CardTitle>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={refQuery}
                  onChange={(e) => setRefQuery(e.target.value)}
                  placeholder="ابحث عن دور أو صفحة..."
                  className="pr-9"
                />
              </div>
            </CardHeader>
            <CardContent>
              {filteredOtherGuides.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">
                  لا توجد أدوار مطابقة.
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {filteredOtherGuides.map((g) => (
                    <Card key={g.role} className="overflow-hidden">
                      <div className={`h-2 bg-gradient-to-l ${g.color}`} />
                      <CardContent className="p-4">
                        <div className="font-semibold mb-1">{g.title}</div>
                        <div className="text-xs text-muted-foreground mb-3">{g.summary}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {g.links.map((l) => (
                            <Link key={l.path} to={l.path}>
                              <Badge variant="secondary" className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition gap-1">
                                <l.icon className="w-3 h-3" />
                                {l.label}
                              </Badge>
                            </Link>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
