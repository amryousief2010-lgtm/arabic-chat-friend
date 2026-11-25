import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Moon, ShieldAlert, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { TimeInput24 } from "@/components/chatManagement/TimeInput24";
import { formatClock12 } from "@/lib/chatManagement/timeFormat";
import {
  AR_WEEKDAYS,
  dowOf,
  formatDurationAr,
  hhmm,
  isOvernightShift,
  isValidHHMM,
  shiftDurationMinutes,
  validateShiftDraft,
  type DayShift,
  type RosterModerator,
} from "@/lib/chatManagement/roster";

export interface ShiftEditFormValues {
  shiftId?: string;
  work_date: string;
  sort_order: number;
  label: string;
  starts_at: string;
  ends_at: string;
  staff_count: number;
  moderator_ids: string[];
  currentModeratorIds?: string[];
}

interface ShiftEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ShiftEditFormValues | null;
  moderators: RosterModerator[];
  existingShifts: DayShift[];
  daysOff: Record<string, number | null | undefined>;
  onSave: (values: ShiftEditFormValues) => Promise<void>;
}

export function ShiftEditDialog({
  open,
  onOpenChange,
  initial,
  moderators,
  existingShifts,
  daysOff,
  onSave,
}: ShiftEditDialogProps) {
  const [label, setLabel] = useState("");
  const [startsAt, setStartsAt] = useState("09:00");
  const [endsAt, setEndsAt] = useState("13:00");
  const [staffCount, setStaffCount] = useState(1);
  const [selectedMods, setSelectedMods] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initial) return;
    setLabel(initial.label);
    setStartsAt(hhmm(initial.starts_at) || "09:00");
    setEndsAt(hhmm(initial.ends_at) || "13:00");
    setStaffCount(Math.max(1, initial.staff_count || 1));
    setSelectedMods(initial.moderator_ids ?? []);
  }, [initial]);

  const workDate = initial?.work_date ?? "";
  const dow = workDate ? dowOf(workDate) : 0;

  const validation = useMemo(() => {
    if (!workDate) {
      return {
        errors: [] as string[],
        warnings: [] as string[],
        overlappingModeratorIds: new Set<string>(),
        dayOffModeratorIds: new Set<string>(),
      };
    }
    return validateShiftDraft(
      {
        id: initial?.shiftId,
        work_date: workDate,
        label,
        starts_at: startsAt,
        ends_at: endsAt,
        staff_count: staffCount,
        moderator_ids: selectedMods,
      },
      existingShifts,
      moderators,
      daysOff,
    );
  }, [workDate, initial?.shiftId, label, startsAt, endsAt, staffCount, selectedMods, existingShifts, moderators, daysOff]);

  // فحص استباقي لكل مودريتور عند اختيارها لعرض حالة التداخل قبل الضغط
  const modPreviewIssues = useMemo(() => {
    const map = new Map<string, { overlap: boolean; dayOff: boolean }>();
    if (!workDate) return map;
    for (const m of moderators) {
      const check = validateShiftDraft(
        {
          id: initial?.shiftId,
          work_date: workDate,
          label: label || "شيفت",
          starts_at: startsAt,
          ends_at: endsAt,
          staff_count: 1,
          moderator_ids: [m.id],
        },
        existingShifts,
        moderators,
        daysOff,
      );
      map.set(m.id, {
        overlap: check.overlappingModeratorIds.has(m.id),
        dayOff: daysOff[m.id] === dow,
      });
    }
    return map;
  }, [workDate, initial?.shiftId, label, startsAt, endsAt, moderators, existingShifts, daysOff, dow]);

  const validTimes = isValidHHMM(startsAt) && isValidHHMM(endsAt) && startsAt !== endsAt;
  const overnight = validTimes && isOvernightShift(startsAt, endsAt);
  const durationMin = validTimes ? shiftDurationMinutes(startsAt, endsAt) : 0;

  const toggleMod = (id: string) => {
    setSelectedMods((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSubmit = async () => {
    if (!initial || validation.errors.length > 0) return;
    setSaving(true);
    try {
      await onSave({
        ...initial,
        label: label.trim(),
        starts_at: startsAt,
        ends_at: endsAt,
        staff_count: Math.max(1, staffCount),
        moderator_ids: selectedMods,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader className="text-right">
          <DialogTitle className="text-[#662D8C]">
            {initial?.shiftId ? "تعديل الشيفت" : "إضافة شيفت جديد"}
          </DialogTitle>
          <DialogDescription>
            {workDate ? `${AR_WEEKDAYS[dow]} — ${workDate}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="shift-label">اسم الشيفت</Label>
              <Input
                id="shift-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="مثال: الشيفت الصباحي"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shift-staff-count">العدد المطلوب</Label>
              <Input
                id="shift-staff-count"
                type="number"
                min={1}
                max={20}
                dir="ltr"
                className="text-center font-mono"
                value={staffCount}
                onChange={(e) => setStaffCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>من (نظام 24 ساعة)</Label>
              <TimeInput24 aria-label="وقت بداية الشيفت" value={startsAt} onChange={setStartsAt} />
              <div className="text-xs text-muted-foreground text-center" dir="ltr">
                {isValidHHMM(startsAt) ? formatClock12(startsAt) : "—"}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>إلى (نظام 24 ساعة)</Label>
              <TimeInput24 aria-label="وقت نهاية الشيفت" value={endsAt} onChange={setEndsAt} />
              <div className="text-xs text-muted-foreground text-center" dir="ltr">
                {isValidHHMM(endsAt) ? formatClock12(endsAt) : "—"}
              </div>
            </div>
          </div>

          {validTimes && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="border-[#662D8C]/40 text-[#662D8C]">
                المدة: {formatDurationAr(durationMin)}
              </Badge>
              {overnight && (
                <Badge className="bg-[#662D8C]/10 text-[#662D8C] hover:bg-[#662D8C]/15 border border-[#662D8C]/30 gap-1">
                  <Moon className="h-3 w-3" />
                  يمتد بعد منتصف الليل لليوم التالي
                </Badge>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-[#A4288A]" />
                المودريتورز المعينات ({selectedMods.length} / {staffCount})
              </Label>
              {selectedMods.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground"
                  onClick={() => setSelectedMods([])}
                >
                  إلغاء الكل
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {moderators.map((m) => {
                const active = selectedMods.includes(m.id);
                const info = modPreviewIssues.get(m.id);
                const hasOverlap = info?.overlap ?? false;
                const isDayOff = info?.dayOff ?? false;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMod(m.id)}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm text-right transition-colors ${
                      active
                        ? hasOverlap
                          ? "border-destructive bg-destructive/10 text-destructive"
                          : "border-[#A4288A] bg-[#A4288A]/10 text-[#662D8C] font-medium"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          active
                            ? hasOverlap
                              ? "border-destructive bg-destructive text-white"
                              : "border-[#A4288A] bg-[#A4288A] text-white"
                            : "border-muted-foreground/40"
                        }`}
                      >
                        {active && <Check className="h-3 w-3" />}
                      </span>
                      <span className="truncate">{m.display_name}</span>
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      {isDayOff && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 border-[#F37346] text-[#F37346]">
                          إجازة
                        </Badge>
                      )}
                      {hasOverlap && (
                        <Badge variant="destructive" className="text-[10px] px-1 py-0">
                          تداخل
                        </Badge>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {validation.errors.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive space-y-1">
              {validation.errors.map((err, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{err}</span>
                </div>
              ))}
            </div>
          )}

          {validation.warnings.length > 0 && (
            <div className="rounded-md border border-[#F37346]/50 bg-[#F37346]/10 p-3 text-xs text-foreground space-y-1">
              {validation.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[#F37346]" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={saving || validation.errors.length > 0}
            className="bg-[#A4288A] hover:bg-[#662D8C] text-white"
          >
            {saving ? "جارٍ الحفظ..." : initial?.shiftId ? "حفظ التعديلات" : "إضافة الشيفت"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
