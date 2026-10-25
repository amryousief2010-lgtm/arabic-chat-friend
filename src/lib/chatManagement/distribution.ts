// طرق التوزيع الثلاث (تختارها مديرة المبيعات من الإعدادات). منطق نقي مطابق لدالة SQL
// public.cm_distribute_conversation (migration 20261025130000):
// 1) صاحبة الخط تأخذ محادثة خطها دائماً ما دامت نشطة (غير منتهية/موقوفة).
//    إن كانت في إجازتها الأسبوعية تبقى المالكة وتُسجَّل «تغطية» لأول من في الشيفت.
// 2) غير المملوكة: campaign (مودريتور الحملة إن كانت متاحة) ثم fallback؛ أو load / round_robin مباشرة.
// 3) load: الأقل محادثات مفتوحة ثم الترتيب. round_robin: التالية بعد آخر من أُسند إليها بالترتيب.
//    كلاهما على من في الشيفت وقت بداية العدّ (رسالة 03:00 تُوزَّع على شيفت 09:00) ودون تجاوز الحد الأقصى.
export type DistributionMethod = "round_robin" | "load" | "campaign";
export type FallbackMethod = "round_robin" | "load" | "none";
export type DistributionVia = DistributionMethod | "line_owner";

export const DISTRIBUTION_LABELS: Record<DistributionMethod, string> = {
  campaign: "حسب الحملة الإعلانية",
  load: "حسب عدد المحادثات المفتوحة",
  round_robin: "بالدور",
};
export const FALLBACK_LABELS: Record<FallbackMethod, string> = {
  load: "حسب عدد المحادثات المفتوحة",
  round_robin: "بالدور",
  none: "بدون (تبقى لمديرة المبيعات)",
};

export interface Candidate { id: string; open_conversations: number; max_open: number; sort_order?: number }

const bySort = (a: Candidate, b: Candidate) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

export const pickModerator = (args: {
  method: DistributionMethod;
  fallback: FallbackMethod;
  lineOwnerId?: string | null;
  /** false = انتهى عملها أو أوقفت → المحادثة تُعامل كغير مملوكة */
  lineOwnerActive?: boolean;
  /** true = يوم إجازتها الأسبوعية → تبقى المالكة + تغطية */
  lineOwnerOnLeave?: boolean;
  campaignOwnerId?: string | null;
  campaignOwnerAvailable?: boolean;
  candidates: Candidate[]; // من في الشيفت وقت بداية العدّ
  lastAssignedId?: string | null;
}): { id: string | null; via: DistributionVia | null; coverId?: string | null } => {
  const shift = [...args.candidates].sort(bySort);
  if (args.lineOwnerId && args.lineOwnerActive !== false) {
    if (args.lineOwnerOnLeave) {
      const cover = shift.find((c) => c.id !== args.lineOwnerId)?.id ?? null;
      return { id: args.lineOwnerId, via: "line_owner", coverId: cover };
    }
    return { id: args.lineOwnerId, via: "line_owner" };
  }
  const pool = shift.filter((c) => c.open_conversations < c.max_open);
  const run = (m: DistributionMethod | FallbackMethod): string | null => {
    if (m === "campaign") return args.campaignOwnerAvailable === false ? null : args.campaignOwnerId ?? null;
    if (!pool.length || m === "none") return null;
    if (m === "load") return [...pool].sort((a, b) => a.open_conversations - b.open_conversations || bySort(a, b))[0].id;
    const i = pool.findIndex((c) => c.id === args.lastAssignedId);
    return pool[(i + 1) % pool.length].id;
  };
  const first = run(args.method);
  if (first) return { id: first, via: args.method };
  // مثل SQL: الـ fallback يُستخدم فقط عندما تكون الطريقة الأساسية campaign
  if (args.method !== "campaign") return { id: null, via: null };
  const fb = args.fallback === "none" ? null : run(args.fallback);
  return { id: fb, via: fb ? (args.fallback as DistributionMethod) : null };
};
