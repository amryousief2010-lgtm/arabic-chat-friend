import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { MODERATORS, isModeratorActiveInMonth } from "@/constants/moderators";
import { DEFAULT_KPI_SETTINGS, type AssignmentRow, type KpiSettings } from "@/lib/chatManagement/responseClock";
import { firstReplyStatusOf, lastActivityAt, localDateKey, maskPhone, boardContactTitle, resolveBoardAdName, summarizeAds, type InboxConversation } from "@/lib/chatManagement/inbox";
import { contactLabel } from "@/lib/chatManagement/channels";
import ConversationThread from "@/components/chatManagement/ConversationThread";
import { phoneAccessFor } from "@/components/chatManagement/ConversationPhone";

const db = supabase as any;
const TZ = "Africa/Cairo";
type Period = "today" | "week" | "month";
const PERIOD_LABEL: Record<Period, string> = { today: "النهارده", week: "آخر 7 أيام", month: "الشهر الحالي" };

export interface BoardRow {
  moderator_id: string; display_name: string; sort_order: number;
  conversations: number; unanswered: number; on_time: number; cover: number; late: number;
  waiting_customer: number; avg_reply_minutes: number | null; orders_registered: number;
}
export interface BoardAdRow {
  moderator_id: string; ad_id: string | null; ad_name: string;
  conversations: number; inbound_messages: number | null;
}

const addDays = (key: string, n: number) => {
  const d = new Date(key + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
export const periodRange = (p: Period, now = new Date()): { from: string; to: string } => {
  const today = localDateKey(now, TZ);
  if (p === "today") return { from: today, to: today };
  if (p === "week") return { from: addDays(today, -6), to: today };
  return { from: today.slice(0, 8) + "01", to: today };
};
/** حدود زمنية واسعة (يوم قبل/بعد) — الفلترة الدقيقة باليوم المحلي على العميل. */
const isoBounds = (r: { from: string; to: string }) => ({ lo: addDays(r.from, -1) + "T00:00:00Z", hi: addDays(r.to, 2) + "T00:00:00Z" });

/** الخمس موظفات الفعّالات هذا الشهر بنفس ترتيب ملف المودريتورز (فاطمة ليست ضمن المودريتورز). */
const boardSlugs = (now: Date) => MODERATORS.filter((m) => isModeratorActiveInMonth(m, now.getFullYear(), now.getMonth() + 1)).map((m) => m.slug);

const fmtMin = (m: number | null | undefined) => m == null ? "—" : m < 60 ? `${Math.round(m)} د` : `${Math.floor(m / 60)} س ${Math.round(m % 60)} د`;
const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0);
const COLOR = { pending: "bg-red-500", late: "bg-orange-500", on_time: "bg-green-500", cover: "bg-green-500" } as const;

export default function ModeratorBoard({ roles }: { roles?: string[] }) {
  const phoneAccess = phoneAccessFor(roles);
  const [period, setPeriod] = useState<Period>("today");
  const [day, setDay] = useState<string | null>(null);
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [rpcMissing, setRpcMissing] = useState(false);
  const [adRpcMissing, setAdRpcMissing] = useState(false);
  const [adRpcRows, setAdRpcRows] = useState<BoardAdRow[] | null>(null);
  const [adNameByMetaId, setAdNameByMetaId] = useState<Record<string, string>>({});
  const [campaignNameById, setCampaignNameById] = useState<Record<string, string>>({});
  const [mods, setMods] = useState<{ id: string; slug: string; display_name: string; sort_order: number }[]>([]);
  const [convs, setConvs] = useState<InboxConversation[]>([]);
  const [orders, setOrders] = useState<Record<string, number>>({});
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [settings, setSettings] = useState<KpiSettings>(DEFAULT_KPI_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [open, setOpen] = useState<InboxConversation | null>(null);
  const [live, setLive] = useState(false);

  // منع تحميلات متراكبة: لو فيه تحميل شغال، علّم إن فيه تحديث مستني بدل ما نبدأ طلب جديد.
  const inFlight = useRef(false);
  const pending = useRef(false);
  const load = useCallback(async () => {
    if (inFlight.current) { pending.current = true; return; }
    if (typeof document !== "undefined" && document.hidden) return;
    inFlight.current = true;
    try {
    const now = new Date();
    const r = day ? { from: day, to: day } : periodRange(period, now);
    const b = isoBounds(r);
    const [m, c, a, k, o, rpc, ads, camps, adRpc] = await Promise.all([
      db.from("cm_moderators").select("id,slug,display_name,sort_order").order("sort_order"),
      db.from("cm_conversations").select(
        "id,channel,contact_name,contact_handle,external_contact_id,is_demo,line_id,status,owner_moderator_id,assigned_moderator_id,phone_norm,customer_id,first_inbound_at,clock_started_at,first_reply_at,first_reply_was_cover,awaiting_reply_since,last_inbound_at,last_outbound_at,campaign_id,ad_id,ad_headline,ad_source_type",
      ).not("first_inbound_at", "is", null).gte("first_inbound_at", b.lo).lt("first_inbound_at", b.hi)
        .order("first_inbound_at", { ascending: false }).limit(3000),
      db.from("cm_shift_assignments").select("work_date,starts_at,ends_at,moderator_id").gte("work_date", addDays(r.from, -1)).lte("work_date", r.to),
      db.from("cm_kpi_settings").select("*").maybeSingle(),
      db.from("orders").select("moderator_id,created_at").not("moderator_id", "is", null).gte("created_at", b.lo).lt("created_at", b.hi).limit(10000),
      db.rpc("cm_moderator_board", { p_from: r.from, p_to: r.to }),
      db.from("cm_campaign_ads").select("meta_ad_id,name").limit(5000),
      db.from("cm_campaigns").select("id,name").limit(2000),
      db.rpc("cm_moderator_board_ad_summary", { p_from: r.from, p_to: r.to }),
    ]);
    const err = [m, c].find((x: any) => x.error)?.error;
    setError(err ? err.message : null);
    setMods(m.data ?? []);
    const inRange = (iso: string | null) => { if (!iso) return false; const key = localDateKey(new Date(iso), TZ); return key >= r.from && key <= r.to; };
    setConvs((c.data ?? []).filter((x: InboxConversation) => inRange(x.first_inbound_at)));
    setAssignments(a.data ?? []);
    if (k.data) setSettings({ ...DEFAULT_KPI_SETTINGS, ...k.data });
    const oc: Record<string, number> = {};
    for (const row of o.data ?? []) if (inRange(row.created_at)) oc[row.moderator_id] = (oc[row.moderator_id] ?? 0) + 1;
    setOrders(oc);
    const adMap: Record<string, string> = {};
    for (const row of ads.data ?? []) if (row.meta_ad_id && row.name) adMap[row.meta_ad_id] = row.name;
    setAdNameByMetaId(adMap);
    const campMap: Record<string, string> = {};
    for (const row of camps.data ?? []) if (row.id && row.name) campMap[row.id] = row.name;
    setCampaignNameById(campMap);
    if (rpc.error) {
      // الدالة غير منشورة بعد (PGRST202/42883) أو خطأ آخر ⇒ أرقام تقريبية من البيانات المحمّلة.
      setRpcMissing(true); setRows(null);
    } else { setRpcMissing(false); setRows(rpc.data ?? []); }
    if (adRpc.error) {
      setAdRpcMissing(true); setAdRpcRows(null);
    } else {
      setAdRpcMissing(false);
      setAdRpcRows((adRpc.data ?? []).map((row: any) => ({
        moderator_id: row.moderator_id,
        ad_id: row.ad_id ?? null,
        ad_name: row.ad_name,
        conversations: Number(row.conversations ?? 0),
        inbound_messages: row.inbound_messages == null ? null : Number(row.inbound_messages),
      })));
    }
    setUpdatedAt(new Date());
    } finally {
      inFlight.current = false;
      if (pending.current) { pending.current = false; setTimeout(load, 1000); }
    }
  }, [period, day]);

  // تحميل + تحديث مباشر (debounce ثانيتين) + استطلاع كل 30 ثانية احتياطياً.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    load();
    // throttle (مش debounce): أقصى تحميل واحد كل 10 ثواني مهما كانت الرسايل كتير.
    const bump = () => { if (!timer.current) timer.current = setTimeout(() => { timer.current = null; load(); }, 10_000); };
    // cm_messages اتشالت: كل رسالة كانت بتعيد تحميل اللوحة كلها؛ تغيّر المحادثة نفسها (last_inbound_at) كفاية.
    const ch = db.channel(`cm-board-${period}-${day ?? ""}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cm_conversations" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, bump)
      .subscribe((s: string) => setLive(s === "SUBSCRIBED"));
    const poll = setInterval(load, 60_000);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(poll); if (timer.current) clearTimeout(timer.current); timer.current = null; document.removeEventListener("visibilitychange", onVis); db.removeChannel(ch); };
  }, [load, period]);

  const now = useMemo(() => new Date(), [convs]);
  const columns = useMemo(() => {
    const slugs = boardSlugs(now);
    return slugs.map((slug) => mods.find((m) => m.slug === slug)).filter(Boolean).map((m) => {
      const mine = convs.filter((c) => (c.assigned_moderator_id ?? c.owner_moderator_id) === m!.id)
        .sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
      const withSt = mine.map((c) => ({ c, st: firstReplyStatusOf({ ...c, owner_moderator_id: c.assigned_moderator_id ?? c.owner_moderator_id }, assignments, now, settings) }));
      const row = rows?.find((r) => r.moderator_id === m!.id);
      const local: BoardRow = {
        moderator_id: m!.id, display_name: m!.display_name, sort_order: m!.sort_order,
        conversations: mine.length,
        unanswered: withSt.filter((x) => x.st === "pending").length,
        on_time: withSt.filter((x) => x.st === "on_time").length,
        cover: withSt.filter((x) => x.st === "cover").length,
        late: withSt.filter((x) => x.st === "late").length,
        waiting_customer: mine.filter((c) => ["open", "pending"].includes(c.status) && c.last_outbound_at
          && (!c.last_inbound_at || c.last_outbound_at >= c.last_inbound_at)).length,
        avg_reply_minutes: null, orders_registered: orders[m!.id] ?? 0,
      };
      const fallbackAds = summarizeAds(mine, adNameByMetaId, campaignNameById);
      const rpcAds = (adRpcRows ?? []).filter((x) => x.moderator_id === m!.id);
      const adSummary = rpcAds.length
        ? rpcAds.map((x) => ({ ad_name: x.ad_name, conversations: x.conversations, inbound_messages: x.inbound_messages }))
        : fallbackAds.map((x) => ({ ...x, inbound_messages: null as number | null }));
      return { mod: m!, stats: row ?? local, list: withSt, adSummary };
    });
  }, [mods, convs, rows, assignments, settings, orders, now, adNameByMetaId, campaignNameById, adRpcRows]);

  const ranked = columns.filter((c) => c.stats.conversations > 0);
  const onTimePct = (s: BoardRow) => pct(s.on_time + s.cover, s.conversations);
  const best = [...ranked].sort((a, b) => onTimePct(b.stats) - onTimePct(a.stats))[0];
  const worst = [...ranked].sort((a, b) => (b.stats.late + b.stats.unanswered) - (a.stats.late + a.stats.unanswered))[0];

  return (
    <div className="space-y-3" data-testid="moderator-board">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
          <Button key={p} size="sm" variant={!day && p === period ? "default" : "outline"} onClick={() => { setDay(null); setPeriod(p); }}>{PERIOD_LABEL[p]}</Button>
        ))}
        <label className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">يوم محدد</span>
          <input type="date" data-testid="board-day" className={`h-8 rounded border px-2 text-xs ${day ? "border-primary ring-1 ring-primary" : ""}`}
            value={day ?? ""} max={localDateKey(new Date(), TZ)} onChange={(e) => setDay(e.target.value || null)} />
        </label>
        <Badge variant={live ? "default" : "secondary"}>{live ? "تحديث مباشر" : "تحديث كل 30 ثانية"}</Badge>
        {updatedAt && <span className="text-xs text-muted-foreground">آخر تحديث {updatedAt.toLocaleTimeString("ar-EG", { timeZone: TZ })}</span>}
      </div>
      {error && <p className="text-sm text-destructive">تعذّر التحميل: {error}</p>}
      {rpcMissing && <p className="text-xs text-amber-700">الأرقام محسوبة مؤقتاً من المحادثات المحمّلة (دالة اللوحة غير مفعّلة بعد) — متوسط وقت الرد غير متاح.</p>}
      {adRpcMissing && <p className="text-xs text-amber-700">ملخص الإعلانات من المحادثات المحمّلة (دالة ملخص الإعلانات غير مفعّلة بعد) — عدد الرسائل غير متاح.</p>}
      {ranked.length > 0 && (
        <Card><CardContent className="p-3 flex flex-wrap gap-6 text-sm">
          {best && <span>🏆 الأكثر التزاماً: <b>{best.mod.display_name}</b> ({onTimePct(best.stats)}% في الوقت)</span>}
          {worst && (worst.stats.late + worst.stats.unanswered) > 0 && <span>⚠️ الأكثر تأخيراً: <b>{worst.mod.display_name}</b> ({worst.stats.late} متأخر + {worst.stats.unanswered} بدون رد)</span>}
          {columns.map((c) => <span key={c.mod.id} className="text-muted-foreground">{c.mod.display_name}: {onTimePct(c.stats)}%</span>)}
        </CardContent></Card>
      )}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-3 xl:grid-cols-5">
        {columns.map(({ mod, stats, list, adSummary }) => (
          <Card key={mod.id} className="flex flex-col min-w-0">
            <CardHeader className="py-2"><CardTitle className="text-base">{mod.display_name}</CardTitle></CardHeader>
            <CardContent className="p-2 space-y-2">
              <div className="grid grid-cols-2 gap-1 text-xs">
                <Stat label="إجمالي المحادثات" v={stats.conversations} />
                <Stat label="لم يُرد عليها" v={stats.unanswered} cls="text-red-600" />
                <Stat label="في الوقت" v={stats.on_time + stats.cover} cls="text-green-600" hint={stats.cover ? `منها ${stats.cover} تغطية` : undefined} />
                <Stat label="متأخر" v={stats.late} cls="text-orange-600" />
                <Stat label="تنتظر رد العميل" v={stats.waiting_customer} />
                <Stat label="متوسط وقت الرد" v={fmtMin(stats.avg_reply_minutes)} />
                <Stat label="طلبات سجلتها" v={stats.orders_registered} />
              </div>
              {adSummary.length > 0 && (
                <div className="rounded border bg-muted/30 p-2 space-y-1" data-testid="board-ad-summary">
                  <div className="text-[11px] font-semibold text-muted-foreground">حسب الإعلان (عدد المحادثات · عدد رسائل العملاء)</div>
                  {adSummary.slice(0, 8).map((a) => (
                    <div key={`${mod.id}-${a.ad_name}`} className="flex items-start justify-between gap-2 text-[11px]">
                      <span className="truncate min-w-0" title={a.ad_name}>{a.ad_name}</span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {`${a.conversations} محادثة`}
                        {a.inbound_messages != null ? ` · ${a.inbound_messages} رسالة` : ""}
                      </span>
                    </div>
                  ))}
                  {adSummary.length > 8 && <div className="text-[10px] text-muted-foreground">+{adSummary.length - 8} إعلان آخر</div>}
                </div>
              )}
              <div className="max-h-[60vh] overflow-y-auto divide-y border rounded">
                {list.length === 0 && <p className="p-3 text-xs text-muted-foreground">لا محادثات في الفترة</p>}
                {list.map(({ c, st }) => {
                  const phoneShown = c.phone_norm
                    ? (phoneAccess === "full" ? c.phone_norm : maskPhone(c.phone_norm))
                    : null;
                  const title = boardContactTitle(c, phoneShown, contactLabel(c));
                  const adName = resolveBoardAdName(c, adNameByMetaId, campaignNameById);
                  return (
                    <button key={c.id} onClick={() => setOpen(c)} className="w-full text-right flex items-stretch hover:bg-muted/60">
                      <span className={`w-1.5 shrink-0 ${st ? COLOR[st] : "bg-muted"}`} />
                      <span className="p-2 min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium" dir="auto">{title}</span>
                        <span className="block truncate text-[11px] text-violet-700" title={adName}>{adName}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {new Date(lastActivityAt(c)).toLocaleString("ar-EG", { timeZone: TZ, hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric" })}
                          {st === "pending" ? " · بدون رد" : st === "late" ? " · متأخر" : st ? " · في الوقت" : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="left" className="w-full sm:max-w-xl overflow-y-auto" dir="rtl">
          <SheetHeader><SheetTitle>{open ? contactLabel(open) ?? "محادثة" : ""}</SheetTitle></SheetHeader>
          {open && <ConversationThread conversationId={open.id} channel={open.channel} contact={contactLabel(open)} phone={open.phone_norm} phoneAccess={phoneAccess} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Stat({ label, v, cls, hint }: { label: string; v: number | string; cls?: string; hint?: string }) {
  return (
    <div className="rounded border p-1.5" title={hint}>
      <div className="text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${cls ?? ""}`}>{v}</div>
    </div>
  );
}
