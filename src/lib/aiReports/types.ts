export type Severity = "danger" | "warning" | "info";

export interface AlertRow {
  id: string; rule_code: string; rule_name: string; category: "ads" | "moderators"; severity: Severity;
  title: string; body: string | null; ai_note: string | null; status: "open" | "seen" | "snoozed" | "resolved";
  shadow: boolean; moderator_name: string | null; campaign_name: string | null; kpi_date: string | null;
  suggested_action: string | null; action_status: "requested" | "approved" | "rejected" | null;
  created_at: string; updated_at: string; data: Record<string, unknown>;
}

export interface ActionRow {
  id: string; alert_id: string; alert_title: string; action_text: string; note: string | null;
  status: "requested" | "approved" | "rejected"; requested_at: string; decided_at: string | null;
}

export interface RuleRow {
  code: string; category: "ads" | "moderators"; name_ar: string; severity: Severity; params: Record<string, number>;
  audience: string[]; suggested_action: string | null; cadence: string; enabled: boolean; shadow: boolean; notes: string | null;
}

export interface ModeratorEvalRow {
  moderator_id: string; display_name: string; analysed_calls: number; avg_score: number | null;
  score_dist: Record<string, number>; sales_inquiries: number; orders_won: number; win_pct: number | null;
  outcomes: Record<string, number>; followups: number; top_objections: { text: string; n: number }[];
  recent_notes: { score: number | null; outcome: string | null; note: string }[]; avg_call_sec: number | null; small_sample: boolean;
}

export interface FactsModerator {
  name: string; conversations: number; late_first_reply: number; abandoned: number; orders: number; cancelled: number;
  mtd_net_sales: number; calls_answered: number; calls_missed: number; pending_over_72h: number; target: number | null;
}
export interface MorningFacts {
  date: string; ads_cap_pct: number; day_of_month: number; days_in_month: number;
  sales: { orders: number; net_sales: number; cancelled: number; avg7_orders: number; avg7_net_sales: number; mtd_net_sales: number; mtd_orders: number };
  ads: { spend_recorded: boolean; spend: number; pct: number | null; mtd_spend: number; mtd_pct: number | null;
         campaigns_3d: { name: string; spend: number; orders: number; conversations: number; tracked: boolean }[] };
  moderators: FactsModerator[];
  call_eval_7d: { name: string; analysed_calls: number; avg_score: number | null; win_pct: number | null; followups: number; small_sample: boolean }[];
  top_objections_7d: { text: string; n: number }[];
  followups: { pending_over_72h: number; pending_over_7d: number; missed_calls_no_callback: number; call_followups_needed_7d: number };
  open_alerts: { id: string; rule: string; severity: Severity; title: string; body: string | null }[];
}
export interface MorningReportAi {
  headline: string[];
  sections: { sales: string; ads: string; moderators: string; calls: string; followups: string };
  moderator_notes: { name: string; note: string }[];
  decisions: { title: string; why: string }[];
}
export interface MorningReportRow {
  report_date: string; facts: MorningFacts; report: MorningReportAi | null; status: "facts_only" | "done" | "error";
  model: string | null; cost_usd: number | null; error: string | null; created_at: string; updated_at: string;
}

export const OUTCOME_AR: Record<string, string> = {
  order_placed: "طلب اتسجل", order_promised: "وعد بالطلب", inquiry_only: "استفسار بس", not_interested: "مش مهتم",
  complaint: "شكوى", followup: "محتاج متابعة", other: "أخرى",
};
export const SEVERITY_AR: Record<Severity, string> = { danger: "خطير", warning: "تحذير", info: "معلومة" };
