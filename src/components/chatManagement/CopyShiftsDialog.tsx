import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AR_WEEKDAYS,
  addDays,
  dowOf,
  weekDates,
  weekStartSaturday,
  type DayShift,
} from "@/lib/chatManagement/roster";

export type CopyMode =
  | { kind: "day"; sourceDate: string }
  | { kind: "week"; sourceWeekStart: string };

interface CopyShiftsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copyTarget: CopyMode | null;
  weekStart: string;
  sourceShifts: DayShift[];
  onConfirmCopyDay: (args: {
    sourceDate: string;
    targetDates: string[];
    includeModerators: boolean;
    mode: "replace" | "append";
  }) => Promise<void>;
  onConfirmCopyWeek: (args: {
    sourceWeekStart: string;
    targetWeekStart: string;
    includeModerators: boolean;
    mode: "replace" | "append";
  }) => Promise<void>;
}

export function CopyShiftsDialog({
  open,
  onOpenChange,
  copyTarget,
  weekStart,
  sourceShifts,
  onConfirmCopyDay,
  onConfirmCopyWeek,
}: CopyShiftsDialogProps) {
  const dates = weekDates(weekStart);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [customDate, setCustomDate] = useState("");
  const [targetWeekStart, setTargetWeekStart] = useState("");
  const [includeModerators, setIncludeModerators] = useState(true);
  const [writeMode, setWriteMode] = useState<"replace" | "append">("replace");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!copyTarget) return;
    if (copyTarget.kind === "day") {
      setSelectedDates([]);
      setCustomDate("");
    } else {
      setTargetWeekStart(addDays(copyTarget.sourceWeekStart, 7));
    }
    setIncludeModerators(true);
    setWriteMode("replace");
  }, [copyTarget]);

  if (!copyTarget) return null;

  const dayShiftCount =
    copyTarget.kind === "day"
      ? sourceShifts.filter((s) => s.work_date === copyTarget.sourceDate).length
      : sourceShifts.filter((s) => weekDates(copyTarget.sourceWeekStart).includes(s.work_date)).length;

  const toggleDate = (d: string) => {
    setSelectedDates((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const effectiveTargetDates = [
    ...new Set([
      ...selectedDates,
      ...(customDate && customDate !== (copyTarget.kind === "day" ? copyTarget.sourceDate : "") ? [customDate] : []),
    ]),
  ];

  const handleConfirm = async () => {
    setSaving(true);
    try {
      if (copyTarget.kind === "day") {
        if (!effectiveTargetDates.length) return;
        await onConfirmCopyDay({
          sourceDate: copyTarget.sourceDate,
          targetDates: effectiveTargetDates,
          includeModerators,
          mode: writeMode,
        });
      } else {
        const normalizedStart = weekStartSaturday(targetWeekStart);
        await onConfirmCopyWeek({
          sourceWeekStart: copyTarget.sourceWeekStart,
          targetWeekStart: normalizedStart,
          includeModerators,
          mode: writeMode,
        });
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right">
          <DialogTitle className="text-[#662D8C] flex items-center gap-2">
            <Copy className="h-4 w-4 text-[#A4288A]" />
            {copyTarget.kind === "day" ? "نسخ شيفتات اليوم" : "نسخ جدول الأسبوع"}
          </DialogTitle>
          <DialogDescription>
            {copyTarget.kind === "day"
              ? `المصدر: ${AR_WEEKDAYS[dowOf(copyTarget.sourceDate)]} ${copyTarget.sourceDate} (${dayShiftCount} شيفت)`
              : `المصدر: من ${copyTarget.sourceWeekStart} إلى ${addDays(copyTarget.sourceWeekStart, 6)} (${dayShiftCount} شيفت)`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {copyTarget.kind === "day" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>اختاري الأيام المستهدفة</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-[#A4288A]"
                  onClick={() => setSelectedDates(dates.filter((d) => d !== copyTarget.sourceDate))}
                >
                  باقي الأسبوع
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {dates
                  .filter((d) => d !== copyTarget.sourceDate)
                  .map((d) => {
                    const active = selectedDates.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDate(d)}
                        className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                          active
                            ? "border-[#A4288A] bg-[#A4288A]/10 text-[#662D8C] font-medium"
                            : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <span>{AR_WEEKDAYS[dowOf(d)]}</span>
                        <span className="text-muted-foreground font-mono" dir="ltr">{d.slice(5)}</span>
                        {active && <Check className="h-3.5 w-3.5 text-[#A4288A]" />}
                      </button>
                    );
                  })}
              </div>
              <div className="space-y-1 pt-1">
                <Label htmlFor="custom-copy-date" className="text-xs text-muted-foreground">
                  أو تاريخ محدد آخر
                </Label>
                <Input
                  id="custom-copy-date"
                  type="date"
                  dir="ltr"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="target-week-date">الأسبوع الهدف (يُضبط تلقائياً لبداية السبت)</Label>
              <div className="flex gap-2">
                <Input
                  id="target-week-date"
                  type="date"
                  dir="ltr"
                  value={targetWeekStart}
                  onChange={(e) => setTargetWeekStart(weekStartSaturday(e.target.value || copyTarget.sourceWeekStart))}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTargetWeekStart(addDays(copyTarget.sourceWeekStart, 7))}
                >
                  الأسبوع التالي
                </Button>
              </div>
              {targetWeekStart && (
                <p className="text-xs text-muted-foreground">
                  سيتم النسخ إلى الأسبوع: {weekStartSaturday(targetWeekStart)} ← {addDays(weekStartSaturday(targetWeekStart), 6)}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>ماذا يُنسخ؟</Label>
            <RadioGroup
              value={includeModerators ? "with_mods" : "times_only"}
              onValueChange={(v) => setIncludeModerators(v === "with_mods")}
              className="grid grid-cols-1 gap-2"
            >
              <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm cursor-pointer">
                <RadioGroupItem value="with_mods" />
                <span>الشيفتات والأوقات مع المودريتورز المعينات</span>
              </label>
              <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm cursor-pointer">
                <RadioGroupItem value="times_only" />
                <span>الأوقات وأسماء الشيفتات فقط (بدون تعيينات)</span>
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label>عند وجود شيفتات في الأيام المستهدفة</Label>
            <RadioGroup
              value={writeMode}
              onValueChange={(v) => setWriteMode(v as "replace" | "append")}
              className="grid grid-cols-2 gap-2"
            >
              <label className="flex items-center gap-2 rounded-md border p-2 text-xs cursor-pointer">
                <RadioGroupItem value="replace" />
                <span>استبدالها بالكامل</span>
              </label>
              <label className="flex items-center gap-2 rounded-md border p-2 text-xs cursor-pointer">
                <RadioGroupItem value="append" />
                <span>إضافة عليها</span>
              </label>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={
              saving ||
              dayShiftCount === 0 ||
              (copyTarget.kind === "day" && effectiveTargetDates.length === 0) ||
              (copyTarget.kind === "week" && (!targetWeekStart || weekStartSaturday(targetWeekStart) === copyTarget.sourceWeekStart))
            }
            className="bg-[#A4288A] hover:bg-[#662D8C] text-white"
          >
            {saving ? "جارٍ النسخ..." : "تنفيذ النسخ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
