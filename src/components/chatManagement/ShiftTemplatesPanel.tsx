import { useState } from "react";
import { Moon, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimeInput24 } from "@/components/chatManagement/TimeInput24";
import {
  AR_WEEKDAYS,
  formatDurationAr,
  hhmm,
  isOvernightShift,
  isValidHHMM,
  shiftDurationMinutes,
  shiftLabelForIndex,
  type DayPattern,
  type ShiftPattern,
  type ShiftTemplate,
} from "@/lib/chatManagement/roster";

const db = supabase as any;

export interface TemplateRow extends ShiftTemplate {
  id: string;
}

interface ShiftTemplatesPanelProps {
  canEdit: boolean;
  shiftPatterns: ShiftPattern[];
  templates: TemplateRow[];
  weekdayPatterns: Record<number, DayPattern>;
  onChangeTemplates: (updater: (prev: TemplateRow[]) => TemplateRow[]) => void;
  onChangeWeekdayPatterns: (dow: number, key: string) => void;
  onReload: () => Promise<void> | void;
}

export function ShiftTemplatesPanel({
  canEdit,
  shiftPatterns,
  templates,
  weekdayPatterns,
  onChangeTemplates,
  onChangeWeekdayPatterns,
  onReload,
}: ShiftTemplatesPanelProps) {
  const [selectedPattern, setSelectedPattern] = useState<string>(
    shiftPatterns[0]?.key ?? "four_shift",
  );
  const [newPatternName, setNewPatternName] = useState("");
  const [editingPatternName, setEditingPatternName] = useState("");
  const [busy, setBusy] = useState(false);

  const activePatternKey = shiftPatterns.some((p) => p.key === selectedPattern)
    ? selectedPattern
    : (shiftPatterns[0]?.key ?? "four_shift");
  const activePatternObj = shiftPatterns.find((p) => p.key === activePatternKey);

  const patternTemplates = templates
    .filter((t) => t.day_pattern === activePatternKey)
    .sort((a, b) => a.slot_no - b.slot_no);

  const saveWeekdayPattern = async (dow: number, day_pattern: string) => {
    const { error } = await db
      .from("cm_weekday_patterns")
      .upsert({ dow, day_pattern }, { onConflict: "dow" });
    if (error) return toast.error(`تعذّر الحفظ: ${error.message}`);
    onChangeWeekdayPatterns(dow, day_pattern);
    toast.success("تم حفظ نظام اليوم");
  };

  const addPattern = async () => {
    const name = newPatternName.trim();
    if (!name) return toast.error("اكتبي اسم النمط الجديد");
    setBusy(true);
    try {
      const key = `pattern_${Date.now().toString(36)}`;
      const sort_order = (shiftPatterns.length ? Math.max(...shiftPatterns.map((p) => p.sort_order)) : 0) + 1;
      const { error } = await db.from("cm_shift_patterns").insert({ key, name, sort_order });
      if (error) throw error;
      setNewPatternName("");
      setSelectedPattern(key);
      toast.success("تمت إضافة النمط");
      await onReload();
    } catch (e: any) {
      toast.error(`تعذّر إضافة النمط: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const renamePattern = async () => {
    const name = editingPatternName.trim();
    if (!name || !activePatternObj) return;
    setBusy(true);
    try {
      const { error } = await db
        .from("cm_shift_patterns")
        .update({ name })
        .eq("key", activePatternObj.key);
      if (error) throw error;
      setEditingPatternName("");
      toast.success("تم تعديل اسم النمط");
      await onReload();
    } catch (e: any) {
      toast.error(`تعذّر التعديل: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const deletePattern = async (key: string) => {
    if (shiftPatterns.length <= 1) return toast.error("يجب الإبقاء على نمط واحد على الأقل");
    const usedByDay = Object.values(weekdayPatterns).some((v) => v === key);
    if (usedByDay) return toast.error("هذا النمط معيّن ليوم أو أكثر في الأسبوع؛ غيّري تعيين الأيام أولاً");
    setBusy(true);
    try {
      const { error } = await db.from("cm_shift_patterns").delete().eq("key", key);
      if (error) throw error;
      toast.success("تم حذف النمط");
      await onReload();
    } catch (e: any) {
      toast.error(`تعذّر الحذف: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const addTemplateSlot = async () => {
    const nextSlot = patternTemplates.length
      ? Math.max(...patternTemplates.map((t) => t.slot_no)) + 1
      : 1;
    const last = patternTemplates[patternTemplates.length - 1];
    const start = last ? hhmm(last.ends_at) : "09:00";
    const endHour = (Number(start.slice(0, 2)) + 4) % 24;
    const end = `${String(endHour).padStart(2, "0")}:${start.slice(3, 5)}`;
    const safeEnd = end === start ? "13:00" : end;

    setBusy(true);
    try {
      const { error } = await db.from("cm_shift_templates").insert({
        day_pattern: activePatternKey,
        slot_no: nextSlot,
        label: shiftLabelForIndex(nextSlot),
        starts_at: start,
        ends_at: safeEnd,
        staff_count: 1,
        is_active: true,
      });
      if (error) throw error;
      toast.success("تمت إضافة شيفت جديد للقالب");
      await onReload();
    } catch (e: any) {
      toast.error(`تعذّر الإضافة: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async (t: TemplateRow) => {
    const s = hhmm(t.starts_at);
    const e = hhmm(t.ends_at);
    if (!t.label.trim()) return toast.error("اسم الشيفت مطلوب");
    if (!isValidHHMM(s) || !isValidHHMM(e)) return toast.error("صيغة الوقت غير صحيحة");
    if (s === e) return toast.error("لا يمكن أن يتطابق وقت البداية والنهاية");
    const staffCount = Math.max(1, Math.min(20, Number(t.staff_count ?? 1) || 1));

    const { error } = await db
      .from("cm_shift_templates")
      .update({
        label: t.label.trim(),
        starts_at: s,
        ends_at: e,
        staff_count: staffCount,
        is_active: t.is_active !== false,
      })
      .eq("id", t.id);
    if (error) toast.error(`تعذّر الحفظ: ${error.message}`);
    else toast.success("تم حفظ شيفت القالب");
  };

  const deleteTemplate = async (id: string) => {
    setBusy(true);
    try {
      const { error } = await db.from("cm_shift_templates").delete().eq("id", id);
      if (error) throw error;
      toast.success("تم حذف الشيفت من القالب");
      await onReload();
    } catch (e: any) {
      toast.error(`تعذّر الحذف: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* تعيين النمط لكل يوم في الأسبوع */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-[#662D8C]">تعيين نظام كل يوم في الأسبوع</Label>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
          {[6, 0, 1, 2, 3, 4, 5].map((d) => (
            <div key={d} className="space-y-1">
              <Label className="text-xs">{AR_WEEKDAYS[d]}</Label>
              <Select
                disabled={!canEdit}
                value={weekdayPatterns[d] ?? activePatternKey}
                onValueChange={(v) => saveWeekdayPattern(d, v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {shiftPatterns.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>

      {/* اختيار النمط وإدارته */}
      <div className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {shiftPatterns.map((p) => {
              const cnt = templates.filter((t) => t.day_pattern === p.key && t.is_active !== false).length;
              const isSelected = p.key === activePatternKey;
              return (
                <Button
                  key={p.key}
                  type="button"
                  size="sm"
                  variant={isSelected ? "default" : "outline"}
                  className={isSelected ? "bg-[#662D8C] hover:bg-[#662D8C]/90 text-white" : ""}
                  onClick={() => {
                    setSelectedPattern(p.key);
                    setEditingPatternName("");
                  }}
                >
                  {p.name}
                  <Badge variant="secondary" className="mr-1.5 px-1.5 py-0 text-[10px]">
                    {cnt}
                  </Badge>
                </Button>
              );
            })}
          </div>

          {canEdit && (
            <div className="flex items-center gap-1.5">
              <Input
                value={newPatternName}
                onChange={(e) => setNewPatternName(e.target.value)}
                placeholder="اسم نمط جديد (مثل: الجمعة)"
                className="h-8 w-44 text-xs"
              />
              <Button type="button" size="sm" variant="outline" onClick={addPattern} disabled={busy}>
                <Plus className="h-3.5 w-3.5 ml-1" />
                نمط جديد
              </Button>
            </div>
          )}
        </div>

        {canEdit && activePatternObj && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2.5 text-xs">
            <span className="text-muted-foreground">تعديل اسم النمط:</span>
            <Input
              value={editingPatternName || activePatternObj.name}
              onChange={(e) => setEditingPatternName(e.target.value)}
              className="h-7 w-48 text-xs"
            />
            {editingPatternName.trim() && editingPatternName.trim() !== activePatternObj.name && (
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={renamePattern} disabled={busy}>
                حفظ الاسم
              </Button>
            )}
            {shiftPatterns.length > 1 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive mr-auto"
                onClick={() => deletePattern(activePatternObj.key)}
                disabled={busy}
              >
                <Trash2 className="h-3.5 w-3.5 ml-1" />
                حذف النمط
              </Button>
            )}
          </div>
        )}

        {/* شيفتات النمط المختار */}
        <div className="space-y-2">
          {patternTemplates.length === 0 && (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              لا توجد شيفتات في هذا النمط بعد. أضيفي شيفتاً للبدء.
            </div>
          )}

          {patternTemplates.map((t) => {
            const s = hhmm(t.starts_at);
            const e = hhmm(t.ends_at);
            const valid = isValidHHMM(s) && isValidHHMM(e) && s !== e;
            const overnight = valid && isOvernightShift(s, e);
            const dur = valid ? shiftDurationMinutes(s, e) : 0;

            return (
              <div
                key={t.id}
                className={`flex flex-wrap items-end gap-2 rounded-md border p-2.5 ${
                  t.is_active === false ? "opacity-60 bg-muted/30" : "bg-card"
                }`}
              >
                <div className="min-w-[120px] flex-1 space-y-1">
                  <Label className="text-xs">الاسم</Label>
                  <Input
                    disabled={!canEdit}
                    className="h-8 text-sm"
                    value={t.label}
                    onChange={(ev) =>
                      onChangeTemplates((prev) =>
                        prev.map((x) => (x.id === t.id ? { ...x, label: ev.target.value } : x)),
                      )
                    }
                  />
                </div>
                <div className="w-[88px] space-y-1">
                  <Label className="text-xs">من</Label>
                  <TimeInput24
                    disabled={!canEdit}
                    value={s}
                    onChange={(v) =>
                      onChangeTemplates((prev) =>
                        prev.map((x) => (x.id === t.id ? { ...x, starts_at: v } : x)),
                      )
                    }
                  />
                </div>
                <div className="w-[88px] space-y-1">
                  <Label className="text-xs">إلى</Label>
                  <TimeInput24
                    disabled={!canEdit}
                    value={e}
                    onChange={(v) =>
                      onChangeTemplates((prev) =>
                        prev.map((x) => (x.id === t.id ? { ...x, ends_at: v } : x)),
                      )
                    }
                  />
                </div>
                <div className="w-16 space-y-1">
                  <Label className="text-xs">العدد</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    dir="ltr"
                    disabled={!canEdit}
                    className="h-8 text-center font-mono"
                    value={t.staff_count ?? 1}
                    onChange={(ev) =>
                      onChangeTemplates((prev) =>
                        prev.map((x) =>
                          x.id === t.id ? { ...x, staff_count: Math.max(1, Number(ev.target.value) || 1) } : x,
                        ),
                      )
                    }
                  />
                </div>
                <div className="flex items-center gap-2 pb-1.5">
                  {valid && (
                    <Badge variant="outline" className="text-[11px] font-normal">
                      {formatDurationAr(dur)}
                    </Badge>
                  )}
                  {overnight && (
                    <Badge variant="outline" className="text-[11px] border-[#662D8C]/40 text-[#662D8C] gap-1">
                      <Moon className="h-3 w-3" />
                      ليلي
                    </Badge>
                  )}
                  <div className="flex items-center gap-1" title="تفعيل أو تعطيل في التوليد">
                    <Switch
                      disabled={!canEdit}
                      checked={t.is_active !== false}
                      onCheckedChange={(checked) =>
                        onChangeTemplates((prev) =>
                          prev.map((x) => (x.id === t.id ? { ...x, is_active: checked } : x)),
                        )
                      }
                    />
                  </div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" className="h-8" onClick={() => saveTemplate(t)} title="حفظ">
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-destructive hover:text-destructive"
                      onClick={() => deleteTemplate(t.id)}
                      disabled={busy}
                      title="حذف من القالب"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}

          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full border-dashed border-[#A4288A]/50 text-[#A4288A] hover:bg-[#A4288A]/5"
              onClick={addTemplateSlot}
              disabled={busy}
            >
              <Plus className="h-4 w-4 ml-1" />
              إضافة شيفت للقالب
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
