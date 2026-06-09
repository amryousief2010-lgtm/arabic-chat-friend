import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CalendarRange, Save, Send, History, Plus, Trash2 } from "lucide-react";

type WeeklyStatus = "draft" | "submitted" | "reviewed";

interface TopPost {
  id?: string;
  platform: string;
  post_title: string;
  post_url: string;
  reach_count: number;
  engagement_count: number;
  notes: string;
}

interface WeeklyForm {
  id?: string;
  week_start_date: string;
  week_end_date: string;
  facebook_followers_growth: number;
  instagram_followers_growth: number;
  tiktok_followers_growth: number;
  youtube_followers_growth: number;
  leads_count: number;
  best_platform: string;
  best_platform_reason: string;
  repeated_problems: string;
  weekly_summary: string;
  next_week_suggestions: string;
  additional_notes: string;
  status: WeeklyStatus;
  management_notes?: string | null;
}

const PLATFORMS = ["Facebook", "Instagram", "TikTok", "YouTube"];

const weekDefaults = () => {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { week_start_date: start.toISOString().slice(0, 10), week_end_date: end.toISOString().slice(0, 10) };
};

const statusBadge = (s: WeeklyStatus) => {
  if (s === "reviewed") return <Badge className="bg-emerald-500 hover:bg-emerald-600">تمت المراجعة</Badge>;
  if (s === "submitted") return <Badge className="bg-blue-500 hover:bg-blue-600">تم الإرسال</Badge>;
  return <Badge variant="outline">مسودة</Badge>;
};

const emptyPost = (): TopPost => ({
  platform: "Facebook",
  post_title: "",
  post_url: "",
  reach_count: 0,
  engagement_count: 0,
  notes: "",
});

export default function SocialMediaWeeklyReport() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const defaults = weekDefaults();
  const [form, setForm] = useState<WeeklyForm>({
    week_start_date: defaults.week_start_date,
    week_end_date: defaults.week_end_date,
    facebook_followers_growth: 0,
    instagram_followers_growth: 0,
    tiktok_followers_growth: 0,
    youtube_followers_growth: 0,
    leads_count: 0,
    best_platform: "Facebook",
    best_platform_reason: "",
    repeated_problems: "",
    weekly_summary: "",
    next_week_suggestions: "",
    additional_notes: "",
    status: "draft",
  });
  const [posts, setPosts] = useState<TopPost[]>([emptyPost()]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("social_media_weekly_reports")
        .select("*, social_media_weekly_top_posts(*)")
        .eq("employee_id", user.id)
        .eq("week_start_date", form.week_start_date)
        .eq("week_end_date", form.week_end_date)
        .maybeSingle();
      if (!error && data) {
        setForm({
          id: data.id,
          week_start_date: data.week_start_date,
          week_end_date: data.week_end_date,
          facebook_followers_growth: data.facebook_followers_growth,
          instagram_followers_growth: data.instagram_followers_growth,
          tiktok_followers_growth: data.tiktok_followers_growth,
          youtube_followers_growth: data.youtube_followers_growth,
          leads_count: data.leads_count,
          best_platform: data.best_platform,
          best_platform_reason: data.best_platform_reason ?? "",
          repeated_problems: data.repeated_problems ?? "",
          weekly_summary: data.weekly_summary ?? "",
          next_week_suggestions: data.next_week_suggestions ?? "",
          additional_notes: data.additional_notes ?? "",
          status: data.status as WeeklyStatus,
          management_notes: data.management_notes,
        });
        const pp = (data as any).social_media_weekly_top_posts || [];
        if (pp.length) {
          setPosts(
            pp.map((p: any) => ({
              id: p.id,
              platform: p.platform,
              post_title: p.post_title,
              post_url: p.post_url ?? "",
              reach_count: p.reach_count,
              engagement_count: p.engagement_count,
              notes: p.notes ?? "",
            }))
          );
        }
      } else {
        // reset to empty if not found
        setForm((f) => ({ ...f, id: undefined, status: "draft", management_notes: null }));
        setPosts([emptyPost()]);
      }
      setLoading(false);
    })();
  }, [user, form.week_start_date, form.week_end_date]);

  const isLocked = form.status === "reviewed";

  const validate = (forSubmit: boolean) => {
    if (!form.week_start_date || !form.week_end_date) return "حدّدي فترة الأسبوع";
    if (form.week_end_date < form.week_start_date) return "تاريخ نهاية الأسبوع يجب أن يكون بعد البداية";
    if (forSubmit) {
      if (!form.best_platform_reason.trim()) return "سبب اختيار أفضل منصة مطلوب";
      if (!form.weekly_summary.trim()) return "ملخص أداء الأسبوع مطلوب";
      if (!form.next_week_suggestions.trim()) return "اقتراحات الأسبوع القادم مطلوبة";
    }
    return null;
  };

  const save = async (status: WeeklyStatus) => {
    if (!user || !profile) return;
    const err = validate(status === "submitted");
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    const payload = {
      week_start_date: form.week_start_date,
      week_end_date: form.week_end_date,
      employee_id: user.id,
      employee_name: profile.full_name || user.email || "",
      facebook_followers_growth: form.facebook_followers_growth,
      instagram_followers_growth: form.instagram_followers_growth,
      tiktok_followers_growth: form.tiktok_followers_growth,
      youtube_followers_growth: form.youtube_followers_growth,
      leads_count: form.leads_count,
      best_platform: form.best_platform,
      best_platform_reason: form.best_platform_reason.trim(),
      repeated_problems: form.repeated_problems || null,
      weekly_summary: form.weekly_summary.trim(),
      next_week_suggestions: form.next_week_suggestions.trim(),
      additional_notes: form.additional_notes || null,
      status,
    };
    const { data, error } = await supabase
      .from("social_media_weekly_reports")
      .upsert(payload, { onConflict: "employee_id,week_start_date,week_end_date" })
      .select()
      .single();
    if (error) {
      setSaving(false);
      toast.error("تعذّر الحفظ", { description: error.message });
      return;
    }
    const reportId = data.id;

    // Replace top posts: delete & re-insert non-empty ones
    await supabase.from("social_media_weekly_top_posts").delete().eq("weekly_report_id", reportId);
    const cleaned = posts
      .filter((p) => p.post_title.trim() || p.platform)
      .slice(0, 5)
      .map((p) => ({
        weekly_report_id: reportId,
        platform: p.platform,
        post_title: p.post_title || "—",
        post_url: p.post_url || null,
        reach_count: Number(p.reach_count) || 0,
        engagement_count: Number(p.engagement_count) || 0,
        notes: p.notes || null,
      }));
    if (cleaned.length) {
      const { error: pErr } = await supabase.from("social_media_weekly_top_posts").insert(cleaned);
      if (pErr) {
        setSaving(false);
        toast.error("تم حفظ التقرير لكن تعذّر حفظ المنشورات", { description: pErr.message });
        return;
      }
    }
    setSaving(false);
    setForm((f) => ({ ...f, id: reportId, status: data.status as WeeklyStatus }));
    toast.success(status === "submitted" ? "تم إرسال التقرير الأسبوعي للإدارة" : "تم حفظ المسودة");
  };

  const updatePost = (idx: number, patch: Partial<TopPost>) =>
    setPosts((arr) => arr.map((p, i) => (i === idx ? { ...p, ...patch } : p)));

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarRange className="w-7 h-7 text-primary" />
              تقرير السوشيال ميديا الأسبوعي
            </h1>
            <p className="text-muted-foreground mt-1">
              ملخص أسبوعي للأداء — {profile?.full_name || "—"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(form.status)}
            <Button variant="outline" asChild>
              <Link to="/social-media/my-reports">
                <History className="w-4 h-4 ml-2" /> تقاريري السابقة
              </Link>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>فترة الأسبوع وبيانات النمو</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">جاري التحميل…</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>تاريخ بداية الأسبوع</Label>
                  <Input
                    type="date"
                    value={form.week_start_date}
                    disabled={isLocked}
                    onChange={(e) => setForm((f) => ({ ...f, week_start_date: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>تاريخ نهاية الأسبوع</Label>
                  <Input
                    type="date"
                    value={form.week_end_date}
                    disabled={isLocked}
                    onChange={(e) => setForm((f) => ({ ...f, week_end_date: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>اسم الموظفة</Label>
                  <Input value={profile?.full_name || ""} disabled />
                </div>
                <div />
                {([
                  ["facebook_followers_growth", "نمو متابعين Facebook *"],
                  ["instagram_followers_growth", "نمو متابعين Instagram *"],
                  ["tiktok_followers_growth", "نمو متابعين TikTok *"],
                  ["youtube_followers_growth", "نمو متابعين YouTube *"],
                  ["leads_count", "عدد العملاء المحتملين (Leads) *"],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <Label>{label}</Label>
                    <Input
                      type="number"
                      value={(form as any)[key]}
                      disabled={isLocked}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [key]: Number(e.target.value) } as any))
                      }
                    />
                  </div>
                ))}
                <div>
                  <Label>أفضل منصة خلال الأسبوع</Label>
                  <Select
                    value={form.best_platform}
                    disabled={isLocked}
                    onValueChange={(v) => setForm((f) => ({ ...f, best_platform: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label>سبب اختيار أفضل منصة *</Label>
                  <Input
                    value={form.best_platform_reason}
                    disabled={isLocked}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, best_platform_reason: e.target.value }))
                    }
                    placeholder="أعلى وصول / أعلى تفاعل / أعلى Leads / أفضل أداء فيديوهات"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>المشاكل المتكررة خلال الأسبوع</Label>
                  <Textarea
                    rows={2}
                    value={form.repeated_problems}
                    disabled={isLocked}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, repeated_problems: e.target.value }))
                    }
                    placeholder="السعر، التوصيل، المناطق، طريقة الطبخ، توفر المنتجات، …"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>ملخص عام عن أداء الأسبوع *</Label>
                  <Textarea
                    rows={3}
                    value={form.weekly_summary}
                    disabled={isLocked}
                    onChange={(e) => setForm((f) => ({ ...f, weekly_summary: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>اقتراحات الأسبوع القادم *</Label>
                  <Textarea
                    rows={3}
                    value={form.next_week_suggestions}
                    disabled={isLocked}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, next_week_suggestions: e.target.value }))
                    }
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>ملاحظات إضافية (اختياري)</Label>
                  <Textarea
                    rows={2}
                    value={form.additional_notes}
                    disabled={isLocked}
                    onChange={(e) => setForm((f) => ({ ...f, additional_notes: e.target.value }))}
                  />
                </div>
                {form.management_notes && (
                  <div className="md:col-span-2 p-3 rounded-md bg-muted/50">
                    <Label className="text-sm">ملاحظة الإدارة</Label>
                    <p className="mt-1 text-sm whitespace-pre-wrap">{form.management_notes}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>أعلى 5 منشورات حسب الوصول والتفاعل</CardTitle>
            <Button
              variant="outline"
              size="sm"
              disabled={isLocked || posts.length >= 5}
              onClick={() => setPosts((arr) => [...arr, emptyPost()])}
            >
              <Plus className="w-4 h-4 ml-1" /> إضافة منشور
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المنصة</TableHead>
                  <TableHead>الاسم / الوصف</TableHead>
                  <TableHead>الرابط</TableHead>
                  <TableHead>الوصول</TableHead>
                  <TableHead>التفاعل</TableHead>
                  <TableHead>ملاحظات</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {posts.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Select
                        value={p.platform}
                        disabled={isLocked}
                        onValueChange={(v) => updatePost(i, { platform: v })}
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PLATFORMS.map((pl) => (
                            <SelectItem key={pl} value={pl}>
                              {pl}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={p.post_title}
                        disabled={isLocked}
                        onChange={(e) => updatePost(i, { post_title: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={p.post_url}
                        disabled={isLocked}
                        onChange={(e) => updatePost(i, { post_url: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        className="w-24"
                        value={p.reach_count}
                        disabled={isLocked}
                        onChange={(e) =>
                          updatePost(i, { reach_count: Number(e.target.value) })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        className="w-24"
                        value={p.engagement_count}
                        disabled={isLocked}
                        onChange={(e) =>
                          updatePost(i, { engagement_count: Number(e.target.value) })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={p.notes}
                        disabled={isLocked}
                        onChange={(e) => updatePost(i, { notes: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={isLocked || posts.length <= 1}
                        onClick={() =>
                          setPosts((arr) => arr.filter((_, idx) => idx !== i))
                        }
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="outline" disabled={saving || isLocked} onClick={() => save("draft")}>
            <Save className="w-4 h-4 ml-2" /> حفظ كمسودة
          </Button>
          <Button disabled={saving || isLocked} onClick={() => save("submitted")}>
            <Send className="w-4 h-4 ml-2" /> حفظ وإرسال للإدارة
          </Button>
        </div>

        {isLocked && (
          <p className="text-sm text-muted-foreground text-center">
            التقرير معتمد من الإدارة — لا يمكن تعديله.
          </p>
        )}
      </div>
    </DashboardLayout>
  );
}
