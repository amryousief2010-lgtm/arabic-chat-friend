import { supabase } from "@/integrations/supabase/client";
import type { FAd, FCampaign, FConv, FLine, FLineMap, FOrder, FSpend } from "./adFunnel";

const db = supabase as any;
const PAGE = 1000;
async function all<T>(q: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += PAGE) {
    const { data, error } = await q().range(i, i + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}
const prevDay = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const nextDay = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 2); return x.toISOString().slice(0, 10); };

export interface FunnelData { spend: FSpend[]; campaigns: FCampaign[]; maps: FLineMap[]; lines: FLine[]; convs: FConv[]; orders: FOrder[];
  ads: FAd[]; moderators: { id: string; display_name: string }[] }

/** قراءة فقط عبر الجداول والـ views الحالية (تحت بوابة المدير العام نفسها). kpi_date بتوقيت الإعدادات (القاهرة). */
/** «عارض المؤشرات» (بدون بوابة القسم الكاملة): نفس البيانات عبر cm_kpiv_funnel_data (معرّفات وتجميعات فقط). */
export async function loadFunnelDataViewer(from: string, to: string): Promise<FunnelData & { recent: any[] }> {
  const { data, error } = await db.rpc("cm_kpiv_funnel_data", { _from: from, _to: to });
  if (error) throw error;
  const d = data ?? {};
  return { spend: d.spend ?? [], campaigns: d.campaigns ?? [], maps: d.maps ?? [], lines: d.lines ?? [], convs: d.convs ?? [],
    orders: d.orders ?? [], ads: d.ads ?? [], moderators: d.moderators ?? [], recent: d.recent ?? [] };
}

export async function loadFunnelData(from: string, to: string, viewerOnly = false): Promise<FunnelData> {
  if (viewerOnly) return loadFunnelDataViewer(from, to);
  const [spend, campaigns, maps, lines, convs, orders, ads, moderators] = await Promise.all([
    all<FSpend>(() => db.from("cm_ad_spend_daily").select("campaign_id,spend_date,spend,impressions,clicks").gte("spend_date", from).lte("spend_date", to).order("spend_date")),
    all<FCampaign>(() => db.from("cm_campaigns").select("id,name,meta_campaign_id,product_tag").order("id")),
    all<FLineMap>(() => db.from("cm_campaign_line_map").select("campaign_id,line_id,valid_from,valid_to").order("id")),
    all<FLine>(() => db.from("cm_lines").select("id,label,owner_moderator_id").order("id")),
    all<FConv>(() => db.from("cm_kpi_conversations_v").select("conversation_id,line_id,moderator_id,campaign_id,first_reply_status,is_abandoned")
      .gte("first_inbound_at", prevDay(from)).lt("first_inbound_at", nextDay(to)).gte("kpi_date", from).lte("kpi_date", to).order("conversation_id")),
    all<FOrder>(() => db.from("cm_kpi_orders_v").select("order_id,conversation_id,is_delivered,delivered_value")
      .gte("created_at", prevDay(from)).not("conversation_id", "is", null).order("order_id")),
    all<FAd>(() => db.from("cm_campaign_ads").select("campaign_id,meta_ad_id,name").order("id")),
    all<{ id: string; display_name: string }>(() => db.from("cm_moderators").select("id,display_name").order("id")),
  ]);
  return { spend, campaigns, maps, lines, convs, orders, ads, moderators };
}
