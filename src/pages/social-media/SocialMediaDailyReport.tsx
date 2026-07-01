import { useEffect, useRef, useState } from "react";
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
import { ClipboardList, Save, Send, History, Paperclip, X, ImageIcon, ChevronDown, Eye, Sparkles, Heart, MessageCircle, Share2, UserPlus, Instagram, Facebook, Youtube, Video as VideoIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";

type DailyStatus = "draft" | "submitted" | "reviewed";
const PLATFORMS: { key: string; label: string; icon: any }[] = [
  { key: "instagram", label: "Instagram", icon: Instagram },
  { key: "facebook", label: "Facebook", icon: Facebook },
  { key: "tiktok", label: "TikTok", icon: VideoIcon },
  { key: "youtube", label: "YouTube", icon: Youtube },
];

interface DailyForm {
  id?: string;
  report_date: string;
  posts_count: string;
  reels_videos_count: string;
  interested_customers_count: string;
  top_engaging_content: string;
  issues_or_complaints: string;
  tomorrow_content_suggestions: string;
  additional_notes: string;
  complaint_attachment_path: string | null;
  status: DailyStatus;
  management_notes?: string | null;
  reach_count: string;
  impressions_count: string;
  likes_count: string;
  comments_count: string;
  shares_count: string;
  new_followers_count: string;
  platforms: string[];
}

const todayISO = () => new Date().toISOString().slice(0, 10);

const statusBadge = (s: DailyStatus) => {
  if (s === "reviewed") return <Badge className="bg-emerald-500 hover:bg-emerald-600">تمت المراجعة</Badge>;
  if (s === "submitted") return <Badge className="bg-blue-500 hover:bg-blue-600">تم الإرسال</Badge>;
  return <Badge variant="outline">مسودة</Badge>;
};

const toNum = (s: string) => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export default function SocialMediaDailyReport() {
  const { user, profile, isGeneralManager, isExecutiveManager } = useAuth();
  const canEditDate = isGeneralManager || isExecutiveManager;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [form, setForm] = useState<DailyForm>({
    report_date: todayISO(),
    posts_count: "",
    reels_videos_count: "",
    interested_customers_count: "",
    top_engaging_content: "",
    issues_or_complaints: "",
    tomorrow_content_suggestions: "",
    additional_notes: "",
    complaint_attachment_path: null,
    status: "draft",
    reach_count: "",
    impressions_count: "",
    likes_count: "",
    comments_count: "",
    shares_count: "",
    new_followers_count: "",
    platforms: [],
  });

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
        const d = data as any;
        setForm({
          id: d.id,
          report_date: d.report_date,
          posts_count: String(d.posts_count ?? ""),
          reels_videos_count: String(d.reels_videos_count ?? ""),
          interested_customers_count: String(d.interested_customers_count ?? ""),
          top_engaging_content: d.top_engaging_content ?? "",
          issues_or_complaints: d.issues_or_complaints ?? "",
          tomorrow_content_suggestions: d.tomorrow_content_suggestions ?? "",
          additional_notes: d.additional_notes ?? "",
          complaint_attachment_path: d.complaint_attachment_path ?? null,
          status: d.status as DailyStatus,
          management_notes: d.management_notes,
          reach_count: d.reach_count != null ? String(d.reach_count) : "",
          impressions_count: d.impressions_count != null ? String(d.impressions_count) : "",
          likes_count: d.likes_count != null ? String(d.likes_count) : "",
          comments_count: d.comments_count != null ? String(d.comments_count) : "",
          shares_count: d.shares_count != null ? String(d.shares_count) : "",
          new_followers_count: d.new_followers_count != null ? String(d.new_followers_count) : "",
          platforms: Array.isArray(d.platforms) ? d.platforms : [],
        });
      } else {
        setForm((f) => ({
          ...f,
          id: undefined,
          posts_count: "",
          reels_videos_count: "",
          interested_customers_count: "",
          top_engaging_content: "",
          issues_or_complaints: "",
          tomorrow_content_suggestions: "",
          additional_notes: "",
          complaint_attachment_path: null,
          status: "draft",
          management_notes: null,
          reach_count: "",
          impressions_count: "",
          likes_count: "",
          comments_count: "",
          shares_count: "",
          new_followers_count: "",
          platforms: [],
        }));
      }
      setLoading(false);
    })();
  }, [user, form.report_date]);

  // Get signed URL for attachment preview
  useEffect(() => {
    if (!form.complaint_attachment_path) {
      setAttachmentUrl(null);
      return;
    }
    (async () => {
      const { data } = await supabase.storage
        .from("social-media-attachments")
        .createSignedUrl(form.complaint_attachment_path!, 3600);
      setAttachmentUrl(data?.signedUrl ?? null);
    })();
  }, [form.complaint_attachment_path]);

  const isLocked = form.status === "reviewed";

  const validate = (forSubmit: boolean) => {
    if (forSubmit) {
      if (!form.top_engaging_content.trim()) return "أعلى محتوى في التفاعل مطلوب";
      if (!form.tomorrow_content_suggestions.trim()) return "اقتراحات محتوى غدا مطلوبة";
    }
    return null;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("يجب اختيار صورة فقط");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("حجم الصورة يجب ألا يتجاوز 8 ميجا");
      return;
    }
    setUploadingFile(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${user.id}/${form.report_date}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("social-media-attachments")
      .upload(path, file, { cacheControl: "3600", upsert: false });
    setUploadingFile(false);
    if (error) {
      toast.error("تعذّر رفع الصورة", { description: error.message });
      return;
    }
    // Remove old attachment if exists
    if (form.complaint_attachment_path) {
      await supabase.storage
        .from("social-media-attachments")
        .remove([form.complaint_attachment_path]);
    }
    setForm((f) => ({ ...f, complaint_attachment_path: path }));
    toast.success("تم رفع الصورة");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveAttachment = async () => {
    if (!form.complaint_attachment_path) return;
    await supabase.storage
      .from("social-media-attachments")
      .remove([form.complaint_attachment_path]);
    setForm((f) => ({ ...f, complaint_attachment_path: null }));
    toast.success("تم حذف الصورة");
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
      posts_count: toNum(form.posts_count),
      reels_videos_count: toNum(form.reels_videos_count),
      interested_customers_count: toNum(form.interested_customers_count),
      top_engaging_content: form.top_engaging_content.trim(),
      issues_or_complaints: form.issues_or_complaints || null,
      tomorrow_content_suggestions: form.tomorrow_content_suggestions.trim(),
      additional_notes: form.additional_notes || null,
      complaint_attachment_path: form.complaint_attachment_path,
      status,
      reach_count: form.reach_count ? toNum(form.reach_count) : null,
      impressions_count: form.impressions_count ? toNum(form.impressions_count) : null,
      likes_count: form.likes_count ? toNum(form.likes_count) : null,
      comments_count: form.comments_count ? toNum(form.comments_count) : null,
      shares_count: form.shares_count ? toNum(form.shares_count) : null,
      new_followers_count: form.new_followers_count ? toNum(form.new_followers_count) : null,
      platforms: form.platforms.length ? form.platforms : null,
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
                    inputMode="numeric"
                    min={0}
                    placeholder="مثال: 5"
                    value={form.posts_count}
                    disabled={isLocked}
                    onChange={(e) => setForm((f) => ({ ...f, posts_count: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>عدد الريلز / الفيديوهات *</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="مثال: 2"
                    value={form.reels_videos_count}
                    disabled={isLocked}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, reels_videos_count: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label>عدد العملاء المهتمين *</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="مثال: 12"
                    value={form.interested_customers_count}
                    disabled={isLocked}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        interested_customers_count: e.target.value,
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

                  {/* Optional complaint image attachment */}
                  <div className="mt-3 space-y-2">
                    <Label className="flex items-center gap-2 text-sm">
                      <Paperclip className="w-4 h-4" />
                      إرفاق صورة الشكوى (اختياري)
                    </Label>
                    {form.complaint_attachment_path ? (
                      <div className="flex items-center gap-3 p-3 rounded-md border bg-muted/30">
                        <ImageIcon className="w-5 h-5 text-primary" />
                        <a
                          href={attachmentUrl ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-primary underline flex-1 truncate"
                        >
                          عرض الصورة المرفقة
                        </a>
                        {!isLocked && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={handleRemoveAttachment}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleFileUpload}
                          disabled={isLocked || uploadingFile}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isLocked || uploadingFile}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Paperclip className="w-4 h-4 ml-2" />
                          {uploadingFile ? "جاري الرفع…" : "إرفاق صورة"}
                        </Button>
                        <p className="text-xs text-muted-foreground mt-1">
                          مثلًا: لقطة شاشة لشكوى عميل (الحد الأقصى 8 ميجا).
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <Label>اقتراحات محتوى غدا *</Label>
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

                {/* Optional platform stats */}
                <div className="md:col-span-2">
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" size="sm" type="button" className="w-full justify-between">
                        <span className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-primary" />
                          إحصائيات المنصات (اختياري)
                        </span>
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-3 space-y-3">
                      <div>
                        <Label className="text-sm">المنصات النشطة</Label>
                        <div className="flex flex-wrap gap-3 mt-2">
                          {PLATFORMS.map((p) => {
                            const checked = form.platforms.includes(p.key);
                            const Icon = p.icon;
                            return (
                              <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer border rounded-md px-3 py-1.5">
                                <Checkbox
                                  checked={checked}
                                  disabled={isLocked}
                                  onCheckedChange={(v) =>
                                    setForm((f) => ({
                                      ...f,
                                      platforms: v
                                        ? [...f.platforms, p.key]
                                        : f.platforms.filter((x) => x !== p.key),
                                    }))
                                  }
                                />
                                <Icon className="w-4 h-4" /> {p.label}
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {([
                          { k: "reach_count", label: "الوصول (Reach)", icon: Eye },
                          { k: "impressions_count", label: "الظهور (Impressions)", icon: Sparkles },
                          { k: "likes_count", label: "الإعجابات", icon: Heart },
                          { k: "comments_count", label: "التعليقات", icon: MessageCircle },
                          { k: "shares_count", label: "المشاركات", icon: Share2 },
                          { k: "new_followers_count", label: "متابعون جدد", icon: UserPlus },
                        ] as const).map(({ k, label, icon: Icon }) => (
                          <div key={k}>
                            <Label className="text-xs flex items-center gap-1">
                              <Icon className="w-3.5 h-3.5" /> {label}
                            </Label>
                            <Input
                              type="number"
                              min={0}
                              value={(form as any)[k]}
                              disabled={isLocked}
                              onChange={(e) =>
                                setForm((f) => ({ ...f, [k]: e.target.value } as any))
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
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
