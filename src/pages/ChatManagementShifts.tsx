import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight, ChevronLeft, Wand2, Save, Trash2, Plus, Info } from "lucide-react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  canEditChatManagement, CHAT_MANAGEMENT_SETTINGS_PATH, CHAT_MANAGEMENT_SHIFTS_PATH,
} from "@/config/chatManagement";
import {
  AR_WEEKDAYS, addDays, dowOf, generateWeek, rosterWarnings, weekDates, weekStartSaturday,
  type DayPattern, type RosterModerator, type ShiftTemplate,
} from "@/lib/chatManagement/roster";
import {
  DISTRIBUTION_LABELS, FALLBACK_LABELS, type DistributionMethod, type FallbackMethod,
} from "@/lib/chatManagement/distribution";

type Tab = "shifts" | "settings";
const NONE = "__none__";
const db = supabase as any; // جداول cm_* مضافة يدوياً إلى types.ts؛ نستخدم any لتبسيط الاستعلامات المتعددة.

interface TemplateRow extends ShiftTemplate { id: string }
interface AssignmentRow { id?: string; work_date: string; slot_no: number; label: string; starts_at: string; ends_at: string; moderator_id: string | null; source: string }
interface PeerRow { id: string; reviewer_moderator_id: string; reviewee_moderator_id: string; valid_from: string; source_policy: string | null }
interface DistRow { id: number; method: DistributionMethod; fallback_method: FallbackMethod; rotation_offset: number }
interface KpiRow { id: number; service_window_start: string; service_window_end: string; abandoned_minutes: number; first_reply_target_on_shift_min: number; first_reply_target_off_shift_min: number }

const PATTERN_LABEL: Record<DayPattern, string> = { four_shift: "٤ شيفتات", three_shift: "٣ شيفتات" };
const hhmm = (t: string) => t?.slice(0, 5) ?? "";

export default function ChatManagementShifts({ tab = "shifts" }: { tab?: Tab }) {
  const navigate = useNavigate();
  const { roles } = useAuth() as { roles?: string[] };
  const canEdit = canEditChatManagement(roles);

  const [weekStart, setWeekStart] = useState(() => weekStartSaturday(new Date().toISOString().slice(0, 10)));
  const [moderators, setModerators] = useState<RosterModerator[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [patterns, setPatterns] = useState<Record<number, DayPattern>>({});
  const [daysOff, setDaysOff] = useState<Record<string, number | null>>({});
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [dist, setDist] = useState<DistRow | null>(null);
  const [kpi, setKpi] = useState<KpiRow | null>(null);
  const [peers, setPeers] = useState<PeerRow[]>([]);
  const [newReviewer, setNewReviewer] = useState<string>(NONE);
  const [newReviewee, setNewReviewee] = useState<string>(NONE);
  const [loading, setLoading] = useState(true);
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, t, p, o, a, d, k, pr] = await Promise.all([
      db.from("cm_moderators").select("id,display_name,sort_order,is_active,chat_active,start_date,end_date").order("sort_order"),
      db.from("cm_shift_templates").select("*").order("day_pattern").order("slot_no"),
      db.from("cm_weekday_patterns").select("dow,day_pattern"),
      db.from("cm_weekly_days_off").select("moderator_id,dow").is("valid_to", null),
      db.from("cm_shift_assignments").select("*").gte("work_date", dates[0]).lte("work_date", dates[6]),
      db.from("cm_distribution_settings").select("*").maybeSingle(),
      db.from("cm_kpi_settings").select("*").maybeSingle(),
      db.from("cm_peer_review").select("id,reviewer_moderator_id,reviewee_moderator_id,valid_from,source_policy").is("valid_to", null).order("created_at"),
    ]);
    const err = [m, t, p, o, a, d, k, pr].find((r) => r.error)?.error;
    if (err) toast.error(`تعذّر تحميل البيانات: ${err.message}`);
    setModerators(m.data ?? []);
    setTemplates(t.data ?? []);
    setPatterns(Object.fromEntries((p.data ?? []).map((r: any) => [r.dow, r.day_pattern])));
    setDaysOff(Object.fromEntries((o.data ?? []).map((r: any) => [r.moderator_id, r.dow])));
    setAssignments(a.data ?? []);
    setDist(d.data ?? null);
    setKpi(k.data ?? null);
    setPeers(pr.data ?? []);
    setLoading(false);
  }, [dates]);

  useEffect(() => { load(); }, [load]);

  const chatMods = moderators.filter((m) => m.is_active && m.chat_active);
  const modName = (id: string | null) => moderators.find((m) => m.id === id)?.display_name ?? "—";
  const maxSlots = Math.max(0, ...templates.map((t) => t.slot_no));
  const cell = (date: string, slot: number) => assignments.find((a) => a.work_date === date && a.slot_no === slot);
  const templateFor = (date: string, slot: number) =>
    templates.find((t) => t.day_pattern === (patterns[dowOf(date)] ?? "three_shift") && t.slot_no === slot && t.is_active !== false);

  const ensureDays = async (rows: { work_date: string; day_pattern: DayPattern }[], generated = false) => {
    const { error } = await db.from("cm_roster_days").upsert(
      rows.map((r) => ({ ...r, ...(generated ? { generated_at: new Date().toISOString() } : {}) })),
      { onConflict: "work_date" },
    );
    if (error) throw error;
  };

  const setCell = async (date: string, slot: number, moderatorId: string | null) => {
    const t = templateFor(date, slot);
    if (!t) return;
    try {
      await ensureDays([{ work_date: date, day_pattern: t.day_pattern }]);
      const { error } = await db.from("cm_shift_assignments").upsert({
        work_date: date, slot_no: slot, label: t.label, starts_at: t.starts_at, ends_at: t.ends_at,
        moderator_id: moderatorId, source: "manual",
      }, { onConflict: "work_date,slot_no" });
      if (error) throw error;
      toast.success("تم حفظ الشيفت");
      load();
    } catch (e: any) { toast.error(`تعذّر الحفظ: ${e.message}`); }
  };

  const generate = async () => {
    const days = generateWeek({
      weekStart, templates, moderators, daysOff, patterns, rotationOffset: dist?.rotation_offset ?? 0,
    });
    const manual = new Set(assignments.filter((a) => a.source !== "generated").map((a) => `${a.work_date}|${a.slot_no}`));
    try {
      await ensureDays(days.map((d) => ({ work_date: d.work_date, day_pattern: d.day_pattern })), true);
      const rows = days.flatMap((d) => d.slots
        .filter((s) => !manual.has(`${d.work_date}|${s.slot_no}`))
        .map((s) => ({ work_date: d.work_date, slot_no: s.slot_no, label: s.label, starts_at: s.starts_at, ends_at: s.ends_at, moderator_id: s.moderator_id, source: "generated" })));
      if (rows.length) {
        const { error } = await db.from("cm_shift_assignments").upsert(rows, { onConflict: "work_date,slot_no" });
        if (error) throw error;
      }
      const warns = rosterWarnings(days);
      toast.success(`تم توليد الأسبوع${manual.size ? ` (مع الإبقاء على ${manual.size} خانة معدّلة يدوياً)` : ""}`);
      warns.forEach((w) => toast.warning(w));
      load();
    } catch (e: any) { toast.error(`تعذّر التوليد: ${e.message}`); }
  };

  const saveDayOff = async (moderatorId: string, dow: number | null) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { error: e1 } = await db.from("cm_weekly_days_off").update({ valid_to: today }).eq("moderator_id", moderatorId).is("valid_to", null);
      if (e1) throw e1;
      if (dow !== null) {
        const { error: e2 } = await db.from("cm_weekly_days_off").insert({ moderator_id: moderatorId, dow, valid_from: today });
        if (e2) throw e2;
      }
      toast.success("تم حفظ يوم الأجازة");
      load();
    } catch (e: any) { toast.error(`تعذّر الحفظ: ${e.message}`); }
  };

  const saveTemplate = async (t: TemplateRow) => {
    const { error } = await db.from("cm_shift_templates").update({ label: t.label, starts_at: t.starts_at, ends_at: t.ends_at, is_active: t.is_active }).eq("id", t.id);
    error ? toast.error(`تعذّر الحفظ: ${error.message}`) : toast.success("تم حفظ الشيفت");
  };
  const savePattern = async (dow: number, day_pattern: DayPattern) => {
    const { error } = await db.from("cm_weekday_patterns").upsert({ dow, day_pattern }, { onConflict: "dow" });
    if (error) return toast.error(`تعذّر الحفظ: ${error.message}`);
    setPatterns((p) => ({ ...p, [dow]: day_pattern }));
    toast.success("تم الحفظ");
  };
  const saveDist = async () => {
    if (!dist) return;
    const { error } = await db.from("cm_distribution_settings").update({ method: dist.method, fallback_method: dist.fallback_method, rotation_offset: dist.rotation_offset }).eq("id", dist.id);
    error ? toast.error(`تعذّر الحفظ: ${error.message}`) : toast.success("تم حفظ إعدادات التوزيع");
  };
  const addPeer = async () => {
    if (newReviewer === NONE || newReviewee === NONE) return toast.error("اختر المراجِعة والمراجَعة");
    if (newReviewer === newReviewee) return toast.error("لا يمكن أن تراجع المودريتور نفسها");
    if (peers.some((p) => p.reviewer_moderator_id === newReviewer && p.reviewee_moderator_id === newReviewee)) return toast.error("هذه المراجعة موجودة بالفعل");
    const { error } = await db.from("cm_peer_review").insert({ reviewer_moderator_id: newReviewer, reviewee_moderator_id: newReviewee });
    if (error) return toast.error(`تعذّر الحفظ: ${error.message}`);
    toast.success("تمت إضافة المراجعة");
    setNewReviewer(NONE); setNewReviewee(NONE);
    load();
  };
  const endPeer = async (id: string) => {
    // إنهاء وليس حذفاً: يبقى السجل للتاريخ، ويُسجَّل التغيير في سجل التدقيق.
    const { error } = await db.from("cm_peer_review").update({ valid_to: new Date().toISOString().slice(0, 10) }).eq("id", id);
    if (error) return toast.error(`تعذّر الحذف: ${error.message}`);
    toast.success("تم إلغاء المراجعة");
    load();
  };

  const saveKpi = async () => {
    if (!kpi) return;
    const { id, ...rest } = kpi;
    const { error } = await db.from("cm_kpi_settings").update({
      service_window_start: rest.service_window_start, service_window_end: rest.service_window_end,
      abandoned_minutes: rest.abandoned_minutes, first_reply_target_on_shift_min: rest.first_reply_target_on_shift_min,
      first_reply_target_off_shift_min: rest.first_reply_target_off_shift_min,
    }).eq("id", id);
    error ? toast.error(`تعذّر الحفظ: ${error.message}`) : toast.success("تم حفظ المؤشرات");
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-6">
        <Header title="إدارة المحادثات" subtitle="الشيفتات والأجازات الأسبوعية وإعدادات التوزيع ومؤشرات الرد" />
        {!canEdit && <Badge variant="secondary">عرض فقط — التعديل لمديرة المبيعات والمدير العام</Badge>}
        <Tabs value={tab} onValueChange={(v) => navigate(v === "settings" ? CHAT_MANAGEMENT_SETTINGS_PATH : CHAT_MANAGEMENT_SHIFTS_PATH)}>
          <TabsList>
            <TabsTrigger value="shifts">الشيفتات والأجازات</TabsTrigger>
            <TabsTrigger value="settings">إعدادات التوزيع والمؤشرات</TabsTrigger>
          </TabsList>

          <TabsContent value="shifts" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle>جدول الأسبوع</CardTitle>
                  <CardDescription>من {dates[0]} إلى {dates[6]}</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="icon" aria-label="الأسبوع السابق" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronRight className="h-4 w-4" /></Button>
                  <Button variant="outline" size="icon" aria-label="الأسبوع التالي" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronLeft className="h-4 w-4" /></Button>
                  {canEdit && <Button onClick={generate} disabled={loading} className="bg-[#A4288A] hover:bg-[#662D8C] text-white"><Wand2 className="h-4 w-4 ml-1" />توليد الأسبوع</Button>}
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      <th className="p-2 border text-right">الشيفت</th>
                      {dates.map((d) => (
                        <th key={d} className="p-2 border text-center min-w-[130px]">
                          <div className="font-bold">{AR_WEEKDAYS[dowOf(d)]}</div>
                          <div className="text-xs text-muted-foreground">{d}</div>
                          <div className="text-xs text-[#F37346]">{PATTERN_LABEL[patterns[dowOf(d)] ?? "three_shift"]}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: maxSlots }, (_, i) => i + 1).map((slot) => (
                      <tr key={slot}>
                        <td className="p-2 border font-medium whitespace-nowrap">شيفت {slot}</td>
                        {dates.map((d) => {
                          const t = templateFor(d, slot);
                          const a = cell(d, slot);
                          if (!t) return <td key={d} className="p-2 border text-center text-muted-foreground">—</td>;
                          const offIds = Object.entries(daysOff).filter(([, v]) => v === dowOf(d)).map(([k]) => k);
                          return (
                            <td key={d} className="p-2 border align-top">
                              <div className="text-xs text-muted-foreground mb-1" dir="ltr">{hhmm(a?.starts_at ?? t.starts_at)}–{hhmm(a?.ends_at ?? t.ends_at)}</div>
                              {canEdit ? (
                                <Select value={a?.moderator_id ?? NONE} onValueChange={(v) => setCell(d, slot, v === NONE ? null : v)}>
                                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={NONE}>بدون</SelectItem>
                                    {chatMods.map((m) => (
                                      <SelectItem key={m.id} value={m.id}>{m.display_name}{offIds.includes(m.id) ? " (أجازة)" : ""}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : <div>{modName(a?.moderator_id ?? null)}</div>}
                              {a?.source === "manual" && <div className="text-[10px] text-[#662D8C] mt-1">تعديل يدوي</div>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>الأجازة الأسبوعية</CardTitle>
                <CardDescription>يوم أجازة واحد لكل مودريتور، ويُستبعد تلقائياً عند توليد الأسبوع</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!loading && chatMods.some((m) => daysOff[m.id] == null) && (
                  <div role="status" className="flex items-start gap-2 rounded-md border border-[#F37346]/40 bg-[#F37346]/10 p-3 text-sm">
                    <Info className="h-4 w-4 mt-0.5 text-[#F37346]" />
                    <span>
                      لم يُحدَّد يوم الأجازة بعد لـ: {chatMods.filter((m) => daysOff[m.id] == null).map((m) => m.display_name).join("، ")}.
                      {canEdit ? " اختاري يوم الأجازة لكل مودريتور من القوائم أدناه قبل «توليد الأسبوع»، وإلا ستُوزَّع على كل الأيام." : " تحددها مديرة المبيعات من هذه الصفحة."}
                    </span>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {chatMods.map((m) => (
                  <div key={m.id} className="space-y-1">
                    <Label>{m.display_name}</Label>
                    <Select disabled={!canEdit} value={daysOff[m.id] == null ? NONE : String(daysOff[m.id])} onValueChange={(v) => saveDayOff(m.id, v === NONE ? null : Number(v))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>بدون أجازة ثابتة</SelectItem>
                        {[6, 0, 1, 2, 3, 4, 5].map((d) => <SelectItem key={d} value={String(d)}>{AR_WEEKDAYS[d]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>المراجعة المتبادلة</CardTitle>
                <CardDescription>
                  تحدد مديرة المبيعات من تراجع أوردرات من. الأزواج المعلَّمة «افتراضي أولي» أُدخلت كبداية فقط ويمكن حذفها أو تغييرها، وكل تعديل يُسجَّل في سجل التدقيق.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {peers.length === 0 && <div className="text-sm text-muted-foreground">لا توجد مراجعات محددة حالياً.</div>}
                {peers.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-2 border rounded-md p-2">
                    <span className="font-medium">{modName(p.reviewer_moderator_id)}</span>
                    <span className="text-muted-foreground">تراجع</span>
                    <span className="font-medium">{modName(p.reviewee_moderator_id)}</span>
                    {p.source_policy && <Badge variant="outline" className="text-[#662D8C]">افتراضي أولي</Badge>}
                    <span className="text-xs text-muted-foreground">منذ {p.valid_from}</span>
                    {canEdit && (
                      <Button size="sm" variant="ghost" className="mr-auto" aria-label="إلغاء المراجعة" onClick={() => endPeer(p.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <div className="flex flex-wrap items-end gap-2 pt-2">
                    <div className="space-y-1"><Label>المراجِعة</Label>
                      <Select value={newReviewer} onValueChange={setNewReviewer}>
                        <SelectTrigger className="w-40"><SelectValue placeholder="اختر" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>اختر</SelectItem>
                          {chatMods.map((m) => <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>)}
                        </SelectContent>
                      </Select></div>
                    <div className="space-y-1"><Label>تراجع أوردرات</Label>
                      <Select value={newReviewee} onValueChange={setNewReviewee}>
                        <SelectTrigger className="w-40"><SelectValue placeholder="اختر" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>اختر</SelectItem>
                          {moderators.filter((m) => m.is_active && m.id !== newReviewer).map((m) => <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>)}
                        </SelectContent>
                      </Select></div>
                    <Button onClick={addPeer}><Plus className="h-4 w-4 ml-1" />إضافة</Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>نظام كل يوم</CardTitle></CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {[6, 0, 1, 2, 3, 4, 5].map((d) => (
                  <div key={d} className="space-y-1">
                    <Label>{AR_WEEKDAYS[d]}</Label>
                    <Select disabled={!canEdit} value={patterns[d] ?? "three_shift"} onValueChange={(v) => savePattern(d, v as DayPattern)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="four_shift">{PATTERN_LABEL.four_shift}</SelectItem>
                        <SelectItem value="three_shift">{PATTERN_LABEL.three_shift}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>مواعيد الشيفتات</CardTitle><CardDescription>التعديل يسري على الأسابيع التي تُولَّد بعده</CardDescription></CardHeader>
              <CardContent className="space-y-2">
                {templates.map((t, idx) => (
                  <div key={t.id} className="flex flex-wrap items-end gap-2">
                    <Badge variant="outline" className="w-24 justify-center">{PATTERN_LABEL[t.day_pattern]}</Badge>
                    <div><Label>الاسم</Label><Input disabled={!canEdit} value={t.label} onChange={(e) => setTemplates((s) => s.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))} /></div>
                    <div><Label>من</Label><Input type="time" dir="ltr" disabled={!canEdit} value={hhmm(t.starts_at)} onChange={(e) => setTemplates((s) => s.map((x, i) => i === idx ? { ...x, starts_at: e.target.value } : x))} /></div>
                    <div><Label>إلى</Label><Input type="time" dir="ltr" disabled={!canEdit} value={hhmm(t.ends_at)} onChange={(e) => setTemplates((s) => s.map((x, i) => i === idx ? { ...x, ends_at: e.target.value } : x))} /></div>
                    {canEdit && <Button size="sm" variant="outline" onClick={() => saveTemplate(t)}><Save className="h-4 w-4" /></Button>}
                  </div>
                ))}
              </CardContent>
            </Card>

            {dist && (
              <Card>
                <CardHeader><CardTitle>طريقة توزيع المحادثات</CardTitle><CardDescription>المحادثة على خط مودريتور تبقى لصاحبة الخط؛ التوزيع للمحادثات غير المملوكة</CardDescription></CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1"><Label>الطريقة الأساسية</Label>
                    <Select disabled={!canEdit} value={dist.method} onValueChange={(v) => setDist({ ...dist, method: v as DistributionMethod })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(DISTRIBUTION_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div className="space-y-1"><Label>البديل عند عدم المطابقة</Label>
                    <Select disabled={!canEdit} value={dist.fallback_method} onValueChange={(v) => setDist({ ...dist, fallback_method: v as FallbackMethod })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(FALLBACK_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div className="space-y-1"><Label>إزاحة الدور عند توليد الأسبوع</Label>
                    <Input type="number" disabled={!canEdit} value={dist.rotation_offset} onChange={(e) => setDist({ ...dist, rotation_offset: Number(e.target.value) || 0 })} /></div>
                  {canEdit && <Button onClick={saveDist} className="sm:col-span-3 w-fit">حفظ</Button>}
                </CardContent>
              </Card>
            )}

            {kpi && (
              <Card>
                <CardHeader><CardTitle>مؤشرات الرد</CardTitle><CardDescription>الرسائل خارج نافذة الخدمة يبدأ عدّادها مع بداية النافذة</CardDescription></CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-5">
                  <div><Label>بداية الخدمة</Label><Input type="time" dir="ltr" disabled={!canEdit} value={hhmm(kpi.service_window_start)} onChange={(e) => setKpi({ ...kpi, service_window_start: e.target.value })} /></div>
                  <div><Label>نهاية الخدمة</Label><Input type="time" dir="ltr" disabled={!canEdit} value={hhmm(kpi.service_window_end)} onChange={(e) => setKpi({ ...kpi, service_window_end: e.target.value })} /></div>
                  <div><Label>المحادثة المهملة (دقيقة)</Label><Input type="number" disabled={!canEdit} value={kpi.abandoned_minutes} onChange={(e) => setKpi({ ...kpi, abandoned_minutes: Number(e.target.value) })} /></div>
                  <div><Label>أول رد داخل الشيفت (دقيقة)</Label><Input type="number" disabled={!canEdit} value={kpi.first_reply_target_on_shift_min} onChange={(e) => setKpi({ ...kpi, first_reply_target_on_shift_min: Number(e.target.value) })} /></div>
                  <div><Label>أول رد خارج الشيفت (دقيقة)</Label><Input type="number" disabled={!canEdit} value={kpi.first_reply_target_off_shift_min} onChange={(e) => setKpi({ ...kpi, first_reply_target_off_shift_min: Number(e.target.value) })} /></div>
                  {canEdit && <Button onClick={saveKpi} className="sm:col-span-5 w-fit">حفظ</Button>}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
