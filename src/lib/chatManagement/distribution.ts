// طرق التوزيع الثلاث (تختارها مديرة المبيعات من الإعدادات). منطق نقي للمحادثات غير المملوكة
// (عملاء إعلانات جدد بلا خط معروف، ماسنجر/إنستجرام لاحقاً). المحادثة على خط مودريتور تبقى لصاحبة الخط.
export type DistributionMethod = "round_robin" | "load" | "campaign";
export type FallbackMethod = "round_robin" | "load" | "none";

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

export interface Candidate { id: string; open_conversations: number; max_open: number }

export const pickModerator = (args: {
  method: DistributionMethod;
  fallback: FallbackMethod;
  lineOwnerId?: string | null;
  campaignOwnerId?: string | null;
  candidates: Candidate[]; // من في الشيفت الآن
  lastAssignedId?: string | null;
}): { id: string | null; via: DistributionMethod | "line_owner" | null } => {
  if (args.lineOwnerId) return { id: args.lineOwnerId, via: "line_owner" };
  const pool = args.candidates.filter((c) => c.open_conversations < c.max_open);
  const run = (m: DistributionMethod | FallbackMethod): string | null => {
    if (m === "campaign") return args.campaignOwnerId ?? null;
    if (!pool.length || m === "none") return null;
    if (m === "load") return [...pool].sort((a, b) => a.open_conversations - b.open_conversations)[0].id;
    const i = pool.findIndex((c) => c.id === args.lastAssignedId);
    return pool[(i + 1) % pool.length].id;
  };
  const first = run(args.method);
  if (first) return { id: first, via: args.method };
  const fb = args.fallback === "none" ? null : run(args.fallback);
  return { id: fb, via: fb ? (args.fallback as DistributionMethod) : null };
};
