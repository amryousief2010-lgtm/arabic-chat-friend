import { CHANNELS, channelDef, type ChannelFilter } from "@/lib/chatManagement/channels";

/** تبويبات القنوات مع العدّاد. تيك توك «قريبًا» معطّل. */
export function ChannelTabs({ value, onChange, counts }: { value: ChannelFilter; onChange: (v: ChannelFilter) => void; counts: Record<ChannelFilter, number> }) {
  const btn = (v: ChannelFilter, label: string, n: number | null, disabled = false, icon?: string) => (
    <button key={v} type="button" role="tab" aria-selected={value === v} disabled={disabled} data-testid={`channel-tab-${v}`}
      onClick={() => !disabled && onChange(v)}
      className={`px-3 py-1.5 rounded-full text-sm border flex items-center gap-1 ${value === v ? "bg-primary text-primary-foreground" : "bg-background"} ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-muted"}`}>
      {icon && <span aria-hidden>{icon}</span>}<span>{label}</span>
      {n !== null && <span className="text-xs opacity-80">({n})</span>}
    </button>
  );
  return (
    <div role="tablist" aria-label="القناة" dir="rtl" className="flex flex-wrap gap-2" data-testid="channel-tabs">
      {btn("all", "الكل", counts.all)}
      {CHANNELS.map((c) => c.enabled ? btn(c.kind, c.label, counts[c.kind], false, c.icon) : btn(c.kind, `${c.label} «قريبًا»`, null, true, c.icon))}
    </div>
  );
}

export function ChannelBadge({ channel, withLabel = false }: { channel?: string | null; withLabel?: boolean }) {
  const d = channelDef(channel);
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 text-xs border" style={{ borderColor: d.color, color: d.color }}
      title={d.label} data-testid="channel-badge">
      <span aria-hidden>{d.icon}</span>{withLabel ? d.label : <span className="sr-only">{d.label}</span>}
    </span>
  );
}
