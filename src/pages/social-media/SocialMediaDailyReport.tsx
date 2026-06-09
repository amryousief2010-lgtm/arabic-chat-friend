import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ClipboardList, Save, Send, History } from "lucide-react";

type DailyStatus = "draft" | "submitted" | "reviewed";

interface DailyForm {
  id?: string;
  report_date: string;
  posts_count: number;
  reels_videos_count: number;
  interested_customers_count: number;
  top_engaging_content: string;
  issues_or_complaints: string;
  tomorrow_content_suggestions: string;
  additional_notes: string;
  status: DailyStatus;
  management_notes?: string | null;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

const statusBadge = (s: DailyStatus) => {
  if (s === "reviewed") return <Badge className="bg-emerald-500 hover:bg-emerald-600">تمت المراجعة</Badge>;
  if (s === "submitted") return <Badge className="bg-blue-500 hover:bg-blue-600">تم الإرسال</Badge>;
  return <Badge variant="outline">مسودة</Badge>;
};

export default function SocialMediaDailyReport() {
  const { user, profile, isGeneralManager, isExecutiveManager } = useAuth();
  const canEditDate = isGeneralManager || isExecutiveManager;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<DailyForm>({
    report_date: todayISO(),
    posts_count: 0,
    reels_videos_count: 0,
    interested_customers_count: 0,
    top_engaging_content: "",
    issues_or_complaints: "",
    tomorrow_content_suggestions: "",
    additional_notes: "",
    status: "draft",
  });

  // Load today's existing report (if any)
  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("social_media_daily_reports")
        .select("*")
        .eq("employee_id", user.id)
        .eq("report_date", form.report_date)
        .maybeSingle();
      if (!error && data) {
        setForm({
          id: data.id,
          report_date: data.report_date,
          posts_count: data.posts_count,
          reels_videos_count: data.reels_videos_count,
          interested_customers_count: data.interested_customers_count,
          top_engaging_content: data.top_engaging_content ?? "",
          issues_or_complaints: data.issues_or_complaints ?? "",
          tomorrow_content_suggestions: data.tomorrow_content_suggestions ?? "",
          additional_notes: data.additional_notes ?? "",
          status: data.status as DailyStatus,
          management_notes: data.management_notes,
        });
      }
      setLoading(false);
    })();
  }, [user, form.report_date]);

  const isLocked = form.status === "reviewed";

  const validate = (forSubmit: boolean) => {
    if (forSubmit) {
      if (!form.top_engaging_content.trim()) return "أعلى محتوى في التفاعل مطلوب";
      if (!form.tomorrow_content_suggestions.trim()) return "اقتراحات محتوى لبكرة مطلوبة";
      if (form.posts_count < 0 || form.reels_videos_count < 0 || form.interested_customers_count < 0)
        return "الأرقام يجب ألا تكون سالبة";
    }
    return null;
  };

  const save = async (status: DailyStatus) => {
    if (!user || !profile) return;
    const err = validate(status === "submitted");
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    const payload = {
      report_date: form.report_date,
      employee_id: user.id,
      employee_name: profile.full_name || user.email || "",
      posts_count: form.posts_count,
      reels_videos_count: form.reels_videos_count,
      interested_customers_count: form.interested_customers_count,
      top_engaging_content: form.top_engaging_content.trim(),
      issues_or_complaints: form.issues_or_complaints || null,
      tomorrow_content_suggestions: form.tomorrow_content_suggestions.trim(),
      additional_notes: form.additional_notes || null,
      status,
    };
    const { data, error } = await supabase
      .from("social_media_daily_reports")
      .upsert(payload, { onConflict: "employee_id,report_date" })
      .select()
      .single();
    setSaving(false);
    if (error) {
      toast.error("تعذّر الحفظ", { description: error.message });
      return;
    }
    setForm((f) => ({ ...f, id: data.id, status: data.status as DailyStatus }));
    toast.success(status === "submitted" ? "تم إرسال التقرير للإدارة" : "تم حفظ المسودة");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="w-7 h-7 text-primary" />
              تقرير السوشيال ميديا اليومي
            </h1>
            <p className="text-muted-foreground mt-1">
              متابعة أداء النشر اليومي ومحتوى التفاعل — {profile?.full_name || "—"}
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
            <CardTitle>تفاصيل اليوم</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">جاري التحميل…</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>التاريخ</Label>
                  <Input
                    type="date"
                    value={form.report_date}
                    disabled={!canEditDate}
                    onChange={(e) => setForm((f) => ({ ...f, report_date: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>اسم الموظفة</Label>
                  <Input value={profile?.full_name || ""} disabled />
                </div>
                <div>
                  <Label>عدد البوستات المنشورة *</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.posts_count}
                    disabled={isLocked}
                    onChange={(e) => setForm((f) => ({ ...f, posts_count: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <Label>عدد الريلز / الفيديوهات *</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.reels_videos_count}
                    disabled={isLocked}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, reels_videos_count: Number(e.target.value) }))
                    }
                  />
                </div>
                <div>
                  <Label>عدد العملاء المهتمين *</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.interested_customers_count}
                    disabled={isLocked}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        interested_customers_count: Number(e.target.value),
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    العملاء المحتملون الذين ظهر عليهم اهتمام (لست مسؤولة عن الرد عليهم).
                  </p>
                </div>
                <div>
                  <Label>أعلى محتوى في التفاعل *</Label>
                  <Input
                    value={form.top_engaging_content}
                    disabled={isLocked}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, top_engaging_content: e.target.value }))
                    }
                    placeholder="اسم البوست أو رابط المحتوى أو وصفه"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>مشاكل أو شكاوى (اختياري)</Label>
                  <Textarea
                    rows={3}
                    value={form.issues_or_complaints}
                    disabled={isLocked}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, issues_or_complaints: e.target.value }))
                    }
                    placeholder="ملاحظات من الجمهور (السعر، التوصيل، المنتج، …)"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>اقتراحات محتوى لبكرة *</Label>
                  <Textarea
                    rows={3}
                    value={form.tomorrow_content_suggestions}
                    disabled={isLocked}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, tomorrow_content_suggestions: e.target.value }))
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

            <div className="flex flex-wrap gap-2 mt-6 justify-end">
              <Button
                variant="outline"
                disabled={saving || isLocked}
                onClick={() => save("draft")}
              >
                <Save className="w-4 h-4 ml-2" /> حفظ كمسودة
              </Button>
              <Button disabled={saving || isLocked} onClick={() => save("submitted")}>
                <Send className="w-4 h-4 ml-2" /> حفظ وإرسال للإدارة
              </Button>
            </div>

            {isLocked && (
              <p className="mt-4 text-sm text-muted-foreground text-center">
                التقرير معتمد من الإدارة — لا يمكن تعديله.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
