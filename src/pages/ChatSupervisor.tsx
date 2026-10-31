import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useChatConversations } from "@/hooks/useChatConversations";
import { CHAT_PHONE_REVIEW_PATH, canManageConversations, canReviewPhones } from "@/config/chatManagement";
import {
  STATUS_LABELS, adSourceLabel, computeKpis, filterConversations, sortByActivity, type ConversationStatus, type InboxConversation, type InboxFilters,
} from "@/lib/chatManagement/inbox";
import KpiStrip from "@/components/chatManagement/KpiStrip";
import ConversationList from "@/components/chatManagement/ConversationList";
import ConversationThread from "@/components/chatManagement/ConversationThread";
import { ChannelTabs } from "@/components/chatManagement/ChannelTabs";
import { contactLabel, countByChannel, type ChannelFilter } from "@/lib/chatManagement/channels";
import { DayFilterChips, phoneAccessFor } from "@/components/chatManagement/ConversationPhone";
import CustomerPanel from "@/components/chatManagement/CustomerPanel";

const db = supabase as any;
const NONE = "__none__";

/** عرض المشرفات: كل المحادثات + فلاتر + (لـ SM/GM فقط) إعادة الإسناد والتغطية. */
export default function ChatSupervisor() {
  const { roles } = useAuth() as { roles?: string[] };
  const canManage = canManageConversations(roles);
  const phoneAccess = phoneAccessFor(roles);
  const { conversations, moderators, lines, campaigns, assignments, settings, loading, error, reload } = useChatConversations();
  const [filters, setFilters] = useState<InboxFilters>({ status: "all", lineId: "all", moderatorId: "all" });
  const [selected, setSelected] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState(NONE);
  const [coverBy, setCoverBy] = useState(NONE);
  const now = useMemo(() => new Date(), [conversations]);
  const items = useMemo(() => sortByActivity(filterConversations(conversations, filters, now, settings)), [conversations, filters, now, settings]);
  const kpis = useMemo(() => computeKpis(items, assignments, now, settings), [items, assignments, now, settings]);
  const sel = conversations.find((c) => c.id === selected) ?? null;
  const modName = (id: string | null) => (id ? moderators.find((m) => m.id === id)?.display_name ?? "—" : "غير مسندة");
  const srcOf = (c: InboxConversation) => adSourceLabel(c, campaigns.find((x) => x.id === c.campaign_id)?.name);
  const lineName = (id: string | null) => lines.find((l) => l.id === id)?.label ?? "خط غير معروف";
  const channelCounts = useMemo(() => countByChannel(conversations), [conversations]);
  const set = (p: Partial<InboxFilters>) => setFilters((f) => ({ ...f, ...p }));
  const canRename = (roles ?? []).includes("general_manager");
  const adOptions = useMemo(() => campaigns.map((cp) => {
    const cs = conversations.filter((c) => c.campaign_id === cp.id);
    return { id: cp.id, name: cp.name, n: cs.length, orders: cs.filter((c) => c.has_order).length };
  }).filter((o) => o.n > 0).sort((a, b) => b.n - a.n), [campaigns, conversations]);
  const [adName, setAdName] = useState("");
  useEffect(() => { setAdName(campaigns.find((x) => x.id === filters.source)?.name ?? ""); }, [filters.source, campaigns]);
  const renameAd = async () => {
    const { error: e } = await db.rpc("cm_rename_campaign", { _campaign_id: filters.source, _name: adName.trim() });
    if (e) toast.error(`تعذّر حفظ الاسم: ${e.message}`); else { toast.success("تم حفظ اسم الإعلان"); reload(); }
  };

  const reassign = async () => {
    if (!sel || reassignTo === NONE) return;
    const { error: e } = await db.rpc("cm_reassign_conversation", { _conversation_id: sel.id, _moderator_id: reassignTo, _reason: "manual_supervisor" });
    if (e) toast.error(`تعذّر الإسناد: ${e.message}`); else { toast.success("تم الإسناد"); setReassignTo(NONE); reload(); }
  };
  const cover = async (on: boolean) => {
    if (!sel || coverBy === NONE) return;
    const { error: e } = await db.rpc("cm_set_cover", { _conversation_id: sel.id, _moderator_id: coverBy, _on: on });
    if (e) toast.error(`تعذّر: ${e.message}`); else { toast.success(on ? "تمت إضافة التغطية" : "تم إنهاء التغطية"); reload(); }
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-4">
        <Header title="كل المحادثات" subtitle="متابعة المشرفات — الفلاتر والمؤشرات الحية" />
        <div className="flex flex-wrap gap-2 items-center">
          {!canManage && <Badge variant="secondary">عرض فقط — الإسناد والتغطية لمديرة المبيعات والمدير العام</Badge>}
          {canReviewPhones(roles) && <Button asChild variant="outline" size="sm"><Link to={CHAT_PHONE_REVIEW_PATH}>مراجعة الأرقام ودمج العملاء</Link></Button>}
        </div>
        {error && <p className="text-sm text-destructive">تعذّر التحميل: {error}</p>}
        <ChannelTabs value={(filters.channel ?? "all") as ChannelFilter} onChange={(v) => set({ channel: v })} counts={channelCounts} />
        <KpiStrip kpis={kpis} />
        <Card><CardContent className="p-3 flex flex-wrap gap-4 items-end">
          <div className="space-y-1"><Label>الحالة</Label>
            <Select value={filters.status} onValueChange={(v) => set({ status: v as ConversationStatus | "all" })}>
              <SelectTrigger className="w-36" aria-label="الحالة"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">الكل</SelectItem>
                {(Object.keys(STATUS_LABELS) as ConversationStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select></div>
          <div className="space-y-1"><Label>الخط</Label>
            <Select value={filters.lineId} onValueChange={(v) => set({ lineId: v })}>
              <SelectTrigger className="w-44" aria-label="الخط"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">كل الخطوط</SelectItem>
                {lines.map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select></div>
          <div className="space-y-1"><Label>المودريتور</Label>
            <Select value={filters.moderatorId} onValueChange={(v) => set({ moderatorId: v })}>
              <SelectTrigger className="w-40" aria-label="المودريتور"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="unassigned">غير مسندة</SelectItem>
                {moderators.map((m) => <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>)}
              </SelectContent>
            </Select></div>
          <div><Label className="text-xs">المصدر</Label>
            <Select value={filters.source ?? "all"} onValueChange={(v) => set({ source: v })}>
              <SelectTrigger className="w-64" aria-label="المصدر"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">كل المصادر</SelectItem><SelectItem value="ads">من إعلان</SelectItem><SelectItem value="organic">مباشر (بدون إعلان)</SelectItem>
                {adOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name} ({o.n}{o.orders ? ` · ${o.orders} طلب` : ""})</SelectItem>)}
              </SelectContent>
            </Select></div>
          {canRename && filters.source && !["all", "ads", "organic"].includes(filters.source) && (
            <div className="flex gap-1 items-end">
              <div><Label className="text-xs">اسم الإعلان</Label>
                <Input className="w-48" aria-label="اسم الإعلان" value={adName} placeholder="مثال: إعلان التجار"
                  onChange={(e) => setAdName(e.target.value)} /></div>
              <Button size="sm" variant="outline" onClick={renameAd} disabled={!adName.trim()}>حفظ الاسم</Button>
            </div>
          )}
          <div className="space-y-1"><Label>الطلب</Label>
            <Select value={filters.ordered ?? "all"} onValueChange={(v) => set({ ordered: v as InboxFilters["ordered"] })}>
              <SelectTrigger className="w-32" aria-label="الطلب"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="yes">تم الطلب</SelectItem><SelectItem value="no">بدون طلب</SelectItem></SelectContent>
            </Select></div>
          <div className="flex items-center gap-2"><Switch id="ab" checked={!!filters.abandonedOnly} onCheckedChange={(v) => set({ abandonedOnly: v })} /><Label htmlFor="ab">المهملة فقط</Label></div>
          <div className="flex items-center gap-2"><Switch id="df" checked={!!filters.deferredOnly} onCheckedChange={(v) => set({ deferredOnly: v })} /><Label htmlFor="df">المؤجلة للصباح فقط</Label></div>
          <div className="w-full"><DayFilterChips day={filters.day} date={filters.date} onChange={(p) => set(p)} /></div>
        </CardContent></Card>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <Card className="lg:col-span-4"><CardContent className="p-0">
            {loading ? <p className="p-4 text-muted-foreground">جارٍ التحميل…</p> :
              <ConversationList items={items} phoneAccess={phoneAccess} selectedId={selected} onSelect={setSelected} now={now} assignments={assignments}
                settings={settings} moderatorName={modName} lineName={lineName} sourceLabel={srcOf} />}
          </CardContent></Card>
          <div className="lg:col-span-5"><ConversationThread conversationId={selected} channel={sel?.channel} contact={sel ? contactLabel(sel) : null} phone={sel?.phone_norm ?? null} phoneAccess={phoneAccess} evidence={sel?.order_evidence} source={sel ? srcOf(sel) : null} title={sel ? `المسندة: ${modName(sel.assigned_moderator_id)}` : undefined} /></div>
          <div className="lg:col-span-3 space-y-4">
            <CustomerPanel customerId={sel?.customer_id ?? null} phoneNorm={sel?.phone_norm ?? null} />
            {canManage && sel && (
              <Card data-testid="manage-controls"><CardHeader className="py-3"><CardTitle className="text-base">الإسناد والتغطية</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Select value={reassignTo} onValueChange={setReassignTo}>
                      <SelectTrigger aria-label="إسناد إلى"><SelectValue placeholder="إسناد إلى" /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE}>اختاري</SelectItem>
                        {moderators.map((m) => <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button onClick={reassign} disabled={reassignTo === NONE}>إسناد</Button>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Select value={coverBy} onValueChange={setCoverBy}>
                      <SelectTrigger aria-label="تغطية بواسطة"><SelectValue placeholder="تغطية بواسطة" /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE}>اختاري</SelectItem>
                        {moderators.map((m) => <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button variant="outline" onClick={() => cover(true)} disabled={coverBy === NONE}>إضافة تغطية</Button>
                    <Button variant="ghost" onClick={() => cover(false)} disabled={coverBy === NONE}>إنهاء</Button>
                  </div>
                </CardContent></Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
