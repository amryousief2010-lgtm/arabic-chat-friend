export type StageKey =
  | "awaiting_entry" | "in_machine" | "awaiting_candle1" | "after_candle1"
  | "awaiting_candle2" | "after_candle2" | "in_hatcher" | "completed" | "overdue";

export const HATCH_BATCHES_LAB_QUERY_KEY = ["hatch_batches_lab"] as const;

export const HATCH_BATCHES_LAB_SELECT =
  "id, batch_number, operational_batch_no, receive_date, entry_date, machine, received_eggs, net_eggs, excluded_eggs, excluded_reason, hatched_chicks, hatcher_dead, candle1_date, candle1_fertile, candle1_infertile, candle2_date, candle2_fertile, candle2_dead, exit_date, status, customer_id, notes, created_at, is_test, hatch_customers(id,name,customer_type)";

export const CLOSED_HATCH_BATCH_STATUSES = new Set([
  "completed",
  "closed",
  "delivered",
  "received_by_customer",
  "finished",
  "settled",
  "cancelled",
  "exited",
  "done",
]);

export const STAGE_META: Record<StageKey, { label: string; color: string }> = {
  awaiting_entry:   { label: "بانتظار الدخول",  color: "bg-slate-500" },
  in_machine:       { label: "داخل الماكينة",    color: "bg-blue-500" },
  awaiting_candle1: { label: "بانتظار الكشف الأول", color: "bg-yellow-500" },
  after_candle1:    { label: "بعد الكشف الأول",  color: "bg-cyan-600" },
  awaiting_candle2: { label: "بانتظار الكشف الثاني", color: "bg-yellow-600" },
  after_candle2:    { label: "بعد الكشف الثاني",  color: "bg-indigo-500" },
  in_hatcher:       { label: "في الهاتشر",       color: "bg-purple-500" },
  completed:        { label: "مكتملة / خرجت",    color: "bg-emerald-600" },
  overdue:          { label: "متأخرة عن الإجراء", color: "bg-red-600" },
};

export const addDays = (d: string | Date, n: number) => {
  const dt = typeof d === "string" ? new Date(d) : new Date(d.getTime());
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
};

export const daysDiff = (a?: string | null, b?: string | null) => {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86400000);
};

export function hasFinalHatchResults(b: any): boolean {
  return (
    (b.hatched_chicks || 0) > 0 ||
    (b.candle1_fertile || 0) > 0 ||
    (b.candle1_infertile || 0) > 0 ||
    (b.candle2_fertile || 0) > 0 ||
    (b.candle2_dead || 0) > 0 ||
    (b.hatcher_dead || 0) > 0
  );
}

export function isOperationalHatchBatch(b: any): boolean {
  return b?.is_test !== true && Boolean(b?.customer_id || b?.entry_date || b?.machine);
}

export function getHatchOperationalBatchKey(b: any): string {
  return b?.operational_batch_no != null || b?.op_seq != null
    ? `OP__${(b?.machine || "—").trim()}__${b.operational_batch_no ?? b.op_seq}`
    : `DATE__${b?.entry_date || "—"}__${(b?.machine || "—").trim()}`;
}

export function isClosedOrExcludedFromOverdue(b: any): boolean {
  const status = b?.status ? String(b.status).toLowerCase() : "";
  return (
    b?.is_test === true ||
    Boolean(b?.exit_date) ||
    CLOSED_HATCH_BATCH_STATUSES.has(status) ||
    hasFinalHatchResults(b)
  );
}

export function computeStage(
  b: any,
  settings: any,
): { stage: StageKey; expCandle1?: string; expCandle2?: string; expExit?: string; daysIn: number | null; overdueReason?: string; isSoon?: boolean } {
  const candleDay = settings?.candling_day || 15;
  const hatcherDay = settings?.transfer_to_hatcher_day || 39;
  const candle2Default = Math.max(candleDay + 10, 25);
  const todayStr = new Date().toISOString().slice(0, 10);

  const entry = b.entry_date || b.receive_date || null;
  const expCandle1 = entry ? addDays(entry, candleDay) : undefined;
  const expCandle2 = entry ? addDays(entry, candle2Default) : undefined;
  const expExit = entry ? addDays(entry, hatcherDay) : undefined;
  const daysIn = entry ? daysDiff(entry, todayStr) : null;

  if (isClosedOrExcludedFromOverdue(b)) {
    return { stage: "completed", expCandle1, expCandle2, expExit, daysIn };
  }
  if (b.status === "in_hatcher") {
    return { stage: "in_hatcher", expCandle1, expCandle2, expExit, daysIn };
  }
  if (!entry) return { stage: "awaiting_entry", daysIn: null };

  const isAfter = (dueDate?: string) => Boolean(dueDate && todayStr > dueDate);
  const within = (dueDate?: string, days = 3) => {
    if (!dueDate) return false;
    const d = daysDiff(todayStr, dueDate);
    return d !== null && d >= 0 && d <= days;
  };

  if (b.candle2_date) {
    if (isAfter(expExit)) return { stage: "overdue", expCandle1, expCandle2, expExit, daysIn, overdueReason: "تجاوز موعد الخروج" };
    if (daysIn !== null && daysIn >= hatcherDay - 1) {
      return { stage: "in_hatcher", expCandle1, expCandle2, expExit, daysIn, isSoon: within(expExit) };
    }
    return { stage: "after_candle2", expCandle1, expCandle2, expExit, daysIn, isSoon: within(expExit) };
  }
  if (b.candle1_date) {
    if (isAfter(expCandle2)) return { stage: "overdue", expCandle1, expCandle2, expExit, daysIn, overdueReason: "تجاوز موعد الكشف الثاني" };
    return { stage: "awaiting_candle2", expCandle1, expCandle2, expExit, daysIn, isSoon: within(expCandle2) };
  }
  if (isAfter(expCandle1)) {
    return { stage: "overdue", expCandle1, expCandle2, expExit, daysIn, overdueReason: "تجاوز موعد الكشف الأول" };
  }
  if (daysIn !== null && daysIn >= 1) {
    return { stage: "awaiting_candle1", expCandle1, expCandle2, expExit, daysIn, isSoon: within(expCandle1) };
  }
  return { stage: "in_machine", expCandle1, expCandle2, expExit, daysIn };
}

export function isBatchActuallyOverdue(b: any, settings: any): boolean {
  return isOperationalHatchBatch(b) && computeStage(b, settings).stage === "overdue";
}