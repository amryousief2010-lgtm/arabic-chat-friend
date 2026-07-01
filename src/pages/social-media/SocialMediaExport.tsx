import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileDown, Printer, FileSpreadsheet, Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate, COMPANY_AR } from "@/lib/printPdf";
import { toast } from "sonner";

type Daily = any;
type Weekly = any;

const startOfMonthISO = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function SocialMediaExport() {
  const { user, isGeneralManager, isExecutiveManager, roles } = useAuth();
  const isManager =
    isGeneralManager ||
    isExecutiveManager ||
    (roles || []).includes("marketing_sales_manager");

  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [daily, setDaily] = useState<Daily[]>([]);
  const [weekly, setWeekly] = useState<Weekly[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    let dq = supabase
      .from("social_media_daily_reports")
      .select("*")
      .gte("report_date", from)
      .lte("report_date", to)
      .order("report_date", { ascending: true });
    let wq = supabase
      .from("social_media_weekly_reports")
      .select("*")
      .gte("week_start_date", from)
      .lte("week_end_date", to)
      .order("week_start_date", { ascending: true });
    if (!isManager && user) {
      dq = dq.eq("employee_id", user.id);
      wq = wq.eq("employee_id", user.id);
    }
    const [{ data: d }, { data: w }] = await Promise.all([dq, wq]);
    setDaily((d as any) || []);
    setWeekly((w as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, user, isManager]);

  const employees = useMemo(() => {
    const map = new Map<string, string>();
    daily.forEach((r) => map.set(r.employee_id, r.employee_name));
    weekly.forEach((r) => map.set(r.employee_id, r.employee_name));
    return Array.from(map.entries());
  }, [daily, weekly]);

  const filteredDaily = useMemo(() => {
    return daily.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (employeeFilter !== "all" && r.employee_id !== employeeFilter) return false;
      if (platformFilter !== "all") {
        if (!Array.isArray(r.platforms) || !r.platforms.includes(platformFilter)) return false;
      }
      return true;
    });
  }, [daily, statusFilter, employeeFilter, platformFilter]);

  const filteredWeekly = useMemo(() => {
    return weekly.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (employeeFilter !== "all" && r.employee_id !== employeeFilter) return false;
      return true;
    });
  }, [weekly, statusFilter, employeeFilter]);

  const kpis = useMemo(() => {
    const sum = (k: string) =>
      filteredDaily.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);
    return {
      posts: sum("posts_count"),
      reels: sum("reels_videos_count"),
      leads: sum("interested_customers_count"),
      reach: sum("reach_count"),
      likes: sum("likes_count"),
      comments: sum("comments_count"),
      shares: sum("shares_count"),
      followers: sum("new_followers_count"),
      complaints: filteredDaily.filter((r) => (r.issues_or_complaints || "").trim()).length,
      submittedDays: new Set(
        filteredDaily
          .filter((r) => r.status === "submitted" || r.status === "reviewed")
          .map((r) => r.report_date),
      ).size,
    };
  }, [filteredDaily]);

  const periodLabel = `${from} → ${to}`;

  const exportExcel = () => {
    if (filteredDaily.length === 0 && filteredWeekly.length === 0) {
      toast.error("لا توجد بيانات في النطاق المحدد");
      return;
    }
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["تقرير السوشيال ميديا", periodLabel],
        [],
        ["إجمالي البوستات", kpis.posts],
        ["إجمالي الريلز / الفيديو", kpis.reels],
        ["إجمالي العملاء المهتمين", kpis.leads],
        ["أيام مُرسلة", kpis.submittedDays],
        ["الوصول", kpis.reach],
        ["إعجابات", kpis.likes],
        ["تعليقات", kpis.comments],
        ["مشاركات", kpis.shares],
        ["متابعون جدد", kpis.followers],
        ["الشكاوى", kpis.complaints],
      ]),
      "الملخص",
    );

    if (filteredDaily.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          filteredDaily.map((r) => ({
            التاريخ: r.report_date,
            الموظفة: r.employee_name,
            الحالة: r.status,
            بوستات: r.posts_count,
            "ريلز/فيديو": r.reels_videos_count,
            "عملاء مهتمين": r.interested_customers_count,
            الوصول: r.reach_count ?? "",
            الظهور: r.impressions_count ?? "",
            إعجابات: r.likes_count ?? "",
            تعليقات: r.comments_count ?? "",
            مشاركات: r.shares_count ?? "",
            "متابعون جدد": r.new_followers_count ?? "",
            المنصات: (r.platforms || []).join(", "),
            "أعلى محتوى": r.top_engaging_content,
            شكاوى: r.issues_or_complaints || "",
            "اقتراحات الغد": r.tomorrow_content_suggestions,
            ملاحظات: r.additional_notes || "",
            "ملاحظات الإدارة": r.management_notes || "",
          })),
        ),
        "التقارير اليومية",
      );
    }

    if (filteredWeekly.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          filteredWeekly.map((r) => ({
            "بداية الأسبوع": r.week_start_date,
            "نهاية الأسبوع": r.week_end_date,
            الموظفة: r.employee_name,
            الحالة: r.status,
            "نمو فيسبوك": r.facebook_followers_growth,
            "نمو انستجرام": r.instagram_followers_growth,
            "نمو تيك توك": r.tiktok_followers_growth,
            "نمو يوتيوب": r.youtube_followers_growth,
            "عملاء محتملين": r.leads_count,
            "أفضل منصة": r.best_platform,
            السبب: r.best_platform_reason,
            "مشاكل متكررة": r.repeated_problems || "",
            الملخص: r.weekly_summary,
            "اقتراحات الأسبوع القادم": r.next_week_suggestions,
          })),
        ),
        "التقارير الأسبوعية",
      );
    }

    const complaints = filteredDaily.filter((r) => (r.issues_or_complaints || "").trim());
    if (complaints.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          complaints.map((r) => ({
            التاريخ: r.report_date,
            الموظفة: r.employee_name,
            الشكوى: r.issues_or_complaints,
            "به مرفق": r.complaint_attachment_path ? "نعم" : "لا",
          })),
        ),
        "الشكاوى",
      );
    }

    const top = filteredDaily.filter((r) => (r.top_engaging_content || "").trim());
    if (top.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          top.map((r) => ({
            التاريخ: r.report_date,
            الموظفة: r.employee_name,
            المحتوى: r.top_engaging_content,
            "عملاء مهتمين": r.interested_customers_count,
          })),
        ),
        "أعلى محتوى",
      );
    }

    XLSX.writeFile(wb, `تقرير-السوشيال-ميديا-${from}_الى_${to}.xlsx`);
  };

  const exportPDF = () => {
    if (filteredDaily.length === 0 && filteredWeekly.length === 0) {
      toast.error("لا توجد بيانات في النطاق المحدد");
      return;
    }
    const table = (title: string, headers: string[], rows: (string | number)[][]) =>
      rows.length
        ? `<h2>${escapeHtml(title)}</h2>
           <table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
           <tbody>${rows
             .map(
               (r) =>
                 `<tr>${r.map((c) => `<td class="num">${escapeHtml(c)}</td>`).join("")}</tr>`,
             )
             .join("")}</tbody></table>`
        : "";

    const body = `
      <header>
        <div>
          <h1>${COMPANY_AR}</h1>
          <div class="en">تقرير أداء السوشيال ميديا — ${escapeHtml(periodLabel)}</div>
        </div>
        <div class="meta"><div>تاريخ الإصدار: ${fmtDate(new Date())}</div></div>
      </header>

      <div class="stats">
        <div class="stat"><div class="k">بوستات</div><div class="v">${fmtNum(kpis.posts)}</div></div>
        <div class="stat"><div class="k">ريلز / فيديو</div><div class="v">${fmtNum(kpis.reels)}</div></div>
        <div class="stat"><div class="k">عملاء مهتمين</div><div class="v">${fmtNum(kpis.leads)}</div></div>
        <div class="stat"><div class="k">أيام مُرسلة</div><div class="v">${fmtNum(kpis.submittedDays)}</div></div>
      </div>
      <div class="stats">
        <div class="stat"><div class="k">الوصول</div><div class="v">${fmtNum(kpis.reach)}</div></div>
        <div class="stat"><div class="k">إعجابات</div><div class="v">${fmtNum(kpis.likes)}</div></div>
        <div class="stat"><div class="k">تعليقات + مشاركات</div><div class="v">${fmtNum(kpis.comments + kpis.shares)}</div></div>
        <div class="stat"><div class="k">متابعون جدد</div><div class="v">${fmtNum(kpis.followers)}</div></div>
      </div>

      ${table(
        "التقارير اليومية",
        ["التاريخ", "الموظفة", "بوستات", "ريلز", "عملاء", "أعلى محتوى", "الحالة"],
        filteredDaily.map((r) => [
          r.report_date,
          r.employee_name,
          r.posts_count,
          r.reels_videos_count,
          r.interested_customers_count,
          r.top_engaging_content || "—",
          r.status,
        ]),
      )}

      ${table(
        "التقارير الأسبوعية",
        ["الأسبوع", "الموظفة", "عملاء محتملين", "أفضل منصة", "الملخص"],
        filteredWeekly.map((r) => [
          `${r.week_start_date} → ${r.week_end_date}`,
          r.employee_name,
          r.leads_count,
          r.best_platform,
          (r.weekly_summary || "").slice(0, 120),
        ]),
      )}

      ${table(
        "الشكاوى",
        ["التاريخ", "الموظفة", "الشكوى"],
        filteredDaily
          .filter((r) => (r.issues_or_complaints || "").trim())
          .map((r) => [r.report_date, r.employee_name, r.issues_or_complaints]),
      )}

      ${table(
        "أعلى محتوى تفاعلًا",
        ["التاريخ", "الموظفة", "المحتوى", "عملاء"],
        filteredDaily
          .filter((r) => (r.top_engaging_content || "").trim())
          .map((r) => [
            r.report_date,
            r.employee_name,
            r.top_engaging_content,
            r.interested_customers_count,
          ]),
      )}
    `;
    openPrintWindow(`تقرير السوشيال ميديا — ${periodLabel}`, body);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Megaphone className="w-7 h-7 text-primary" />
              تصدير تقارير السوشيال ميديا
            </h1>
            <p className="text-muted-foreground mt-1">
              فلاتر الفترة والموظفة والمنصة، ثم تصدير احترافي (PDF عربي + Excel).
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportPDF} disabled={loading}>
              <Printer className="w-4 h-4 ml-2" /> طباعة / PDF
            </Button>
            <Button onClick={exportExcel} disabled={loading}>
              <FileSpreadsheet className="w-4 h-4 ml-2" /> Excel
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileDown className="w-5 h-5 text-primary" /> الفلاتر
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <Label>من</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>إلى</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div>
              <Label>الحالة</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="draft">مسودة</SelectItem>
                  <SelectItem value="submitted">مرسل</SelectItem>
                  <SelectItem value="reviewed">مراجَع</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isManager && (
              <div>
                <Label>الموظفة</Label>
                <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {employees.map(([id, name]) => (
                      <SelectItem key={id} value={id}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>المنصة</Label>
              <Select value={platformFilter} onValueChange={setPlatformFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المنصات</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                  <SelectItem value="youtube">YouTube</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ملخّص سريع</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="p-3 rounded-md bg-muted/40">تقارير يومية: <b>{filteredDaily.length}</b></div>
            <div className="p-3 rounded-md bg-muted/40">تقارير أسبوعية: <b>{filteredWeekly.length}</b></div>
            <div className="p-3 rounded-md bg-muted/40">إجمالي البوستات: <b>{kpis.posts}</b></div>
            <div className="p-3 rounded-md bg-muted/40">إجمالي العملاء المهتمين: <b>{kpis.leads}</b></div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
