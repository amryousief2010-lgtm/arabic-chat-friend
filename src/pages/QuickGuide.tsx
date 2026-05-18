import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useTaskProgress, todayKey, weekKey } from "@/hooks/useTaskProgress";
import { useReminderPrefs } from "@/hooks/useReminderPrefs";
import { useTaskHistory, writeTodaySnapshot } from "@/hooks/useTaskHistory";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ROLE_GUIDES, type RoleGuide, type GuideLink } from "@/data/roleGuides";
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
  ChevronDown,
  CircleDashed,
  ListChecks,
  History as HistoryIcon,
  Settings,
  XCircle,
} from "lucide-react";


export default function QuickGuide() {
  const { user, role, profile, isGeneralManager } = useAuth();
  const printRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [refQuery, setRefQuery] = useState("");
  const [downloading, setDownloading] = useState(false);
  const { completed, toggle: rawToggle, setMany } = useTaskProgress(user?.id);
  const { prefs, update: updatePrefs } = useReminderPrefs(user?.id);
  const [historyToken, setHistoryToken] = useState(0);
  const { entries: history, weekly: weeklyHistory } = useTaskHistory(user?.id, historyToken);

  const myGuide = ROLE_GUIDES.find((g) => g.role === role);
  const otherGuides = ROLE_GUIDES.filter((g) => g.role !== role);

  const dailyLinks = useMemo(
    () => (myGuide ? myGuide.links.filter((l) => (l.cadence ?? "daily") === "daily") : []),
    [myGuide],
  );
  const weeklyLinks = useMemo(
    () => (myGuide ? myGuide.links.filter((l) => l.cadence === "weekly") : []),
    [myGuide],
  );

  const stats = useMemo(() => {
    const total = (myGuide?.links.length ?? 0);
    const done = myGuide ? myGuide.links.filter((l) => completed[l.path]).length : 0;
    const dailyDone = dailyLinks.filter((l) => completed[l.path]).length;
    const weeklyDone = weeklyLinks.filter((l) => completed[l.path]).length;
    return {
      total,
      done,
      remaining: total - done,
      pct: total ? Math.round((done / total) * 100) : 0,
      dailyDone,
      dailyTotal: dailyLinks.length,
      weeklyDone,
      weeklyTotal: weeklyLinks.length,
    };
  }, [myGuide, completed, dailyLinks, weeklyLinks]);

  // Persist a daily snapshot for the history view whenever progress changes.
  useEffect(() => {
    if (!user?.id || !myGuide) return;
    writeTodaySnapshot(user.id, {
      dailyDone: stats.dailyDone,
      dailyTotal: stats.dailyTotal,
      weeklyDone: stats.weeklyDone,
      weeklyTotal: stats.weeklyTotal,
    });
    setHistoryToken((t) => t + 1);
  }, [user?.id, myGuide, stats.dailyDone, stats.dailyTotal, stats.weeklyDone, stats.weeklyTotal]);

  // Toggle wrapper: also surfaces an in-app toast on every change.
  const toggle = useCallback(
    (path: string) => {
      const link = myGuide?.links.find((l) => l.path === path);
      const wasDone = !!completed[path];
      rawToggle(path);
      if (prefs.toastOnToggle && link) {
        if (!wasDone) {
          toast.success(`تم إكمال: ${link.label}`, {
            description: link.cadence === "weekly" ? "ضمن مهامك الأسبوعية" : "ضمن مهامك اليومية",
            duration: 3000,
          });
        } else {
          toast(`تم إلغاء الإكمال: ${link.label}`, {
            description: "أعيدت المهمة إلى قائمة المتبقّي.",
            duration: 3000,
          });
        }
      }
    },
    [myGuide, completed, rawToggle, prefs.toastOnToggle],
  );

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

  /** Build an off-screen HTML container, render to PDF, then remove. */
  const renderHtmlToPdf = async (filename: string, html: string) => {
    const container = document.createElement("div");
    container.setAttribute("dir", "rtl");
    container.style.cssText =
      "position:fixed;top:-99999px;right:0;width:800px;background:#ffffff;color:#111827;padding:24px;font-family:'Tajawal','Segoe UI',Arial,sans-serif;";
    container.innerHTML = html;
    document.body.appendChild(container);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
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
      pdf.save(filename);
    } finally {
      document.body.removeChild(container);
    }
  };

  const escapeHtml = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

  const linksTableHtml = (links: GuideLink[], showStatus = false) => {
    if (!links.length) return `<p style="color:#6b7280">لا توجد مهام.</p>`;
    return `<table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f3f4f6;text-align:right">
        ${showStatus ? '<th style="padding:8px;border:1px solid #e5e7eb;width:60px">الحالة</th>' : ""}
        <th style="padding:8px;border:1px solid #e5e7eb">المهمة</th>
        <th style="padding:8px;border:1px solid #e5e7eb">الوصف</th>
        <th style="padding:8px;border:1px solid #e5e7eb">المسار</th>
      </tr></thead><tbody>
      ${links
        .map((l) => {
          const done = !!completed[l.path];
          return `<tr>
            ${
              showStatus
                ? `<td style="padding:8px;border:1px solid #e5e7eb;text-align:center;color:${done ? "#059669" : "#9ca3af"};font-weight:bold">${done ? "✓ مكتمل" : "○ متبقّي"}</td>`
                : ""
            }
            <td style="padding:8px;border:1px solid #e5e7eb">${escapeHtml(l.label)}</td>
            <td style="padding:8px;border:1px solid #e5e7eb;color:#4b5563">${escapeHtml(l.desc)}</td>
            <td style="padding:8px;border:1px solid #e5e7eb;font-family:monospace;color:#6d28d9;direction:ltr;text-align:left">${escapeHtml(l.path)}</td>
          </tr>`;
        })
        .join("")}
      </tbody></table>`;
  };

  const headerHtml = (subtitle: string) => `
    <div style="border-bottom:3px solid #6d28d9;padding-bottom:12px;margin-bottom:16px">
      <div style="font-size:22px;font-weight:bold;color:#6d28d9">دليل الموظف السريع</div>
      <div style="font-size:14px;color:#374151;margin-top:4px">${escapeHtml(myGuide?.title ?? "")} — ${escapeHtml(subtitle)}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px">${new Date().toLocaleString("ar-EG")}</div>
    </div>`;

  const exportCadencePdf = async (cadence: "daily" | "weekly") => {
    if (!myGuide) return;
    const links = cadence === "daily" ? dailyLinks : weeklyLinks;
    const title = cadence === "daily" ? "المهام اليومية" : "المهام الأسبوعية";
    try {
      setDownloading(true);
      const html = `${headerHtml(title)}<h2 style="font-size:16px;margin:0 0 8px">${title} (${links.length})</h2>${linksTableHtml(links)}`;
      await renderHtmlToPdf(`دليل-${myGuide.title}-${cadence === "daily" ? "يومي" : "أسبوعي"}.pdf`, html);
      toast.success("تم تحميل الملخص بصيغة PDF");
    } catch (e) {
      console.error(e);
      toast.error("تعذّر إنشاء ملف PDF");
    } finally {
      setDownloading(false);
    }
  };

  const exportProgressPdf = async () => {
    if (!myGuide) return;
    try {
      setDownloading(true);
      const dailyDone = dailyLinks.filter((l) => completed[l.path]);
      const dailyPending = dailyLinks.filter((l) => !completed[l.path]);
      const weeklyDone = weeklyLinks.filter((l) => completed[l.path]);
      const weeklyPending = weeklyLinks.filter((l) => !completed[l.path]);
      const html = `${headerHtml(`تقدّم المهام — ${todayKey()} (${weekKey()})`)}
        <div style="display:flex;gap:12px;margin-bottom:16px">
          <div style="flex:1;padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#faf5ff">
            <div style="font-size:11px;color:#6b7280">إجمالي التقدّم</div>
            <div style="font-size:20px;font-weight:bold;color:#6d28d9">${stats.done} / ${stats.total} (${stats.pct}%)</div>
          </div>
          <div style="flex:1;padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff7ed">
            <div style="font-size:11px;color:#6b7280">يومي</div>
            <div style="font-size:20px;font-weight:bold;color:#ea580c">${stats.dailyDone} / ${stats.dailyTotal}</div>
          </div>
          <div style="flex:1;padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#ecfdf5">
            <div style="font-size:11px;color:#6b7280">أسبوعي</div>
            <div style="font-size:20px;font-weight:bold;color:#059669">${stats.weeklyDone} / ${stats.weeklyTotal}</div>
          </div>
        </div>
        <h3 style="font-size:14px;margin:12px 0 6px;color:#059669">مهام يومية مكتملة (${dailyDone.length})</h3>
        ${linksTableHtml(dailyDone, true)}
        <h3 style="font-size:14px;margin:14px 0 6px;color:#b91c1c">مهام يومية غير مكتملة (${dailyPending.length})</h3>
        ${linksTableHtml(dailyPending, true)}
        <h3 style="font-size:14px;margin:14px 0 6px;color:#059669">مهام أسبوعية مكتملة (${weeklyDone.length})</h3>
        ${linksTableHtml(weeklyDone, true)}
        <h3 style="font-size:14px;margin:14px 0 6px;color:#b91c1c">مهام أسبوعية غير مكتملة (${weeklyPending.length})</h3>
        ${linksTableHtml(weeklyPending, true)}
      `;
      await renderHtmlToPdf(`تقدّم-${myGuide.title}-${todayKey()}.pdf`, html);
      toast.success("تم تحميل تقرير التقدّم");
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
            <div className="flex flex-wrap gap-2 no-print">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMany(myGuide.links.map((l) => l.path), false)}
                className="gap-2"
              >
                <RotateCcw className="w-4 h-4" /> إعادة ضبط اليوم
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
                <Printer className="w-4 h-4" /> طباعة
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" disabled={downloading} className="gap-2">
                    <Download className="w-4 h-4" />
                    {downloading ? "جارٍ التحميل..." : "تصدير PDF"}
                    <ChevronDown className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>ملخصات دورية</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => exportCadencePdf("daily")} className="gap-2">
                    <CheckCircle2 className="w-4 h-4" /> ملخص يومي ({dailyLinks.length})
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportCadencePdf("weekly")} className="gap-2">
                    <CalendarClock className="w-4 h-4" /> ملخص أسبوعي ({weeklyLinks.length})
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>التقدّم</DropdownMenuLabel>
                  <DropdownMenuItem onClick={exportProgressPdf} className="gap-2">
                    <ListChecks className="w-4 h-4" /> تقرير تقدّم المهام
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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

        {myGuide && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 no-print">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <ListChecks className="w-3.5 h-3.5" /> إجمالي التقدّم
                </div>
                <div className="text-2xl font-bold mt-1">{stats.pct}%</div>
                <Progress value={stats.pct} className="h-1.5 mt-2" />
                <div className="text-xs text-muted-foreground mt-1">
                  {stats.done} / {stats.total} مهام
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> مكتمل
                </div>
                <div className="text-2xl font-bold mt-1 text-emerald-600">{stats.done}</div>
                <div className="text-xs text-muted-foreground mt-2">
                  يومي {stats.dailyDone}/{stats.dailyTotal} · أسبوعي {stats.weeklyDone}/{stats.weeklyTotal}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CircleDashed className="w-3.5 h-3.5 text-orange-500" /> غير مكتمل
                </div>
                <div className="text-2xl font-bold mt-1 text-orange-500">{stats.remaining}</div>
                <div className="text-xs text-muted-foreground mt-2">
                  ابدأ من البطاقات أدناه
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5" /> تذكيرات تلقائية
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="rem-daily" className="text-xs cursor-pointer">يومية</Label>
                  <Switch
                    id="rem-daily"
                    checked={prefs.daily}
                    onCheckedChange={(v) => updatePrefs({ daily: v })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="rem-weekly" className="text-xs cursor-pointer">أسبوعية</Label>
                  <Switch
                    id="rem-weekly"
                    checked={prefs.weekly}
                    onCheckedChange={(v) => updatePrefs({ weekly: v })}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
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
                <div className="space-y-2 no-print">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5" /> تقدّم اليوم
                    </span>
                    <span className="font-medium">
                      {stats.dailyDone} / {stats.dailyTotal}
                      {stats.dailyTotal > 0 && ` (${Math.round((stats.dailyDone / stats.dailyTotal) * 100)}%)`}
                    </span>
                  </div>
                  <Progress
                    value={stats.dailyTotal ? Math.round((stats.dailyDone / stats.dailyTotal) * 100) : 0}
                    className="h-2"
                  />
                </div>
                {filteredLinks.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6">
                    لا توجد نتائج مطابقة لبحثك.
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredLinks.map((l) => {
                      const isDone = !!completed[l.path];
                      const isWeekly = l.cadence === "weekly";
                      return (
                        <Card key={l.path} className={`hover:border-primary hover:shadow transition h-full ${isDone ? "bg-muted/40" : ""}`}>
                          <CardContent className="p-4 flex items-start gap-3">
                            <Checkbox
                              checked={isDone}
                              onCheckedChange={() => toggle(l.path)}
                              className="mt-1 no-print"
                              aria-label={`وضع علامة على ${l.label}`}
                            />
                            <Link to={l.path} className="flex items-start gap-3 flex-1 min-w-0">
                              <div className="p-2 rounded-md bg-primary/10 text-primary flex-shrink-0">
                                <l.icon className="w-5 h-5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm flex items-center justify-between gap-2">
                                  <span className={isDone ? "line-through text-muted-foreground" : ""}>{l.label}</span>
                                  <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground" />
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                                  {isWeekly && (
                                    <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px]">
                                      <CalendarClock className="w-3 h-3" /> أسبوعي
                                    </Badge>
                                  )}
                                  {l.desc}
                                </div>
                              </div>
                            </Link>
                          </CardContent>
                        </Card>
                      );
                    })}
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
