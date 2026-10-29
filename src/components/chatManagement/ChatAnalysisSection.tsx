import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime12 } from "@/lib/chatManagement/timeFormat";
import { CHAT_CATEGORY_LABELS, CHAT_OUTCOME_LABELS, chatLabel, fmtMin } from "@/lib/chatManagement/chatAnalysisLabels";

const db = supabase as any;
const ALL = "all";
interface ModR { moderator_id: string | null; display_name: string | null; conversations: number; replied: number; avg_first_response_min: number | null;
  median_first_response_min: number | null; avg_replies: number | null; analyzed: number; avg_quality: number | null; order_pct: number | null; from_ads: number }
interface AdR { campaign_id: string | null; campaign_name: string | null; ad_id: string | null; conversations: number; analyzed: number; orders: number;
  avg_first_response_min: number | null; avg_quality: number | null; top_category: string | null }
interface CatR { category: string; conversations: number; orders: number }
interface Row { conversation_id: string; first_inbound_at: string | null; moderator_name: string | null; campaign_name: string | null; is_organic: boolean;
  first_response_min: number | null; reply_count: number; category: string | null; outcome: string | null; quality_score: number | null;
  quality_notes: string | null; summary_ar: string | null; status: string | null }

/** تحليل محادثات واتساب: التصنيف والنتيجة والجودة + مؤشرات SQL (أول رد، عدد الردود، الإعلان). */
export default function ChatAnalysisSection({ from, to }: { from: string; to: string }) {
  const [mod, setMod] = useState(ALL); const [cat, setCat] = useState(ALL); const [camp, setCamp] = useState(ALL);
  const [mods, setMods] = useState<ModR[]>([]); const [ads, setAds] = useState<AdR[]>([]);
  const [cats, setCats] = useState<CatR[]>([]); const [rows, setRows] = useState<Row[]>([]);
  const [modOpts, setModOpts] = useState<{ id: string; name: string }[]>([]);
  const [campOpts, setCampOpts] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const m = mod === ALL ? null : mod, c = cat === ALL ? null : cat, k = camp === ALL ? null : camp;
    const [a, b, d, l] = await Promise.all([
      db.rpc("cm_kpi_chat_by_moderator", { _from: from, _to: to, _category: c, _campaign: k }),
      db.rpc("cm_kpi_chat_by_ad", { _from: from, _to: to, _moderator: m, _category: c }),
      db.rpc("cm_kpi_chat_categories", { _from: from, _to: to, _moderator: m, _campaign: k }),
      db.rpc("cm_chat_analysis_list", { _from: from, _to: to, _moderator: m, _category: c, _campaign: k }),
    ]);
    const e = a.error ?? b.error ?? d.error ?? l.error;
    if (e) { console.error("chat analysis load failed", e); toast.error("تعذّر تحميل تحليل المحادثات"); }
    setMods(a.data ?? []); setAds(b.data ?? []); setCats(d.data ?? []); setRows(l.data ?? []);
    if (mod === ALL) setModOpts((a.data ?? []).filter((r: ModR) => r.moderator_id).map((r: ModR) => ({ id: r.moderator_id!, name: r.display_name ?? "—" })));
    if (camp === ALL) setCampOpts((b.data ?? []).filter((r: AdR) => r.campaign_id).map((r: AdR) => ({ id: r.campaign_id!, name: r.campaign_name ?? "—" })));
  }, [from, to, mod, cat, camp]);
  useEffect(() => { load(); }, [load]);

  const analyze = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("cm-analyze-chat", { body: { batch: true, limit: 15 } });
    setBusy(false);
    if (error) toast.error("تعذّر تشغيل التحليل"); else { toast.success(`تم تحليل ${data?.processed ?? 0} محادثة`); load(); }
  };

  const th = (h: string) => <th key={h} className="p-2 text-right whitespace-nowrap">{h}</th>;
  return (
    <Card data-testid="chat-analysis"><CardHeader><CardTitle>تحليل المحادثات</CardTitle>
      <CardDescription>تصنيف آلي لكل محادثة (بدون إرسال أرقام العملاء) + زمن أول رد وعدد الردود والإعلان المصدر</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Select value={mod} onValueChange={setMod}><SelectTrigger className="w-44" aria-label="المودريتور"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>كل المودريتورز</SelectItem>{modOpts.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent></Select>
          <Select value={cat} onValueChange={setCat}><SelectTrigger className="w-44" aria-label="التصنيف"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>كل التصنيفات</SelectItem>{Object.entries(CHAT_CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
          <Select value={camp} onValueChange={setCamp}><SelectTrigger className="w-56" aria-label="الإعلان"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>كل الإعلانات</SelectItem>{campOpts.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent></Select>
          <Button size="sm" variant="outline" disabled={busy} onClick={analyze}>{busy ? "جارٍ التحليل…" : "تحليل المحادثات الجديدة"}</Button>
        </div>

        <div className="flex flex-wrap gap-2">{cats.map((c) => <span key={c.category} className="rounded bg-muted px-2 py-1 text-xs">{chatLabel(CHAT_CATEGORY_LABELS, c.category)}: {c.conversations}{c.orders ? ` (طلبات ${c.orders})` : ""}</span>)}</div>

        <div className="overflow-x-auto rounded border"><table className="w-full min-w-max text-sm">
          <thead className="bg-muted"><tr>{["المودريتور","محادثات","تم الرد","متوسط أول رد","وسيط أول رد","متوسط الردود","محلَّلة","متوسط الجودة","% وصلت لطلب","من إعلانات"].map(th)}</tr></thead>
          <tbody>{mods.map((r, i) => <tr key={r.moderator_id ?? i} className="border-t">
            <td className="p-2 font-medium">{r.display_name ?? "غير مُسند"}</td><td className="p-2">{r.conversations}</td><td className="p-2">{r.replied}</td>
            <td className="p-2">{fmtMin(r.avg_first_response_min)}</td><td className="p-2">{fmtMin(r.median_first_response_min)}</td><td className="p-2">{r.avg_replies ?? "—"}</td>
            <td className="p-2">{r.analyzed}</td><td className="p-2">{r.avg_quality == null ? "—" : `${Number(r.avg_quality).toFixed(1)} / 5`}</td>
            <td className="p-2">{r.order_pct == null ? "—" : `${r.order_pct}%`}</td><td className="p-2">{r.from_ads}</td></tr>)}
            {!mods.length && <tr><td colSpan={10} className="p-4 text-center text-muted-foreground">لا بيانات</td></tr>}</tbody></table></div>

        <div className="overflow-x-auto rounded border"><table className="w-full min-w-max text-sm">
          <thead className="bg-muted"><tr>{["الإعلان / الحملة","محادثات","محلَّلة","طلبات","متوسط أول رد","متوسط الجودة","أكثر تصنيف"].map(th)}</tr></thead>
          <tbody>{ads.map((r, i) => <tr key={(r.campaign_id ?? "") + i} className="border-t">
            <td className="p-2 font-medium">{r.campaign_name ?? "—"}</td><td className="p-2">{r.conversations}</td><td className="p-2">{r.analyzed}</td><td className="p-2">{r.orders}</td>
            <td className="p-2">{fmtMin(r.avg_first_response_min)}</td><td className="p-2">{r.avg_quality == null ? "—" : Number(r.avg_quality).toFixed(1)}</td>
            <td className="p-2">{chatLabel(CHAT_CATEGORY_LABELS, r.top_category)}</td></tr>)}</tbody></table></div>

        <div className="max-h-[480px] overflow-auto rounded border"><table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted"><tr>{["الوقت","المودريتور","المصدر","أول رد","ردود","التصنيف","النتيجة","الجودة","الملخص"].map(th)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.conversation_id} className="border-t align-top">
            <td className="p-2 whitespace-nowrap">{formatDateTime12(r.first_inbound_at)}</td><td className="p-2">{r.moderator_name ?? "—"}</td>
            <td className="p-2">{r.campaign_name ?? (r.is_organic ? "عضوي" : "—")}</td><td className="p-2">{fmtMin(r.first_response_min)}</td><td className="p-2">{r.reply_count}</td>
            <td className="p-2">{r.status === "done" ? chatLabel(CHAT_CATEGORY_LABELS, r.category) : "لم تُحلَّل"}</td><td className="p-2">{chatLabel(CHAT_OUTCOME_LABELS, r.outcome)}</td>
            <td className="p-2">{r.quality_score ?? "—"}</td>
            <td className="p-2 max-w-md">{r.summary_ar}{r.quality_notes && <div className="text-xs text-muted-foreground">{r.quality_notes}</div>}</td></tr>)}</tbody></table></div>
      </CardContent></Card>
  );
}
