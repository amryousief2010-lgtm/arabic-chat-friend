// Classifies the response of the `check_duplicate_order_attempt` RPC.
//
// Priority (matches the SQL):
//   1. double_submit  — same customer record + same items by the same user < 2 min → block.
//   2. needs_approval — another moderator has an order for this phone this month → Alaa approval (unchanged).
//   3. own_repeat     — the SAME moderator already has an order for this phone this month / last 24h
//                       → confirm dialog; she must accept before the order is saved (no approval, no block).
//   4. clear.

export type DuplicateCheckOutcome = "double_submit" | "needs_approval" | "own_repeat" | "clear";

export interface OwnRepeatCandidate {
  matched_order_id: string;
  order_number: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  moderator_name?: string | null;
  created_at: string;
  status?: string | null;
  products_summary?: string | null;
  matched_on_phone?: boolean;
}

export interface DuplicateCheckPayload {
  is_duplicate?: boolean;
  is_double_submit?: boolean;
  is_own_repeat?: boolean;
  attempt_id?: string | null;
  own_candidates?: OwnRepeatCandidate[] | null;
}

export function classifyDuplicateCheck(
  payload: DuplicateCheckPayload | null | undefined,
  opts: { ownRepeatConfirmed?: boolean } = {},
): DuplicateCheckOutcome {
  if (!payload) return "clear";
  if (payload.is_double_submit) return "double_submit";
  if (payload.is_duplicate) return "needs_approval";
  if (payload.is_own_repeat && !opts.ownRepeatConfirmed && (payload.own_candidates?.length ?? 0) > 0) {
    return "own_repeat";
  }
  return "clear";
}

export const OWN_REPEAT_TITLE = "تنبيه: فيه أوردر سابق ليكِ لنفس العميل";

export function ownRepeatDescription(count: number): string {
  const n = Math.max(1, count);
  return n === 1
    ? "إنتِ سجلتِ أوردر لنفس رقم الموبايل خلال الشهر ده (أو آخر 24 ساعة). اتأكدي إن ده أوردر جديد فعلاً ومش تكرار قبل ما تكملي."
    : `إنتِ سجلتِ ${n} أوردرات لنفس رقم الموبايل خلال الشهر ده (أو آخر 24 ساعة). اتأكدي إن ده أوردر جديد فعلاً ومش تكرار قبل ما تكملي.`;
}

export const OWN_REPEAT_CONFIRM_LABEL = "أيوه، أوردر جديد — سجّليه";
export const OWN_REPEAT_CANCEL_LABEL = "إلغاء";
