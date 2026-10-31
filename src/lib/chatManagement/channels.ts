// سجل قنوات المحادثات بالترتيب المعتمد: واتساب ← ماسنجر ← إنستجرام ← تيك توك (قريبًا).
// إضافة قناة جديدة = صف في cm_channels + عنصر هنا + webhook خاص بها.
export type ChannelKind = "whatsapp" | "messenger" | "instagram" | "tiktok";
export type ChannelFilter = ChannelKind | "all";

export interface ChannelDef { kind: ChannelKind; label: string; icon: string; color: string; enabled: boolean }

export const CHANNELS: ChannelDef[] = [
  { kind: "whatsapp", label: "واتساب", icon: "🟢", color: "#25D366", enabled: true },
  { kind: "messenger", label: "ماسنجر", icon: "💬", color: "#0084FF", enabled: true },
  { kind: "instagram", label: "إنستجرام", icon: "📸", color: "#C13584", enabled: true },
  { kind: "tiktok", label: "تيك توك", icon: "🎵", color: "#111111", enabled: false },
];

export const channelDef = (k: string | null | undefined): ChannelDef =>
  CHANNELS.find((c) => c.kind === k) ?? CHANNELS[0];

export const countByChannel = (list: { channel?: string | null }[]): Record<ChannelFilter, number> => {
  const out = { all: list.length, whatsapp: 0, messenger: 0, instagram: 0, tiktok: 0 } as Record<ChannelFilter, number>;
  for (const c of list) { const k = (c.channel ?? "whatsapp") as ChannelKind; if (k in out) out[k]++; }
  return out;
};

/** اسم جهة الاتصال للعرض عندما لا يوجد رقم: «الاسم · @handle». */
export const contactLabel = (c: { contact_name?: string | null; contact_handle?: string | null; channel?: string | null }): string | null => {
  const name = (c.contact_name ?? "").trim();
  const handle = (c.contact_handle ?? "").trim();
  if (!name && !handle) return c.channel && c.channel !== "whatsapp" ? `عميل ${channelDef(c.channel).label}` : null;
  return [name, handle && `@${handle}`].filter(Boolean).join(" · ");
};
