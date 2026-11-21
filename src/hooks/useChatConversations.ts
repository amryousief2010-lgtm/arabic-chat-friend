import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_KPI_SETTINGS, type AssignmentRow, type KpiSettings } from "@/lib/chatManagement/responseClock";
import { withOrderFlags, type InboxConversation } from "@/lib/chatManagement/inbox";

const db = supabase as any;
export interface ModOption { id: string; display_name: string; sort_order: number }
export interface LineOption { id: string; label: string }

/** يحمّل المحادثات (RLS تحدد ما تراه كل مستخدمة) مع المودريتورز والخطوط والإعدادات وشيفتات آخر يومين للمؤشرات. */
export function useChatConversations(opts: { moderatorId?: string | null } = {}) {
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [moderators, setModerators] = useState<ModOption[]>([]);
  const [lines, setLines] = useState<LineOption[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [settings, setSettings] = useState<KpiSettings>(DEFAULT_KPI_SETTINGS);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
    let q = db.from("cm_conversations").select(
      "id,channel,contact_name,contact_handle,external_contact_id,is_demo,line_id,status,owner_moderator_id,assigned_moderator_id,phone_norm,customer_id,first_inbound_at,clock_started_at,first_reply_at,first_reply_was_cover,awaiting_reply_since,last_inbound_at,last_outbound_at,campaign_id,ad_id,ad_headline,ad_source_type",
    ).order("last_inbound_at", { ascending: false, nullsFirst: false }).limit(500);
    if (opts.moderatorId) q = q.or(`assigned_moderator_id.eq.${opts.moderatorId},owner_moderator_id.eq.${opts.moderatorId}`);
    // أسماء الحملات للعرض/الفلتر — غير حرجة (قد تمنعها RLS عن بعض الأدوار).
    db.from("cm_campaigns").select("id,name").order("name").then((r: any) => setCampaigns(r.data ?? []));
    const [c, m, l, a, k, f] = await Promise.all([
      q,
      db.from("cm_moderators").select("id,display_name,sort_order").eq("is_active", true).order("sort_order"),
      db.from("cm_lines").select("id,label").order("label"),
      db.from("cm_shift_assignments").select("work_date,starts_at,ends_at,moderator_id").gte("work_date", since),
      db.from("cm_kpi_settings").select("*").maybeSingle(),
      // «تم الطلب» — غير حرج: إن فشل تظهر القائمة بدون الشارة.
      db.rpc("cm_conversation_order_flags"),
    ]);
    const err = [c, m, l, a, k].find((r: any) => r.error)?.error;
    setError(err ? err.message : null);
    setConversations(withOrderFlags(c.data ?? [], f.error ? [] : f.data ?? []));
    setModerators(m.data ?? []);
    setLines(l.data ?? []);
    setAssignments(a.data ?? []);
    if (k.data) setSettings({ ...DEFAULT_KPI_SETTINGS, ...k.data,
      service_window_start: String(k.data.service_window_start).slice(0, 5), service_window_end: String(k.data.service_window_end).slice(0, 5) });
    setLoading(false);
  }, [opts.moderatorId]);

  useEffect(() => { load(); }, [load]);
  return { conversations, moderators, lines, campaigns, assignments, settings, loading, error, reload: load };
}
