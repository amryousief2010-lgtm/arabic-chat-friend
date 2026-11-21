/** قمع الإعلانات: يربط إنفاق حملات ميتا بالخطوط (cm_campaign_line_map) ثم بالمودريتور مالكة الخط،
 *  ويعدّ المحادثات والطلبات من بيانات coceg. لا تخمين: ما لا يوجد له ربط في قاعدة البيانات يظهر «غير مربوط». */
export interface FSpend { campaign_id: string; spend_date: string; spend: number; impressions: number | null; clicks: number | null }
export interface FCampaign { id: string; name: string; meta_campaign_id: string | null; product_tag: string | null }
export interface FLineMap { campaign_id: string; line_id: string; valid_from: string; valid_to: string | null }
export interface FLine { id: string; label: string; owner_moderator_id: string | null }
export interface FConv { conversation_id: string; line_id: string | null; moderator_id: string | null; campaign_id: string | null;
  first_reply_status: string | null; is_abandoned: boolean | null }
export interface FOrder { order_id: string; conversation_id: string | null; is_delivered: boolean | null; delivered_value: number | null }
export interface FAd { campaign_id: string; meta_ad_id: string; name: string | null }

export interface FunnelRow { key: string; label: string; spend: number | null; impressions: number | null; clicks: number | null;
  conversations: number | null; from_ad: number | null; replied: number | null; abandoned: number | null;
  orders: number | null; delivered: number | null; delivered_value: number | null; campaigns: string[]; lines: string[] }

const REPLIED = new Set(["on_time", "cover", "late"]);
export const UNMAPPED = "__unmapped__";
export const UNOWNED = "__unowned__";

/** الحملة مربوطة بالخط في يوم الإنفاق؟ */
export const lineForSpend = (maps: FLineMap[], campaignId: string, day: string): string | null =>
  maps.find((m) => m.campaign_id === campaignId && m.valid_from <= day && (m.valid_to == null || m.valid_to >= day))?.line_id
  ?? null;

const emptyRow = (key: string, label: string): FunnelRow => ({ key, label, spend: 0, impressions: 0, clicks: 0, conversations: 0, from_ad: 0,
  replied: 0, abandoned: 0, orders: 0, delivered: 0, delivered_value: 0, campaigns: [], lines: [] });

const addNull = (a: number | null, b: number | null | undefined) => (a == null || b == null ? null : a + Number(b));

export function funnelByModerator(input: { spend: FSpend[]; campaigns: FCampaign[]; maps: FLineMap[]; lines: FLine[];
  convs: FConv[]; orders: FOrder[]; moderatorName: (id: string) => string }): FunnelRow[] {
  const { spend, campaigns, maps, lines, convs, orders, moderatorName } = input;
  const camp = new Map(campaigns.map((c) => [c.id, c]));
  const line = new Map(lines.map((l) => [l.id, l]));
  const rows = new Map<string, FunnelRow>();
  const get = (key: string) => {
    if (!rows.has(key)) rows.set(key, emptyRow(key, key === UNMAPPED ? "حملات غير مربوطة بخط" : key === UNOWNED ? "خطوط بلا مودريتور" : moderatorName(key)));
    return rows.get(key)!;
  };
  for (const s of spend) {
    const lid = lineForSpend(maps, s.campaign_id, s.spend_date);
    const key = lid ? (line.get(lid)?.owner_moderator_id ?? UNOWNED) : UNMAPPED;
    const r = get(key);
    r.spend = (r.spend ?? 0) + Number(s.spend);
    r.impressions = addNull(r.impressions, s.impressions);
    r.clicks = addNull(r.clicks, s.clicks);
    const cn = camp.get(s.campaign_id)?.name ?? "—";
    if (!r.campaigns.includes(cn)) r.campaigns.push(cn);
    if (lid) { const ln = line.get(lid)?.label ?? "—"; if (!r.lines.includes(ln)) r.lines.push(ln); }
  }
  const convOwner = new Map<string, string>();
  for (const c of convs) {
    const key = c.moderator_id ?? (c.line_id ? line.get(c.line_id)?.owner_moderator_id : null) ?? UNOWNED;
    convOwner.set(c.conversation_id, key);
    const r = get(key);
    r.conversations! += 1;
    if (c.campaign_id) r.from_ad! += 1;
    if (c.first_reply_status && REPLIED.has(c.first_reply_status)) r.replied! += 1;
    if (c.is_abandoned) r.abandoned! += 1;
    if (c.line_id) { const ln = line.get(c.line_id)?.label ?? "—"; if (!r.lines.includes(ln)) r.lines.push(ln); }
  }
  for (const o of orders) {
    const key = o.conversation_id ? convOwner.get(o.conversation_id) : undefined;
    if (!key) continue; // طلب مربوط بمحادثة خارج الفترة
    const r = get(key);
    r.orders! += 1;
    if (o.is_delivered) { r.delivered! += 1; r.delivered_value! += Number(o.delivered_value ?? 0); }
  }
  const un = rows.get(UNMAPPED);
  if (un) { un.conversations = un.from_ad = un.replied = un.abandoned = un.orders = un.delivered = un.delivered_value = null; }
  return [...rows.values()].sort((a, b) => (a.key === UNMAPPED ? 1 : b.key === UNMAPPED ? -1 : (b.spend ?? 0) - (a.spend ?? 0)));
}

export interface AdRow extends FunnelRow { meta_ad_id: string | null; line_campaigns: string[] }

/** لكل إعلان (صف AUTO_AD): المحادثات والطلبات. الإنفاق مسجّل على مستوى حملة ميتا وليس الإعلان، فلا يُوزَّع. */
export function funnelByAd(input: { ads: FAd[]; campaigns: FCampaign[]; maps: FLineMap[]; lines: FLine[]; convs: FConv[]; orders: FOrder[];
  spend: FSpend[] }): AdRow[] {
  const { ads, campaigns, maps, lines, convs, orders, spend } = input;
  const camp = new Map(campaigns.map((c) => [c.id, c]));
  const line = new Map(lines.map((l) => [l.id, l]));
  const spentCampaigns = new Set(spend.map((s) => s.campaign_id));
  const rows = new Map<string, AdRow>();
  const convAd = new Map<string, string>();
  for (const c of convs) {
    if (!c.campaign_id) continue;
    convAd.set(c.conversation_id, c.campaign_id);
    if (!rows.has(c.campaign_id)) {
      const ad = ads.find((a) => a.campaign_id === c.campaign_id);
      rows.set(c.campaign_id, { ...emptyRow(c.campaign_id, camp.get(c.campaign_id)?.name ?? ad?.name ?? "—"), spend: null, impressions: null, clicks: null,
        meta_ad_id: ad?.meta_ad_id ?? camp.get(c.campaign_id)?.meta_campaign_id ?? null, line_campaigns: [] });
    }
    const r = rows.get(c.campaign_id)!;
    r.conversations! += 1; r.from_ad! += 1;
    if (c.first_reply_status && REPLIED.has(c.first_reply_status)) r.replied! += 1;
    if (c.is_abandoned) r.abandoned! += 1;
    if (c.line_id) {
      const ln = line.get(c.line_id)?.label ?? "—"; if (!r.lines.includes(ln)) r.lines.push(ln);
      for (const m of maps) if (m.line_id === c.line_id && spentCampaigns.has(m.campaign_id)) {
        const n = camp.get(m.campaign_id)?.name ?? "—"; if (!r.line_campaigns.includes(n)) r.line_campaigns.push(n);
      }
    }
  }
  for (const o of orders) {
    const k = o.conversation_id ? convAd.get(o.conversation_id) : undefined;
    if (!k) continue;
    const r = rows.get(k)!; r.orders! += 1;
    if (o.is_delivered) { r.delivered! += 1; r.delivered_value! += Number(o.delivered_value ?? 0); }
  }
  return [...rows.values()].sort((a, b) => (b.conversations ?? 0) - (a.conversations ?? 0));
}

export const safeDiv = (n: number | null, d: number | null): number | null => (n == null || d == null || d <= 0 ? null : Math.round((n / d) * 100) / 100);

export interface DaySpend { day: string; spend: number; impressions: number | null; clicks: number | null; campaigns: number }
export const spendByDay = (spend: FSpend[]): DaySpend[] => {
  const m = new Map<string, DaySpend>();
  for (const s of spend) {
    const d = m.get(s.spend_date) ?? { day: s.spend_date, spend: 0, impressions: 0, clicks: 0, campaigns: 0 };
    d.spend = Math.round((d.spend + Number(s.spend)) * 100) / 100; d.impressions = addNull(d.impressions, s.impressions);
    d.clicks = addNull(d.clicks, s.clicks); d.campaigns += 1; m.set(s.spend_date, d);
  }
  return [...m.values()].sort((a, b) => b.day.localeCompare(a.day));
};

export const firstOfMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
