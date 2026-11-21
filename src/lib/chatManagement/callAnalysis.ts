/** تفريغ وتحليل المكالمات (cm_call_analysis + الدالة cm-analyze-call). */
export interface CallAnalysisRow { call_id: string; status: "pending" | "done" | "error"; outcome: string | null; handling_score: number | null;
  followup_needed: boolean | null; order_placed_or_promised: boolean | null; summary_ar: string | null; error: string | null; analyzed_at: string | null }
export interface TranscriptSegment { speaker: string; start: number; end: number; text: string }
export interface CallAnalysisDetail extends CallAnalysisRow { asr_model: string | null; analysis_model: string | null; transcript_text: string | null;
  transcript_segments: TranscriptSegment[] | null; speaker_roles: Record<string, string> | null; audio_seconds: number | null; caller_intent: string | null;
  is_sales_inquiry: boolean | null; objections: string[]; handling_notes: string | null; followup_reason: string | null; cost_estimate: number | null }

export const OUTCOME_AR: Record<string, string> = {
  order_placed: "تم الطلب", order_promised: "وعد بالطلب", inquiry_only: "استفسار فقط", not_interested: "غير مهتم",
  complaint: "شكوى", followup: "يحتاج متابعة", other: "أخرى",
};
export const ANALYSIS_STATUS_AR: Record<string, string> = { pending: "جارٍ التحليل", done: "تم التحليل", error: "فشل التحليل" };
const ROLE_AR: Record<string, string> = { moderator: "المودريتور", customer: "العميل", other: "طرف آخر" };

/** اسم المتحدث بالعربية حسب ما استنتجه التحليل؛ وإلا «متحدث ١/٢». */
export function speakerLabel(speaker: string, roles: Record<string, string> | null | undefined): string {
  const r = roles?.[speaker];
  if (r && ROLE_AR[r]) return ROLE_AR[r];
  const n = Number(speaker.replace(/\D/g, ""));
  return `متحدث ${Number.isFinite(n) ? n + 1 : speaker}`;
}
/** ثوانٍ ← «د:ث» */
export function fmtSec(s: number): string {
  const t = Math.max(0, Math.floor(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
