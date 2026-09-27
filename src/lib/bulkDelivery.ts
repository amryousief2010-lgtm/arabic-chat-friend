export const BULK_DELIVERY_CAP = 20;

export function bulkDeliveryPlan(count: number, batchLocal: string):
  | { ok: true; deliveredAt?: string }
  | { ok: false; message: string } {
  if (count > BULK_DELIVERY_CAP) {
    return { ok: false, message: `الحد الأقصى لتسليم دفعة واحدة هو ${BULK_DELIVERY_CAP} طلباً` };
  }
  if (count > 1) {
    if (!batchLocal) return { ok: false, message: "حدد تاريخ ووقت التسليم لهذه الدفعة" };
    const parsed = new Date(batchLocal);
    if (Number.isNaN(parsed.getTime())) return { ok: false, message: "تاريخ التسليم غير صالح" };
    return { ok: true, deliveredAt: parsed.toISOString() };
  }
  return { ok: true };
}
