import { supabase } from "@/integrations/supabase/client";
import {
  type CopyShiftDraft,
  type DayShift,
  type GeneratedDay,
  findModeratorOverlaps,
  hhmm,
} from "@/lib/chatManagement/roster";

const db = supabase as any;

export async function ensureRosterDays(
  rows: { work_date: string; day_pattern?: string }[],
  generated = false,
) {
  if (!rows.length) return;
  const payload = rows.map((r) => ({
    work_date: r.work_date,
    day_pattern: r.day_pattern || "custom",
    ...(generated ? { generated_at: new Date().toISOString() } : {}),
  }));
  const { error } = await db.from("cm_roster_days").upsert(payload, { onConflict: "work_date" });
  if (error) throw error;
}

export async function saveDayShift(args: {
  shiftId?: string;
  work_date: string;
  sort_order: number;
  label: string;
  starts_at: string;
  ends_at: string;
  staff_count: number;
  moderator_ids: string[];
  currentModeratorIds?: string[];
}) {
  await ensureRosterDays([{ work_date: args.work_date }]);
  const startsAt = hhmm(args.starts_at);
  const endsAt = hhmm(args.ends_at);
  const label = args.label.trim();
  const staffCount = Math.max(1, Math.min(20, Number(args.staff_count) || 1));

  let shiftId = args.shiftId;
  if (shiftId) {
    const { error } = await db
      .from("cm_day_shifts")
      .update({
        work_date: args.work_date,
        sort_order: args.sort_order,
        label,
        starts_at: startsAt,
        ends_at: endsAt,
        staff_count: staffCount,
        source: "manual",
      })
      .eq("id", shiftId);
    if (error) throw error;
  } else {
    const { data, error } = await db
      .from("cm_day_shifts")
      .insert({
        work_date: args.work_date,
        sort_order: args.sort_order,
        label,
        starts_at: startsAt,
        ends_at: endsAt,
        staff_count: staffCount,
        source: "manual",
      })
      .select("id")
      .single();
    if (error) throw error;
    shiftId = data.id;
  }

  // تنظيف الصفوف الفارغة (legacy null) أو الموظفات المُزالة
  const prev = new Set(args.currentModeratorIds ?? []);
  const next = new Set(args.moderator_ids);
  const toRemove = [...prev].filter((id) => !next.has(id));
  const toAdd = [...next].filter((id) => !prev.has(id));

  await db.from("cm_shift_assignments").delete().eq("day_shift_id", shiftId).is("moderator_id", null);

  if (toRemove.length) {
    const { error } = await db
      .from("cm_shift_assignments")
      .delete()
      .eq("day_shift_id", shiftId)
      .in("moderator_id", toRemove);
    if (error) throw error;
  }

  if (toAdd.length) {
    const rows = toAdd.map((moderator_id) => ({
      day_shift_id: shiftId,
      work_date: args.work_date,
      slot_no: args.sort_order,
      label,
      starts_at: startsAt,
      ends_at: endsAt,
      moderator_id,
      source: "manual",
    }));
    const { error } = await db.from("cm_shift_assignments").insert(rows);
    if (error) throw error;
  }
}

export async function addModeratorToShift(shift: DayShift, moderatorId: string) {
  await db.from("cm_shift_assignments").delete().eq("day_shift_id", shift.id).is("moderator_id", null);
  const { error: uErr } = await db.from("cm_day_shifts").update({ source: "manual" }).eq("id", shift.id);
  if (uErr) throw uErr;
  const { error } = await db.from("cm_shift_assignments").insert({
    day_shift_id: shift.id,
    work_date: shift.work_date,
    slot_no: shift.sort_order,
    label: shift.label,
    starts_at: hhmm(shift.starts_at),
    ends_at: hhmm(shift.ends_at),
    moderator_id: moderatorId,
    source: "manual",
  });
  if (error) throw error;
}

export async function removeModeratorFromShift(shift: DayShift, moderatorId: string) {
  const { error: uErr } = await db.from("cm_day_shifts").update({ source: "manual" }).eq("id", shift.id);
  if (uErr) throw uErr;
  const { error } = await db
    .from("cm_shift_assignments")
    .delete()
    .eq("day_shift_id", shift.id)
    .eq("moderator_id", moderatorId);
  if (error) throw error;
}

export async function deleteDayShift(shiftId: string) {
  const { error } = await db.from("cm_day_shifts").delete().eq("id", shiftId);
  if (error) throw error;
}

export async function clearDayShifts(workDate: string) {
  const { error } = await db.from("cm_day_shifts").delete().eq("work_date", workDate);
  if (error) throw error;
}

export async function applyGeneratedDays(args: {
  days: GeneratedDay[];
  existingShifts: DayShift[];
  replaceManual?: boolean;
}) {
  const { days, existingShifts, replaceManual = false } = args;
  await ensureRosterDays(
    days.map((d) => ({ work_date: d.work_date, day_pattern: d.day_pattern })),
    true,
  );

  let preservedManualCount = 0;

  for (const day of days) {
    const existingForDay = existingShifts.filter((s) => s.work_date === day.work_date);
    const manualShifts = replaceManual ? [] : existingForDay.filter((s) => s.source !== "generated");
    preservedManualCount += manualShifts.length;

    // نحذف الشيفتات المولّدة سابقاً (أو كل الشيفتات إذا طُلب الاستبدال الكامل لليوم)
    if (replaceManual) {
      await db.from("cm_day_shifts").delete().eq("work_date", day.work_date);
    } else if (manualShifts.length === 0) {
      await db.from("cm_day_shifts").delete().eq("work_date", day.work_date).eq("source", "generated");
    } else {
      // يوم به تعديلات يدوية: نبقي التعديلات اليدوية ونستكمل من القالب فقط إذا لم يكن هناك شيفتات في نفس الترتيب
      await db.from("cm_day_shifts").delete().eq("work_date", day.work_date).eq("source", "generated");
    }

    const baseOrder = manualShifts.length ? Math.max(...manualShifts.map((s) => s.sort_order)) : 0;
    const activeManual = manualShifts;

    for (let i = 0; i < day.slots.length; i++) {
      const slot = day.slots[i];
      // إذا كان هناك شيفت يدوي بنفس الوقت تقريباً أو بنفس الترتيب ولم يُطلب استبدال، نتجنب تكرار نفس الشيفت
      if (!replaceManual && activeManual.some((m) => m.sort_order === slot.slot_no || (hhmm(m.starts_at) === slot.starts_at && hhmm(m.ends_at) === slot.ends_at))) {
        continue;
      }

      // تصفية المودريتورز المتداخلات مع الشيفتات اليدوية المحفوظة
      const nonOverlappingMods = slot.moderator_ids.filter((modId) => {
        const overlaps = findModeratorOverlaps(
          {
            work_date: day.work_date,
            label: slot.label,
            starts_at: slot.starts_at,
            ends_at: slot.ends_at,
            staff_count: slot.staff_count,
            moderator_ids: [modId],
          },
          activeManual,
        );
        return overlaps.length === 0;
      });

      const sortOrder = manualShifts.length ? baseOrder + i + 1 : slot.slot_no;
      const { data: insertedShift, error: sErr } = await db
        .from("cm_day_shifts")
        .insert({
          work_date: day.work_date,
          sort_order: sortOrder,
          label: slot.label,
          starts_at: slot.starts_at,
          ends_at: slot.ends_at,
          staff_count: slot.staff_count,
          source: "generated",
        })
        .select("id")
        .single();
      if (sErr) throw sErr;

      if (nonOverlappingMods.length) {
        const assignRows = nonOverlappingMods.map((moderator_id) => ({
          day_shift_id: insertedShift.id,
          work_date: day.work_date,
          slot_no: sortOrder,
          label: slot.label,
          starts_at: slot.starts_at,
          ends_at: slot.ends_at,
          moderator_id,
          source: "generated",
        }));
        const { error: aErr } = await db.from("cm_shift_assignments").insert(assignRows);
        if (aErr) throw aErr;
      }
    }
  }

  return { preservedManualCount };
}

export async function applyCopiedShifts(args: {
  drafts: CopyShiftDraft[];
  targetDates: string[];
  mode: "replace" | "append";
  existingTargetShifts: DayShift[];
}) {
  const { drafts, targetDates, mode, existingTargetShifts } = args;
  const uniqueDates = [...new Set(targetDates)];
  if (!uniqueDates.length) return { created: 0, skippedOverlaps: 0 };

  await ensureRosterDays(uniqueDates.map((work_date) => ({ work_date, day_pattern: "custom" })));

  if (mode === "replace") {
    const { error } = await db.from("cm_day_shifts").delete().in("work_date", uniqueDates);
    if (error) throw error;
  }

  const runningShifts: DayShift[] = mode === "replace"
    ? existingTargetShifts.filter((s) => !uniqueDates.includes(s.work_date))
    : [...existingTargetShifts];

  let created = 0;
  let skippedOverlaps = 0;

  for (const d of drafts) {
    const existingOnDate = runningShifts.filter((s) => s.work_date === d.work_date);
    const nextOrder = existingOnDate.length ? Math.max(...existingOnDate.map((s) => s.sort_order)) + 1 : d.sort_order;

    const validMods: string[] = [];
    for (const modId of d.moderator_ids) {
      const ov = findModeratorOverlaps(
        {
          work_date: d.work_date,
          label: d.label,
          starts_at: d.starts_at,
          ends_at: d.ends_at,
          staff_count: d.staff_count,
          moderator_ids: [modId],
        },
        runningShifts,
      );
      if (ov.length > 0) skippedOverlaps++;
      else validMods.push(modId);
    }

    const { data: inserted, error: sErr } = await db
      .from("cm_day_shifts")
      .insert({
        work_date: d.work_date,
        sort_order: nextOrder,
        label: d.label,
        starts_at: d.starts_at,
        ends_at: d.ends_at,
        staff_count: d.staff_count,
        source: "manual",
      })
      .select("id")
      .single();
    if (sErr) throw sErr;

    if (validMods.length) {
      const { error: aErr } = await db.from("cm_shift_assignments").insert(
        validMods.map((moderator_id) => ({
          day_shift_id: inserted.id,
          work_date: d.work_date,
          slot_no: nextOrder,
          label: d.label,
          starts_at: d.starts_at,
          ends_at: d.ends_at,
          moderator_id,
          source: "manual",
        })),
      );
      if (aErr) throw aErr;
    }

    runningShifts.push({
      id: inserted.id,
      work_date: d.work_date,
      sort_order: nextOrder,
      label: d.label,
      starts_at: d.starts_at,
      ends_at: d.ends_at,
      staff_count: d.staff_count,
      source: "manual",
      moderator_ids: validMods,
    });
    created++;
  }

  return { created, skippedOverlaps };
}
