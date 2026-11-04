import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { MODERATORS, isModeratorActiveInMonth } from "@/constants/moderators";
import { DEFAULT_KPI_SETTINGS, type AssignmentRow, type KpiSettings } from "@/lib/chatManagement/responseClock";
import { firstReplyStatusOf, lastActivityAt, localDateKey, type InboxConversation } from "@/lib/chatManagement/inbox";
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
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [rpcMissing, setRpcMissing] = useState(false);
  const [mods, setMods] = useState<{ id: string; slug: string; display_name: string; sort_order: number }[]>([]);
  const [convs, setConvs] = useState<InboxConversation[]>([]);
  const [orders, setOrders] = useState<Record<string, number>>({});
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [settings, setSettings] = useState<KpiSettings>(DEFAULT_KPI_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [open, setOpen] = useState<InboxConversation | null>(null);
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    const now = new Date();
    const r = periodRange(period, now);
    const b = isoBounds(r);
    const [m, c, a, k, o, rpc] = await Promise.all([
      db.from("cm_moderators").select("id,slug,display_name,sort_order").order("sort_order"),
      db.from("cm_conversations").select(
        "id,channel,contact_name,contact_handle,external_contact_id,is_demo,line_id,status,owner_moderator_id,assigned_moderator_id,phone_norm,customer_id,first_inbound_at,clock_started_at,first_reply_at,first_reply_was_cover,awaiting_reply_since,last_inbound_at,last_outbound_at,campaign_id",
      ).not("first_inbound_at", "is", null).gte("first_inbound_at", b.lo).lt("first_inbound_at", b.hi)
        .order("first_inbound_at", { ascending: false }).limit(3000),
      db.from("cm_shift_assignments").select("work_date,starts_at,ends_at,moderator_id").gte("work_date", addDays(r.from, -1)).lte("work_date", r.to),
      db.from("cm_kpi_settings").select("*").maybeSingle(),
      db.from("orders").select("moderator_id,created_at").not("moderator_id", "is", null).gte("created_at", b.lo).lt("created_at", b.hi).limit(10000),
      db.rpc("cm_moderator_board", { p_from: r.from, p_to: r.to }),
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
    if (rpc.error) {
      // الدالة غير منشورة بعد (PGRST202/42883) أو خطأ آخر ⇒ أرقام تقريبية من البيانات المحمّلة.
      setRpcMissing(true); setRows(null);
    } else { setRpcMissing(false); setRows(rpc.data ?? []); }
    setUpdatedAt(new Date());
  }, [period]);

  // تحميل + تحديث مباشر (debounce ثانيتين) + استطلاع كل 30 ثانية احتياطياً.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    load();
    const bump = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(load, 2000); };
    const ch = db.channel(`cm-board-${period}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cm_conversations" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "cm_messages" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, bump)
      .subscribe((s: string) => setLive(s === "SUBSCRIBED"));
    const poll = setInterval(load, 30_000);
    return () => { clearInterval(poll); if (timer.current) clearTimeout(timer.current); db.removeChannel(ch); };
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
      return { mod: m!, stats: row ?? local, list: withSt };
    });
  }, [mods, convs, rows, assignments, settings, orders, now]);

  const ranked = columns.filter((c) => c.stats.conversations > 0);
  const onTimePct = (s: BoardRow) => pct(s.on_time + s.cover, s.conversations);
  const best = [...ranked].sort((a, b) => onTimePct(b.stats) - onTimePct(a.stats))[0];
  const worst = [...ranked].sort((a, b) => (b.stats.late + b.stats.unanswered) - (a.stats.late + a.stats.unanswered))[0];

  return (
    <div className="space-y-3" data-testid="moderator-board">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
          <Button key={p} size="sm" variant={p === period ? "default" : "outline"} onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</Button>
        ))}
        <Badge variant={live ? "default" : "secondary"}>{live ? "تحديث مباشر" : "تحديث كل 30 ثانية"}</Badge>
        {updatedAt && <span className="text-xs text-muted-foreground">آخر تحديث {updatedAt.toLocaleTimeString("ar-EG", { timeZone: TZ })}</span>}
      </div>
      {error && <p className="text-sm text-destructive">تعذّر التحميل: {error}</p>}
      {rpcMissing && <p className="text-xs text-amber-700">الأرقام محسوبة مؤقتاً من المحادثات المحمّلة (دالة اللوحة غير مفعّلة بعد) — متوسط وقت الرد غير متاح.</p>}
      {ranked.length > 0 && (
        <Card><CardContent className="p-3 flex flex-wrap gap-6 text-sm">
          {best && <span>🏆 الأكثر التزاماً: <b>{best.mod.display_name}</b> ({onTimePct(best.stats)}% في الوقت)</span>}
          {worst && (worst.stats.late + worst.stats.unanswered) > 0 && <span>⚠️ الأكثر تأخيراً: <b>{worst.mod.display_name}</b> ({worst.stats.late} متأخر + {worst.stats.unanswered} بدون رد)</span>}
          {columns.map((c) => <span key={c.mod.id} className="text-muted-foreground">{c.mod.display_name}: {onTimePct(c.stats)}%</span>)}
        </CardContent></Card>
      )}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-3 xl:grid-cols-5">
        {columns.map(({ mod, stats, list }) => (
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
              <div className="max-h-[60vh] overflow-y-auto divide-y border rounded">
                {list.length === 0 && <p className="p-3 text-xs text-muted-foreground">لا محادثات في الفترة</p>}
                {list.map(({ c, st }) => (
                  <button key={c.id} onClick={() => setOpen(c)} className="w-full text-right flex items-stretch hover:bg-muted/60">
                    <span className={`w-1.5 shrink-0 ${st ? COLOR[st] : "bg-muted"}`} />
                    <span className="p-2 min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{contactLabel(c) ?? (c.phone_norm ? "عميل واتساب" : "عميل")}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {new Date(lastActivityAt(c)).toLocaleString("ar-EG", { timeZone: TZ, hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric" })}
                        {st === "pending" ? " · بدون رد" : st === "late" ? " · متأخر" : st ? " · في الوقت" : ""}
                      </span>
                    </span>
                  </button>
                ))}
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
