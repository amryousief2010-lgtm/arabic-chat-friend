import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Info,
  LayoutTemplate,
  Moon,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UserPlus,
  Wand2,
  X,
} from "lucide-react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import CmAccessGateCard from "@/components/chat/CmAccessGateCard";
import { CopyShiftsDialog, type CopyMode } from "@/components/chatManagement/CopyShiftsDialog";
import { ShiftEditDialog, type ShiftEditFormValues } from "@/components/chatManagement/ShiftEditDialog";
import { ShiftTemplatesPanel, type TemplateRow } from "@/components/chatManagement/ShiftTemplatesPanel";
import { TimeInput24 } from "@/components/chatManagement/TimeInput24";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CHAT_MANAGEMENT_SETTINGS_PATH,
  CHAT_MANAGEMENT_SHIFTS_PATH,
  CHAT_MANAGEMENT_VIEW_ROLES,
  canEditChatManagement,
  canEditShifts,
} from "@/config/chatManagement";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  DISTRIBUTION_LABELS,
  FALLBACK_LABELS,
  type DistributionMethod,
  type FallbackMethod,
} from "@/lib/chatManagement/distribution";
import {
  AR_WEEKDAYS,
  addDays,
  buildCopiedDayShifts,
  buildCopiedWeekShifts,
  dowOf,
  findModeratorOverlaps,
  formatDurationAr,
  generateWeek,
  hhmm,
  isOvernightShift,
  isWorkingOn,
  rosterWarnings,
  shiftDurationMinutes,
  shiftLabelForIndex,
  timeToMinutes,
  validateWeekRoster,
  weekDates,
  weekStartSaturday,
  type DayPattern,
  type DayShift,
  type RosterModerator,
  type ShiftPattern,
} from "@/lib/chatManagement/roster";
import {
  addModeratorToShift,
  applyCopiedShifts,
  applyGeneratedDays,
  clearDayShifts,
  deleteDayShift,
  removeModeratorFromShift,
  saveDayShift,
} from "@/lib/chatManagement/shiftsPersistence";
import { formatClock12 } from "@/lib/chatManagement/timeFormat";

type Tab = "shifts" | "settings";
const NONE = "__none__";
const db = supabase as any;

interface PeerRow {
  id: string;
  reviewer_moderator_id: string;
  reviewee_moderator_id: string;
  valid_from: string;
  source_policy: string | null;
}
interface DistRow {
  id: number;
  method: DistributionMethod;
  fallback_method: FallbackMethod;
  rotation_offset: number;
}
interface KpiRow {
  id: number;
  service_window_start: string;
  service_window_end: string;
  abandoned_minutes: number;
  first_reply_target_on_shift_min: number;
  first_reply_target_off_shift_min: number;
}

export default function ChatManagementShifts({ tab = "shifts" }: { tab?: Tab }) {
  const navigate = useNavigate();
  const { roles } = useAuth() as { roles?: string[] };
  const canEditShiftRoster = canEditShifts(roles);
  const canEditGeneralSettings = canEditChatManagement(roles);
  const canViewSettingsTab = !!roles?.some((r) => (CHAT_MANAGEMENT_VIEW_ROLES as string[]).includes(r));

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const currentWeekStart = useMemo(() => weekStartSaturday(todayStr), [todayStr]);
  const [weekStart, setWeekStart] = useState(() => weekStartSaturday(new Date().toISOString().slice(0, 10)));
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);

  const [moderators, setModerators] = useState<RosterModerator[]>([]);
  const [shiftPatterns, setShiftPatterns] = useState<ShiftPattern[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [patterns, setPatterns] = useState<Record<number, DayPattern>>({});
  const [daysOff, setDaysOff] = useState<Record<string, number | null>>({});
  const [shifts, setShifts] = useState<DayShift[]>([]);
  const [dist, setDist] = useState<DistRow | null>(null);
  const [kpi, setKpi] = useState<KpiRow | null>(null);
  const [peers, setPeers] = useState<PeerRow[]>([]);
  const [newReviewer, setNewReviewer] = useState<string>(NONE);
  const [newReviewee, setNewReviewee] = useState<string>(NONE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [editInitial, setEditInitial] = useState<ShiftEditFormValues | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<CopyMode | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const rangeStart = addDays(dates[0], -1);
    const rangeEnd = addDays(dates[6], 1);

    try {
      if (!canViewSettingsTab) {
        const { data: sched, error: sErr } = await db.rpc("cm_get_week_schedule", {
          _from: rangeStart,
          _to: rangeEnd,
        });
        if (sErr) throw sErr;
        const payload = sched ?? {};
        setModerators(payload.moderators ?? []);
        setDaysOff(Object.fromEntries((payload.days_off ?? []).map((r: any) => [r.moderator_id, r.dow])));
        setShifts(
          (payload.shifts ?? []).map((s: any) => ({
            id: s.id,
            work_date: s.work_date,
            sort_order: Number(s.sort_order ?? 1),
            label: s.label,
            starts_at: hhmm(s.starts_at),
            ends_at: hhmm(s.ends_at),
            staff_count: Number(s.staff_count ?? 1),
            source: s.source ?? "manual",
            moderator_ids: Array.isArray(s.moderator_ids) ? s.moderator_ids : [],
          })),
        );
        setLoading(false);
        return;
      }

      const [m, sp, t, p, o, ds, sa, d, k, pr] = await Promise.all([
        db
          .from("cm_moderators")
          .select("id,display_name,sort_order,is_active,chat_active,start_date,end_date")
          .order("sort_order"),
        db.from("cm_shift_patterns").select("key,name,sort_order").order("sort_order"),
        db.from("cm_shift_templates").select("*").order("day_pattern").order("slot_no"),
        db.from("cm_weekday_patterns").select("dow,day_pattern"),
        db.from("cm_weekly_days_off").select("moderator_id,dow").is("valid_to", null),
        db
          .from("cm_day_shifts")
          .select("*")
          .gte("work_date", rangeStart)
          .lte("work_date", rangeEnd)
          .order("work_date")
          .order("starts_at")
          .order("sort_order"),
        db
          .from("cm_shift_assignments")
          .select("id,day_shift_id,work_date,slot_no,label,starts_at,ends_at,moderator_id,source")
          .gte("work_date", rangeStart)
          .lte("work_date", rangeEnd),
        db.from("cm_distribution_settings").select("*").maybeSingle(),
        db.from("cm_kpi_settings").select("*").maybeSingle(),
        db
          .from("cm_peer_review")
          .select("id,reviewer_moderator_id,reviewee_moderator_id,valid_from,source_policy")
          .is("valid_to", null)
          .order("created_at"),
      ]);

      const err = [m, sp, t, p, o, ds, sa, d, k, pr].find((r) => r.error)?.error;
      if (err) throw err;

      setModerators(m.data ?? []);
      setShiftPatterns(sp.data ?? []);
      setTemplates(t.data ?? []);
      setPatterns(Object.fromEntries((p.data ?? []).map((r: any) => [r.dow, r.day_pattern])));
      setDaysOff(Object.fromEntries((o.data ?? []).map((r: any) => [r.moderator_id, r.dow])));

      const assignByShift = new Map<string, string[]>();
      for (const a of sa.data ?? []) {
        if (!a.day_shift_id || !a.moderator_id) continue;
        const arr = assignByShift.get(a.day_shift_id) ?? [];
        if (!arr.includes(a.moderator_id)) arr.push(a.moderator_id);
        assignByShift.set(a.day_shift_id, arr);
      }

      const loadedShifts: DayShift[] = (ds.data ?? []).map((s: any) => ({
        id: s.id,
        work_date: s.work_date,
        sort_order: Number(s.sort_order ?? 1),
        label: s.label,
        starts_at: hhmm(s.starts_at),
        ends_at: hhmm(s.ends_at),
        staff_count: Number(s.staff_count ?? 1),
        source: s.source ?? "manual",
        moderator_ids: assignByShift.get(s.id) ?? [],
      }));

      setShifts(loadedShifts);
      setDist(d.data ?? null);
      setKpi(k.data ?? null);
      setPeers(pr.data ?? []);
    } catch (e: any) {
      toast.error(`تعذّر تحميل البيانات: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [dates, canViewSettingsTab]);

  useEffect(() => {
    load();
  }, [load]);

  const chatMods = useMemo(
    () =>
      moderators
        .filter((m) => m.is_active && m.chat_active)
        .sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name)),
    [moderators],
  );

  const modName = useCallback(
    (id: string | null) => moderators.find((m) => m.id === id)?.display_name ?? "—",
    [moderators],
  );

  const weekShifts = useMemo(
    () => shifts.filter((s) => dates.includes(s.work_date)),
    [shifts, dates],
  );

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, DayShift[]>();
    for (const d of dates) map.set(d, []);
    for (const s of weekShifts) {
      const list = map.get(s.work_date);
      if (list) list.push(s);
    }
    for (const list of map.values()) {
      list.sort((a, b) => timeToMinutes(a.starts_at) - timeToMinutes(b.starts_at) || a.sort_order - b.sort_order);
    }
    return map;
  }, [dates, weekShifts]);

  const rosterCheck = useMemo(
    () =>
      validateWeekRoster({
        dates,
        shifts,
        moderators,
        daysOff,
        serviceWindowStart: kpi ? hhmm(kpi.service_window_start) : "09:00",
        serviceWindowEnd: kpi ? hhmm(kpi.service_window_end) : "01:00",
      }),
    [dates, shifts, moderators, daysOff, kpi],
  );

  const totalAssignedSeats = useMemo(
    () => weekShifts.reduce((acc, s) => acc + s.moderator_ids.length, 0),
    [weekShifts],
  );

  const openAddShift = (workDate: string) => {
    const dayList = shiftsByDate.get(workDate) ?? [];
    const last = dayList[dayList.length - 1];
    const defaultStart = last ? hhmm(last.ends_at) : "09:00";
    const endHour = (Number(defaultStart.slice(0, 2)) + 4) % 24;
    const defaultEnd = `${String(endHour).padStart(2, "0")}:${defaultStart.slice(3, 5)}`;
    const nextOrder = dayList.length ? Math.max(...dayList.map((s) => s.sort_order)) + 1 : 1;

    setEditInitial({
      work_date: workDate,
      sort_order: nextOrder,
      label: shiftLabelForIndex(dayList.length + 1),
      starts_at: defaultStart,
      ends_at: defaultEnd === defaultStart ? "13:00" : defaultEnd,
      staff_count: 1,
      moderator_ids: [],
    });
    setEditOpen(true);
  };

  const openEditShift = (s: DayShift) => {
    setEditInitial({
      shiftId: s.id,
      work_date: s.work_date,
      sort_order: s.sort_order,
      label: s.label,
      starts_at: hhmm(s.starts_at),
      ends_at: hhmm(s.ends_at),
      staff_count: s.staff_count,
      moderator_ids: [...s.moderator_ids],
      currentModeratorIds: [...s.moderator_ids],
    });
    setEditOpen(true);
  };

  const handleSaveShift = async (values: ShiftEditFormValues) => {
    try {
      await saveDayShift(values);
      toast.success(values.shiftId ? "تم تحديث الشيفت" : "تمت إضافة الشيفت");
      await load();
    } catch (e: any) {
      toast.error(`تعذّر الحفظ: ${e.message}`);
      throw e;
    }
  };

  const handleQuickAddModerator = async (shift: DayShift, moderatorId: string) => {
    if (!moderatorId || moderatorId === NONE) return;
    const overlaps = findModeratorOverlaps(
      {
        id: shift.id,
        work_date: shift.work_date,
        label: shift.label,
        starts_at: shift.starts_at,
        ends_at: shift.ends_at,
        staff_count: shift.staff_count,
        moderator_ids: [moderatorId],
      },
      shifts,
    );
    if (overlaps.length > 0) {
      const ov = overlaps[0].conflictingShift;
      toast.error(
        `لا يمكن التعيين: ${modName(moderatorId)} لديها شيفت متداخل «${ov.label}» (${formatClock12(ov.starts_at)} – ${formatClock12(ov.ends_at)})`,
      );
      return;
    }

    try {
      await addModeratorToShift(shift, moderatorId);
      if (daysOff[moderatorId] === dowOf(shift.work_date)) {
        toast.warning(`تم تعيين ${modName(moderatorId)}، مع تنبيه: هذا يوم إجازتها الأسبوعية`);
      } else {
        toast.success(`تمت إضافة ${modName(moderatorId)}`);
      }
      await load();
    } catch (e: any) {
      toast.error(`تعذّر التعيين: ${e.message}`);
    }
  };

  const handleQuickRemoveModerator = async (shift: DayShift, moderatorId: string) => {
    try {
      await removeModeratorFromShift(shift, moderatorId);
      toast.success(`تمت إزالة ${modName(moderatorId)} من الشيفت`);
      await load();
    } catch (e: any) {
      toast.error(`تعذّر الإزالة: ${e.message}`);
    }
  };

  const handleDeleteShift = async (shift: DayShift) => {
    try {
      await deleteDayShift(shift.id);
      toast.success(`تم حذف «${shift.label}»`);
      await load();
    } catch (e: any) {
      toast.error(`تعذّر الحذف: ${e.message}`);
    }
  };

  const handleGenerateWeek = async () => {
    setBusy(true);
    try {
      const days = generateWeek({
        weekStart,
        templates,
        moderators,
        daysOff,
        patterns,
        rotationOffset: dist?.rotation_offset ?? 0,
      });
      const { preservedManualCount } = await applyGeneratedDays({
        days,
        existingShifts: weekShifts,
        replaceManual: false,
      });
      const warns = rosterWarnings(days);
      toast.success(
        `تم توليد الأسبوع${preservedManualCount ? ` (مع الإبقاء على ${preservedManualCount} شيفت معدّل يدوياً)` : ""}`,
      );
      warns.slice(0, 3).forEach((w) => toast.warning(w));
      await load();
    } catch (e: any) {
      toast.error(`تعذّر التوليد: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerateSingleDay = async (workDate: string) => {
    setBusy(true);
    try {
      const days = generateWeek({
        weekStart,
        templates,
        moderators,
        daysOff,
        patterns,
        rotationOffset: dist?.rotation_offset ?? 0,
      }).filter((d) => d.work_date === workDate);
      await applyGeneratedDays({ days, existingShifts: weekShifts, replaceManual: true });
      toast.success(`تمت إعادة توليد ${AR_WEEKDAYS[dowOf(workDate)]} من القالب`);
      await load();
    } catch (e: any) {
      toast.error(`تعذّر التوليد: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleClearDay = async (workDate: string) => {
    setBusy(true);
    try {
      await clearDayShifts(workDate);
      toast.success(`تم مسح شيفتات ${AR_WEEKDAYS[dowOf(workDate)]}`);
      await load();
    } catch (e: any) {
      toast.error(`تعذّر المسح: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmCopyDay = async (args: {
    sourceDate: string;
    targetDates: string[];
    includeModerators: boolean;
    mode: "replace" | "append";
  }) => {
    const source = shiftsByDate.get(args.sourceDate) ?? [];
    const drafts = buildCopiedDayShifts(source, args.targetDates, {
      includeModerators: args.includeModerators,
    });
    const minD = addDays(
      args.targetDates.reduce((a, b) => (a < b ? a : b)),
      -1,
    );
    const maxD = addDays(
      args.targetDates.reduce((a, b) => (a > b ? a : b)),
      1,
    );
    const { data: targetDs } = await db
      .from("cm_day_shifts")
      .select("id,work_date,sort_order,label,starts_at,ends_at,staff_count,source")
      .gte("work_date", minD)
      .lte("work_date", maxD);
    const { data: targetSa } = await db
      .from("cm_shift_assignments")
      .select("day_shift_id,moderator_id")
      .gte("work_date", minD)
      .lte("work_date", maxD);

    const byId = new Map<string, string[]>();
    for (const a of targetSa ?? []) {
      if (!a.day_shift_id || !a.moderator_id) continue;
      const arr = byId.get(a.day_shift_id) ?? [];
      arr.push(a.moderator_id);
      byId.set(a.day_shift_id, arr);
    }
    const existingTargetShifts: DayShift[] = (targetDs ?? []).map((s: any) => ({
      ...s,
      starts_at: hhmm(s.starts_at),
      ends_at: hhmm(s.ends_at),
      moderator_ids: byId.get(s.id) ?? [],
    }));

    const { created, skippedOverlaps } = await applyCopiedShifts({
      drafts,
      targetDates: args.targetDates,
      mode: args.mode,
      existingTargetShifts,
    });
    toast.success(
      `تم نسخ ${created} شيفت${skippedOverlaps ? ` (تم تخطي ${skippedOverlaps} تعيين لتداخل الأوقات)` : ""}`,
    );
    await load();
  };

  const handleConfirmCopyWeek = async (args: {
    sourceWeekStart: string;
    targetWeekStart: string;
    includeModerators: boolean;
    mode: "replace" | "append";
  }) => {
    const tgtDates = weekDates(args.targetWeekStart);
    const drafts = buildCopiedWeekShifts(weekShifts, args.sourceWeekStart, args.targetWeekStart, {
      includeModerators: args.includeModerators,
    });
    const minD = addDays(tgtDates[0], -1);
    const maxD = addDays(tgtDates[6], 1);

    const { data: targetDs } = await db
      .from("cm_day_shifts")
      .select("id,work_date,sort_order,label,starts_at,ends_at,staff_count,source")
      .gte("work_date", minD)
      .lte("work_date", maxD);
    const { data: targetSa } = await db
      .from("cm_shift_assignments")
      .select("day_shift_id,moderator_id")
      .gte("work_date", minD)
      .lte("work_date", maxD);

    const byId = new Map<string, string[]>();
    for (const a of targetSa ?? []) {
      if (!a.day_shift_id || !a.moderator_id) continue;
      const arr = byId.get(a.day_shift_id) ?? [];
      arr.push(a.moderator_id);
      byId.set(a.day_shift_id, arr);
    }
    const existingTargetShifts: DayShift[] = (targetDs ?? []).map((s: any) => ({
      ...s,
      starts_at: hhmm(s.starts_at),
      ends_at: hhmm(s.ends_at),
      moderator_ids: byId.get(s.id) ?? [],
    }));

    const { created, skippedOverlaps } = await applyCopiedShifts({
      drafts,
      targetDates: tgtDates,
      mode: args.mode,
      existingTargetShifts,
    });
    toast.success(
      `تم نسخ ${created} شيفت إلى أسبوع ${args.targetWeekStart}${skippedOverlaps ? ` (تم تخطي ${skippedOverlaps} تعيين لتداخل الأوقات)` : ""}`,
    );
    setWeekStart(args.targetWeekStart);
  };

  const saveDayOff = async (moderatorId: string, dow: number | null) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { error: e1 } = await db
        .from("cm_weekly_days_off")
        .update({ valid_to: today })
        .eq("moderator_id", moderatorId)
        .is("valid_to", null);
      if (e1) throw e1;
      if (dow !== null) {
        const { error: e2 } = await db
          .from("cm_weekly_days_off")
          .insert({ moderator_id: moderatorId, dow, valid_from: today });
        if (e2) throw e2;
      }
      toast.success("تم حفظ يوم الإجازة");
      load();
    } catch (e: any) {
      toast.error(`تعذّر الحفظ: ${e.message}`);
    }
  };

  const saveDist = async () => {
    if (!dist) return;
    const { error } = await db
      .from("cm_distribution_settings")
      .update({
        method: dist.method,
        fallback_method: dist.fallback_method,
        rotation_offset: dist.rotation_offset,
      })
      .eq("id", dist.id);
    error ? toast.error(`تعذّر الحفظ: ${error.message}`) : toast.success("تم حفظ إعدادات التوزيع");
  };

  const addPeer = async () => {
    if (newReviewer === NONE || newReviewee === NONE) return toast.error("اختر المراجِعة والمراجَعة");
    if (newReviewer === newReviewee) return toast.error("لا يمكن أن تراجع المودريتور نفسها");
    if (peers.some((p) => p.reviewer_moderator_id === newReviewer && p.reviewee_moderator_id === newReviewee))
      return toast.error("هذه المراجعة موجودة بالفعل");
    const { error } = await db
      .from("cm_peer_review")
      .insert({ reviewer_moderator_id: newReviewer, reviewee_moderator_id: newReviewee });
    if (error) return toast.error(`تعذّر الإضافة: ${error.message}`);
    toast.success("تمت إضافة المراجعة");
    setNewReviewer(NONE);
    setNewReviewee(NONE);
    load();
  };

  const endPeer = async (id: string) => {
    const { error } = await db
      .from("cm_peer_review")
      .update({ valid_to: new Date().toISOString().slice(0, 10) })
      .eq("id", id);
    if (error) return toast.error(`تعذّر الحذف: ${error.message}`);
    toast.success("تم إلغاء المراجعة");
    load();
  };

  const saveKpi = async () => {
    if (!kpi) return;
    const { id, ...rest } = kpi;
    const { error } = await db
      .from("cm_kpi_settings")
      .update({
        service_window_start: rest.service_window_start,
        service_window_end: rest.service_window_end,
        abandoned_minutes: rest.abandoned_minutes,
        first_reply_target_on_shift_min: rest.first_reply_target_on_shift_min,
        first_reply_target_off_shift_min: rest.first_reply_target_off_shift_min,
      })
      .eq("id", id);
    error ? toast.error(`تعذّر الحفظ: ${error.message}`) : toast.success("تم حفظ المؤشرات");
  };

  const activeTab: Tab = canViewSettingsTab ? tab : "shifts";

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-6 font-cairo">
        <Header
          title="إدارة المحادثات"
          subtitle="جدول الشيفتات المرن والإجازات الأسبوعية وإعدادات التوزيع ومؤشرات الرد"
        />

        {!canEditShiftRoster && (
          <Badge variant="secondary" className="bg-[#662D8C]/10 text-[#662D8C] border border-[#662D8C]/20">
            عرض فقط — التعديل لمديرة المبيعات والمدير التنفيذي والمدير العام
          </Badge>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(v) =>
            navigate(v === "settings" ? CHAT_MANAGEMENT_SETTINGS_PATH : CHAT_MANAGEMENT_SHIFTS_PATH)
          }
        >
          <TabsList>
            <TabsTrigger value="shifts">الشيفتات والإجازات</TabsTrigger>
            {canViewSettingsTab && (
              <TabsTrigger value="settings">إعدادات التوزيع والمؤشرات</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="shifts" className="space-y-6">
            <Card className="border-[#662D8C]/15">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-[#662D8C]">جدول الأسبوع</CardTitle>
                    <Badge variant="outline" className="border-[#A4288A]/30 text-[#A4288A] font-normal">
                      {weekShifts.length} شيفت · {totalAssignedSeats} تعيين
                    </Badge>
                  </div>
                  <CardDescription>
                    من <span className="font-mono" dir="ltr">{dates[0]}</span> إلى{" "}
                    <span className="font-mono" dir="ltr">{dates[6]}</span>
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="الأسبوع السابق"
                      onClick={() => setWeekStart(addDays(weekStart, -7))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    {weekStart !== currentWeekStart && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWeekStart(currentWeekStart)}
                      >
                        الأسبوع الحالي
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="الأسبوع التالي"
                      onClick={() => setWeekStart(addDays(weekStart, 7))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </div>

                  {canEditShiftRoster && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTemplatesOpen(true)}
                        disabled={loading || busy}
                        className="border-[#662D8C]/30 text-[#662D8C] hover:bg-[#662D8C]/5"
                      >
                        <LayoutTemplate className="h-4 w-4 ml-1.5" />
                        قوالب التوليد
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setCopyTarget({ kind: "week", sourceWeekStart: weekStart });
                          setCopyOpen(true);
                        }}
                        disabled={loading || busy || weekShifts.length === 0}
                      >
                        <Copy className="h-4 w-4 ml-1.5" />
                        نسخ الأسبوع
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleGenerateWeek}
                        disabled={loading || busy}
                        className="bg-[#A4288A] hover:bg-[#662D8C] text-white"
                      >
                        <Wand2 className="h-4 w-4 ml-1.5" />
                        توليد الأسبوع
                      </Button>
                    </>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {!loading && (rosterCheck.errors.length > 0 || rosterCheck.warnings.length > 0) && (
                  <div className="space-y-2">
                    {rosterCheck.errors.length > 0 && (
                      <div
                        role="alert"
                        className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive space-y-1"
                      >
                        <div className="font-semibold flex items-center gap-1.5">
                          <ShieldAlert className="h-4 w-4 shrink-0" />
                          تعارضات أوقات تتطلب مراجعة ({rosterCheck.errors.length}):
                        </div>
                        <ul className="list-disc pr-5 space-y-0.5">
                          {rosterCheck.errors.slice(0, 5).map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {rosterCheck.warnings.length > 0 && (
                      <div
                        role="status"
                        className="rounded-lg border border-[#F37346]/40 bg-[#F37346]/10 p-3 text-xs space-y-1"
                      >
                        <div className="font-semibold flex items-center gap-1.5 text-[#662D8C]">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-[#F37346]" />
                          تنبيهات التغطية والإجازات ({rosterCheck.warnings.length} — لا تمنع الحفظ):
                        </div>
                        <ul className="list-disc pr-5 space-y-0.5 text-foreground/90">
                          {rosterCheck.warnings.slice(0, 6).map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                          {rosterCheck.warnings.length > 6 && (
                            <li className="text-muted-foreground">
                              +{rosterCheck.warnings.length - 6} تنبيهات أخرى (موضّحة على أيامها أدناه)
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  يمكنك إضافة أي عدد من الشيفتات في أي يوم وتعيين أكثر من مودريتور في الشيفت الواحد
                </p>

                <div className="pb-1">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2">
                    {dates.map((d) => {
                      const dow = dowOf(d);
                      const dayShifts = shiftsByDate.get(d) ?? [];
                      const gaps = rosterCheck.coverageGapsByDate[d] ?? [];
                      const hasUnderstaffed = dayShifts.some((s) => rosterCheck.understaffedShiftIds.has(s.id));
                      const hasOverlap = dayShifts.some((s) => rosterCheck.overlapShiftIds.has(s.id));
                      const offMods = chatMods.filter((m) => isWorkingOn(m, d) && daysOff[m.id] === dow);
                      const isToday = d === todayStr;

                      return (
                        <div
                          key={d}
                          className={`flex flex-col rounded-xl border bg-card shadow-sm transition-colors ${
                            isToday ? "border-[#A4288A] ring-1 ring-[#A4288A]/20" : "border-border"
                          }`}
                        >
                          <div
                            className={`flex items-start justify-between gap-2 border-b p-2.5 rounded-t-xl ${
                              isToday ? "bg-[#A4288A]/5" : "bg-muted/30"
                            }`}
                          >
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-sm text-[#662D8C]">{AR_WEEKDAYS[dow]}</span>
                                {isToday && (
                                  <Badge className="bg-[#A4288A] hover:bg-[#A4288A] text-white text-[10px] px-1.5 py-0">
                                    اليوم
                                  </Badge>
                                )}
                              </div>
                              <div className="text-[11px] text-muted-foreground font-mono" dir="ltr">
                                {d}
                              </div>
                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                                  {dayShifts.length} {dayShifts.length === 1 ? "شيفت" : "شيفتات"}
                                </Badge>
                                {hasOverlap ? (
                                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                    تداخل
                                  </Badge>
                                ) : gaps.length > 0 ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1.5 py-0 border-[#F37346] text-[#F37346] bg-[#F37346]/5"
                                    title={gaps.map((g) => `${formatClock12(g.start)}–${formatClock12(g.end)}`).join("، ")}
                                  >
                                    فجوة تغطية
                                  </Badge>
                                ) : hasUnderstaffed ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1.5 py-0 border-[#F37346] text-[#F37346]"
                                  >
                                    ناقص عدد
                                  </Badge>
                                ) : dayShifts.length > 0 ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1.5 py-0 border-emerald-500/40 text-emerald-700 bg-emerald-500/5"
                                  >
                                    تغطية مكتملة
                                  </Badge>
                                ) : null}
                              </div>
                              {offMods.length > 0 && (
                                <div className="text-[11px] text-[#F37346] pt-0.5">
                                  إجازة: {offMods.map((m) => m.display_name).join("، ")}
                                </div>
                              )}
                            </div>

                            {canEditShiftRoster && (
                              <DropdownMenu dir="rtl">
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0"
                                    aria-label={`خيارات ${AR_WEEKDAYS[dow]}`}
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => openAddShift(d)}>
                                    <Plus className="h-4 w-4 ml-2 text-[#A4288A]" />
                                    إضافة شيفت
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={dayShifts.length === 0}
                                    onClick={() => {
                                      setCopyTarget({ kind: "day", sourceDate: d });
                                      setCopyOpen(true);
                                    }}
                                  >
                                    <Copy className="h-4 w-4 ml-2" />
                                    نسخ اليوم إلى...
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleRegenerateSingleDay(d)}>
                                    <RotateCcw className="h-4 w-4 ml-2" />
                                    توليد اليوم من القالب
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    disabled={dayShifts.length === 0}
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => handleClearDay(d)}
                                  >
                                    <Trash2 className="h-4 w-4 ml-2" />
                                    مسح شيفتات اليوم
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>

                          <div className="flex-1 p-2 space-y-2">
                            {dayShifts.length === 0 && (
                              <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                                لا توجد شيفتات مسجلة
                              </div>
                            )}

                            {dayShifts.map((s) => {
                              const overnight = isOvernightShift(s.starts_at, s.ends_at);
                              const dur = shiftDurationMinutes(s.starts_at, s.ends_at);
                              const hasShiftOverlap = rosterCheck.overlapShiftIds.has(s.id);
                              const understaffed = s.moderator_ids.length < Math.max(1, s.staff_count);
                              const availableToAdd = chatMods.filter((m) => !s.moderator_ids.includes(m.id));

                              return (
                                <div
                                  key={s.id}
                                  className={`rounded-lg border p-2 space-y-1.5 transition-colors ${
                                    hasShiftOverlap
                                      ? "border-destructive/60 bg-destructive/5"
                                      : understaffed
                                        ? "border-[#F37346]/60 bg-[#F37346]/5"
                                        : s.source === "manual"
                                          ? "border-[#662D8C]/30 bg-background"
                                          : "border-border bg-background"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-1">
                                    <div className="min-w-0">
                                      <div className="font-semibold text-xs leading-snug">{s.label}</div>
                                      <div className="text-[11px] text-muted-foreground font-medium mt-0.5 whitespace-nowrap">
                                        {formatClock12(s.starts_at)} – {formatClock12(s.ends_at)}
                                      </div>
                                    </div>

                                    {canEditShiftRoster && (
                                      <div className="flex items-center shrink-0">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6"
                                          aria-label={`تعديل ${s.label}`}
                                          onClick={() => openEditShift(s)}
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6 text-destructive hover:text-destructive"
                                          aria-label={`حذف ${s.label}`}
                                          onClick={() => handleDeleteShift(s)}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                                    {s.source === "manual" && (
                                      <Badge variant="outline" className="px-1 py-0 border-[#662D8C]/30 bg-[#662D8C]/10 text-[#662D8C] font-normal">
                                        يدوي
                                      </Badge>
                                    )}
                                    <Badge variant="outline" className="px-1 py-0 font-normal">
                                      {formatDurationAr(dur)}
                                    </Badge>
                                    {overnight && (
                                      <Badge
                                        variant="outline"
                                        className="px-1.5 py-0 border-[#662D8C]/40 text-[#662D8C] gap-0.5"
                                      >
                                        <Moon className="h-2.5 w-2.5" />
                                        ليلي
                                      </Badge>
                                    )}
                                    <Badge
                                      variant="outline"
                                      className={`px-1.5 py-0 ${
                                        understaffed
                                          ? "border-[#F37346] text-[#F37346]"
                                          : "border-emerald-500/30 text-emerald-700"
                                      }`}
                                    >
                                      {s.moderator_ids.length}/{s.staff_count}
                                    </Badge>
                                  </div>

                                  <div className="flex flex-wrap gap-1">
                                    {s.moderator_ids.length === 0 && (
                                      <span className="text-[11px] text-[#F37346]">بلا مودريتور معينة</span>
                                    )}
                                    {s.moderator_ids.map((mId) => {
                                      const key = `${s.id}|${mId}`;
                                      const isOv = rosterCheck.overlapKeys.has(key);
                                      const isDayOff = rosterCheck.dayOffConflictKeys.has(key);
                                      return (
                                        <span
                                          key={mId}
                                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${
                                            isOv
                                              ? "border-destructive bg-destructive/15 text-destructive"
                                              : isDayOff
                                                ? "border-[#F37346] bg-[#F37346]/15 text-foreground"
                                                : "border-[#A4288A]/30 bg-[#A4288A]/10 text-[#662D8C]"
                                          }`}
                                          title={
                                            isOv
                                              ? "تداخل مع شيفت آخر"
                                              : isDayOff
                                                ? "تعارض مع الإجازة الأسبوعية"
                                                : undefined
                                          }
                                        >
                                          <span>{modName(mId)}</span>
                                          {isDayOff && !isOv && (
                                            <span className="text-[10px] text-[#F37346]">(إجازة)</span>
                                          )}
                                          {isOv && <span className="text-[10px]">(تداخل)</span>}
                                          {canEditShiftRoster && (
                                            <button
                                              type="button"
                                              aria-label={`إزالة ${modName(mId)}`}
                                              onClick={() => handleQuickRemoveModerator(s, mId)}
                                              className="rounded-full p-0.5 hover:bg-black/10"
                                            >
                                              <X className="h-3 w-3" />
                                            </button>
                                          )}
                                        </span>
                                      );
                                    })}
                                  </div>

                                  {canEditShiftRoster && availableToAdd.length > 0 && (
                                    <Select
                                      value={NONE}
                                      onValueChange={(v) => {
                                        if (v !== NONE) handleQuickAddModerator(s, v);
                                      }}
                                    >
                                      <SelectTrigger className="h-7 text-xs border-dashed">
                                        <span className="flex items-center gap-1 text-muted-foreground">
                                          <UserPlus className="h-3 w-3 text-[#A4288A]" />
                                          تعيين مودريتور
                                        </span>
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value={NONE}>اختاري مودريتور...</SelectItem>
                                        {availableToAdd.map((m) => {
                                          const hasOv =
                                            findModeratorOverlaps(
                                              {
                                                id: s.id,
                                                work_date: s.work_date,
                                                label: s.label,
                                                starts_at: s.starts_at,
                                                ends_at: s.ends_at,
                                                staff_count: s.staff_count,
                                                moderator_ids: [m.id],
                                              },
                                              shifts,
                                            ).length > 0;
                                          const isOff = daysOff[m.id] === dow;
                                          return (
                                            <SelectItem key={m.id} value={m.id} disabled={hasOv}>
                                              {m.display_name}
                                              {isOff ? " (إجازة)" : ""}
                                              {hasOv ? " — متداخلة" : ""}
                                            </SelectItem>
                                          );
                                        })}
                                      </SelectContent>
                                    </Select>
                                  )}
                                </div>
                              );
                            })}

                            {gaps.length > 0 && (
                              <div className="rounded-md bg-[#F37346]/10 border border-[#F37346]/30 px-2 py-1.5 text-[11px] text-foreground/90">
                                <span className="font-medium text-[#F37346]">فجوة: </span>
                                <span>
                                  {gaps.map((g) => `${formatClock12(g.start)} – ${formatClock12(g.end)}`).join("، ")}
                                </span>
                              </div>
                            )}
                          </div>

                          {canEditShiftRoster && (
                            <div className="p-2.5 pt-0">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full h-8 text-xs border-dashed border-[#A4288A]/40 text-[#A4288A] hover:bg-[#A4288A]/5"
                                onClick={() => openAddShift(d)}
                              >
                                <Plus className="h-3.5 w-3.5 ml-1" />
                                إضافة شيفت
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-[#662D8C]">الإجازة الأسبوعية</CardTitle>
                <CardDescription>
                  يوم إجازة أسبوعي لكل مودريتور، ويُستبعد تلقائياً عند التوليد مع تنبيه عند التعيين اليدوي فيه
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!loading && chatMods.some((m) => daysOff[m.id] == null) && (
                  <div
                    role="status"
                    className="flex items-start gap-2 rounded-md border border-[#F37346]/40 bg-[#F37346]/10 p-3 text-sm"
                  >
                    <Info className="h-4 w-4 mt-0.5 text-[#F37346] shrink-0" />
                    <span>
                      لم يُحدَّد يوم الإجازة بعد لـ:{" "}
                      {chatMods
                        .filter((m) => daysOff[m.id] == null)
                        .map((m) => m.display_name)
                        .join("، ")}
                      .
                      {canEditShiftRoster
                        ? " اختاري يوم الإجازة لكل مودريتور قبل «توليد الأسبوع»، وإلا ستُوزَّع على كل الأيام."
                        : " تحدده الإدارة من هذه الصفحة."}
                    </span>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {chatMods.map((m) => (
                    <div key={m.id} className="space-y-1">
                      <Label>{m.display_name}</Label>
                      <Select
                        disabled={!canEditShiftRoster}
                        value={daysOff[m.id] == null ? NONE : String(daysOff[m.id])}
                        onValueChange={(v) => saveDayOff(m.id, v === NONE ? null : Number(v))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>بدون إجازة ثابتة</SelectItem>
                          {[6, 0, 1, 2, 3, 4, 5].map((d) => (
                            <SelectItem key={d} value={String(d)}>
                              {AR_WEEKDAYS[d]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {canViewSettingsTab && (
            <TabsContent value="settings" className="space-y-6">
              <CmAccessGateCard />

              <Card>
                <CardHeader>
                  <CardTitle className="text-[#662D8C]">المراجعة المتبادلة</CardTitle>
                  <CardDescription>
                    تحدد مديرة المبيعات من تراجع أوردرات من. الأزواج المعلَّمة «افتراضي أولي» أُدخلت كبداية فقط ويمكن حذفها أو تغييرها، وكل تعديل يُسجَّل في سجل التدقيق.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {peers.length === 0 && (
                    <div className="text-sm text-muted-foreground">لا توجد مراجعات محددة حالياً.</div>
                  )}
                  {peers.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center gap-2 border rounded-md p-2">
                      <span className="font-medium">{modName(p.reviewer_moderator_id)}</span>
                      <span className="text-muted-foreground">تراجع</span>
                      <span className="font-medium">{modName(p.reviewee_moderator_id)}</span>
                      {p.source_policy && (
                        <Badge variant="outline" className="text-[#662D8C]">
                          افتراضي أولي
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">منذ {p.valid_from}</span>
                      {canEditGeneralSettings && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mr-auto"
                          aria-label="إلغاء المراجعة"
                          onClick={() => endPeer(p.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {canEditGeneralSettings && (
                    <div className="flex flex-wrap items-end gap-2 pt-2">
                      <div className="space-y-1">
                        <Label>المراجِعة</Label>
                        <Select value={newReviewer} onValueChange={setNewReviewer}>
                          <SelectTrigger className="w-40">
                            <SelectValue placeholder="اختر" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>اختر</SelectItem>
                            {chatMods.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.display_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>تراجع أوردرات</Label>
                        <Select value={newReviewee} onValueChange={setNewReviewee}>
                          <SelectTrigger className="w-40">
                            <SelectValue placeholder="اختر" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>اختر</SelectItem>
                            {moderators
                              .filter((m) => m.is_active && m.id !== newReviewer)
                              .map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.display_name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={addPeer}>
                        <Plus className="h-4 w-4 ml-1" />
                        إضافة
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-[#662D8C]">قوالب الشيفتات ونظام كل يوم</CardTitle>
                  <CardDescription>
                    التعديل مرن ويسري على الأسابيع التي تُولَّد بعده دون المساس بالأسابيع السابقة
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ShiftTemplatesPanel
                    canEdit={canEditShiftRoster}
                    shiftPatterns={shiftPatterns}
                    templates={templates}
                    weekdayPatterns={patterns}
                    onChangeTemplates={setTemplates}
                    onChangeWeekdayPatterns={(dow, key) => setPatterns((prev) => ({ ...prev, [dow]: key }))}
                    onReload={load}
                  />
                </CardContent>
              </Card>

              {dist && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-[#662D8C]">طريقة توزيع المحادثات</CardTitle>
                    <CardDescription>
                      المحادثة على خط مودريتور تبقى لصاحبة الخط؛ التوزيع للمحادثات غير المملوكة
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label>الطريقة الأساسية</Label>
                      <Select
                        disabled={!canEditGeneralSettings}
                        value={dist.method}
                        onValueChange={(v) => setDist({ ...dist, method: v as DistributionMethod })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(DISTRIBUTION_LABELS).map(([k, l]) => (
                            <SelectItem key={k} value={k}>
                              {l}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>البديل عند عدم المطابقة</Label>
                      <Select
                        disabled={!canEditGeneralSettings}
                        value={dist.fallback_method}
                        onValueChange={(v) => setDist({ ...dist, fallback_method: v as FallbackMethod })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(FALLBACK_LABELS).map(([k, l]) => (
                            <SelectItem key={k} value={k}>
                              {l}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>إزاحة الدور عند توليد الأسبوع</Label>
                      <Input
                        type="number"
                        disabled={!canEditGeneralSettings}
                        value={dist.rotation_offset}
                        onChange={(e) =>
                          setDist({ ...dist, rotation_offset: Number(e.target.value) || 0 })
                        }
                      />
                    </div>
                    {canEditGeneralSettings && (
                      <Button onClick={saveDist} className="sm:col-span-3 w-fit">
                        حفظ
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              {kpi && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-[#662D8C]">مؤشرات الرد</CardTitle>
                    <CardDescription>
                      الرسائل خارج نافذة الخدمة يبدأ عدّادها مع بداية النافذة
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-5">
                    <div>
                      <Label>بداية الخدمة</Label>
                      <TimeInput24
                        disabled={!canEditGeneralSettings}
                        value={hhmm(kpi.service_window_start)}
                        onChange={(v) => setKpi({ ...kpi, service_window_start: v })}
                      />
                    </div>
                    <div>
                      <Label>نهاية الخدمة</Label>
                      <TimeInput24
                        disabled={!canEditGeneralSettings}
                        value={hhmm(kpi.service_window_end)}
                        onChange={(v) => setKpi({ ...kpi, service_window_end: v })}
                      />
                    </div>
                    <div>
                      <Label>المحادثة المهملة (دقيقة)</Label>
                      <Input
                        type="number"
                        disabled={!canEditGeneralSettings}
                        value={kpi.abandoned_minutes}
                        onChange={(e) => setKpi({ ...kpi, abandoned_minutes: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <Label>أول رد داخل الشيفت (دقيقة)</Label>
                      <Input
                        type="number"
                        disabled={!canEditGeneralSettings}
                        value={kpi.first_reply_target_on_shift_min}
                        onChange={(e) =>
                          setKpi({ ...kpi, first_reply_target_on_shift_min: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <Label>أول رد خارج الشيفت (دقيقة)</Label>
                      <Input
                        type="number"
                        disabled={!canEditGeneralSettings}
                        value={kpi.first_reply_target_off_shift_min}
                        onChange={(e) =>
                          setKpi({ ...kpi, first_reply_target_off_shift_min: Number(e.target.value) })
                        }
                      />
                    </div>
                    {canEditGeneralSettings && (
                      <Button onClick={saveKpi} className="sm:col-span-5 w-fit">
                        حفظ
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>

      <ShiftEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={editInitial}
        moderators={chatMods}
        existingShifts={shifts}
        daysOff={daysOff}
        onSave={handleSaveShift}
      />

      <CopyShiftsDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        copyTarget={copyTarget}
        weekStart={weekStart}
        sourceShifts={weekShifts}
        onConfirmCopyDay={handleConfirmCopyDay}
        onConfirmCopyWeek={handleConfirmCopyWeek}
      />

      <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <DialogContent dir="rtl" className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="text-right">
            <DialogTitle className="text-[#662D8C]">قوالب الشيفتات للتوليد التلقائي</DialogTitle>
            <DialogDescription>
              أضيفي أو عدّلي الأنماط والشيفتات وأوقاتها وعدد المودريتورز المطلوب لكل شيفت، ثم اضغطي «توليد الأسبوع»
            </DialogDescription>
          </DialogHeader>
          <ShiftTemplatesPanel
            canEdit={canEditShiftRoster}
            shiftPatterns={shiftPatterns}
            templates={templates}
            weekdayPatterns={patterns}
            onChangeTemplates={setTemplates}
            onChangeWeekdayPatterns={(dow, key) => setPatterns((prev) => ({ ...prev, [dow]: key }))}
            onReload={load}
          />
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
