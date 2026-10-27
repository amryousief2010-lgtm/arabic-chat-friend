import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { canWriteAdSpend } from "@/config/chatManagement";
import { CsvImportCard } from "@/components/chatManagement/CsvImportCard";
import { mapSpend, type SpendRow } from "@/lib/chatManagement/csvImport";
import { formatMoney } from "@/lib/chatManagement/kpiMetrics";

const db = supabase as any;
interface Campaign { id: string; name: string }
interface Spend { id: string; campaign_id: string; spend_date: string; spend: number; currency: string; impressions: number | null; clicks: number | null; source: string }
const today = () => new Date().toISOString().slice(0, 10);

/** الإنفاق الإعلاني اليومي: إدخال يدوي أو CSV (حتى يُفعَّل ربط Marketing API بعد توثيق ميتا). إعادة الإدخال لنفس الحملة واليوم تُحدِّث القيمة. */
export default function ChatAdSpend() {
  const { roles } = useAuth() as { roles?: string[] };
  const canWrite = canWriteAdSpend(roles); // EM: عرض فقط
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [rows, setRows] = useState<Spend[]>([]);
  const [form, setForm] = useState({ campaign_id: "", spend_date: today(), spend: "", impressions: "", clicks: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([
      db.from("cm_campaigns").select("id,name").order("name"),
      db.from("cm_ad_spend_daily").select("id,campaign_id,spend_date,spend,currency,impressions,clicks,source").order("spend_date", { ascending: false }).limit(200),
    ]);
    if (c.error || s.error) toast.error(`تعذّر التحميل: ${(c.error ?? s.error).message}`);
    setCampaigns(c.data ?? []); setRows(s.data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const cname = (id: string) => campaigns.find((c) => c.id === id)?.name ?? "—";

  const upsert = async (list: object[]) => {
    const { data, error } = await db.rpc("cm_upsert_ad_spend", { _rows: list, _source: "manual" });
    if (error) { toast.error(`تعذّر الحفظ: ${error.message}`); return null; }
    load();
    return `أضيف ${data.inserted} — حُدِّث ${data.updated} — مرفوض ${data.rejected.length}` +
      (data.rejected.length ? ` (${data.rejected.slice(0, 5).map((r: { row: number; reason: string }) => `سطر ${r.row}: ${r.reason === "unknown_campaign" ? "حملة غير معروفة" : r.reason}`).join("، ")})` : "");
  };
  const save = async () => {
    const spend = Number(form.spend);
    if (!form.campaign_id || !form.spend_date || !Number.isFinite(spend) || spend < 0) { toast.error("اختاري الحملة والتاريخ وأدخلي مبلغاً صحيحاً"); return; }
    setBusy(true);
    const m = await upsert([{ campaign_id: form.campaign_id, spend_date: form.spend_date, spend,
      impressions: form.impressions || null, clicks: form.clicks || null }]);
    setBusy(false); if (m) { toast.success(m); setForm({ ...form, spend: "", impressions: "", clicks: "" }); }
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-4">
        <Header title="الإنفاق الإعلاني اليومي" subtitle="إدخال يدوي أو استيراد CSV — الربط التلقائي مع ميتا يُفعَّل بعد اكتمال توثيق النشاط التجاري" />
        {!canWrite && <p role="note" className="rounded border border-[#662D8C]/30 bg-[#662D8C]/5 p-2 text-sm">عرض فقط — الإدخال والاستيراد لمدير التسويق والمبيعات ومدير المبيعات والمدير العام.</p>}
        {canWrite && <>
        <Card><CardHeader><CardTitle>إدخال يوم</CardTitle><CardDescription>نفس الحملة ونفس اليوم = تحديث القيمة وليس تكراراً</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <label className="text-sm">الحملة
              <select aria-label="الحملة" className="block h-10 w-56 rounded-md border bg-background px-2" value={form.campaign_id} onChange={(e) => setForm({ ...form, campaign_id: e.target.value })}>
                <option value="">— اختاري —</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label className="text-sm">التاريخ<Input type="date" value={form.spend_date} onChange={(e) => setForm({ ...form, spend_date: e.target.value })} className="w-44" /></label>
            <label className="text-sm">المبلغ (ج.م)<Input inputMode="decimal" value={form.spend} onChange={(e) => setForm({ ...form, spend: e.target.value })} className="w-32" /></label>
            <label className="text-sm">مرات الظهور<Input inputMode="numeric" value={form.impressions} onChange={(e) => setForm({ ...form, impressions: e.target.value })} className="w-32" /></label>
            <label className="text-sm">النقرات<Input inputMode="numeric" value={form.clicks} onChange={(e) => setForm({ ...form, clicks: e.target.value })} className="w-28" /></label>
            <Button onClick={save} disabled={busy} className="bg-[#A4288A] hover:bg-[#662D8C] text-white">حفظ</Button>
          </CardContent></Card>

        <CsvImportCard<SpendRow> title="استيراد CSV" description="تصدير يومي من مدير الإعلانات أو ملف يدوي. يُحلَّل في المتصفح ويُعرض قبل الاستيراد."
          columnsHint={<p>الأعمدة المطلوبة: اسم الحملة <code dir="ltr" className="font-mono">Campaign name</code> أو معرّفها <code dir="ltr" className="font-mono">campaign_id</code>، والتاريخ بصيغة <code dir="ltr" className="font-mono">YYYY-MM-DD</code>، والمبلغ المصروف <code dir="ltr" className="font-mono">Amount spent</code>. واختيارياً: مرات الظهور <code dir="ltr" className="font-mono">Impressions</code>، والنقرات <code dir="ltr" className="font-mono">Clicks</code>، والعملة <code dir="ltr" className="font-mono">Currency</code>.</p>}
          map={mapSpend} previewHeaders={["الحملة", "التاريخ", "المبلغ", "الظهور", "النقرات"]}
          preview={(r) => [r.campaign_name ?? r.meta_campaign_id ?? "", r.spend_date, formatMoney(r.spend, r.currency), String(r.impressions ?? "—"), String(r.clicks ?? "—")]}
          onImport={(list) => upsert(list)} />
        </>}

        <Card><CardHeader><CardTitle>آخر الإدخالات</CardTitle></CardHeader>
          <CardContent className="overflow-auto"><table className="w-full text-sm">
            <thead className="bg-muted"><tr>{["التاريخ","الحملة","المبلغ","الظهور","النقرات","المصدر"].map((h) => <th key={h} className="p-2 text-right">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t"><td className="p-2">{r.spend_date}</td><td className="p-2">{cname(r.campaign_id)}</td>
                <td className="p-2">{formatMoney(r.spend, r.currency)}</td><td className="p-2">{r.impressions ?? "—"}</td><td className="p-2">{r.clicks ?? "—"}</td>
                <td className="p-2">{r.source === "manual" ? "يدوي" : "Marketing API"}</td></tr>))}
              {!rows.length && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">لا إدخالات بعد</td></tr>}
            </tbody></table></CardContent></Card>
      </div>
    </DashboardLayout>
  );
}
