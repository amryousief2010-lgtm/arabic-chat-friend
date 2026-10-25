import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface MtCandidate {
  id: string; reference_no: string; amount: number; txn_date: string;
  description: string | null; status: string; linked_invoice_no: string | null;
}

/** اختيار حركة الخزنة الرئيسية اللي اتدفعت منها فاتورة شراء المصنع (±50 ج، ±3 أيام). */
export default function MainTreasuryTxnPicker({ amount, date, value, onChange, excludeInvoiceNo }: {
  amount: number; date: string; value: string | null; onChange: (id: string | null) => void; excludeInvoiceNo?: string | null;
}) {
  const [rows, setRows] = useState<MtCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!(amount > 0) || !date) { setRows([]); return; }
    let cancelled = false;
    setLoading(true);
    (supabase.rpc as any)("mt_expense_match_candidates", { p_amount: amount, p_date: date })
      .then(({ data }: any) => { if (!cancelled) setRows((data || []) as MtCandidate[]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [amount, date, reloadKey]);
  const usable = rows.filter(r => !r.linked_invoice_no || r.linked_invoice_no === excludeInvoiceNo || r.id === value);
  const showEmpty = !loading && amount > 0 && !!date && usable.length === 0;
  return (
    <div>
      <Label>حركة الخزنة الرئيسية</Label>
      <Select value={value || ""} onValueChange={(v) => onChange(v || null)}>
        <SelectTrigger className="whitespace-normal text-start h-auto min-h-10"><SelectValue placeholder={loading ? "جاري التحميل…" : usable.length ? "اختر الحركة" : "مفيش مصروف مطابق (±50 ج، ±3 أيام)"} /></SelectTrigger>
        <SelectContent>
          {usable.map(r => (
            <SelectItem key={r.id} value={r.id}>
              {r.reference_no} — {Number(r.amount).toLocaleString("en-US")} ج — {r.txn_date}{r.description ? ` — ${r.description}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showEmpty && (
        <div className="mt-2 rounded-md border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
          <p>لا يوجد مصروف بقيمة {Number(amount).toLocaleString("en-US")} ج في الخزنة الرئيسية (±50 ج، ±3 أيام) — سجّل المصروف في الخزنة الرئيسية أولًا، ثم ارجع واختره.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline"><Link to="/main-treasury" target="_blank" rel="noopener">فتح الخزنة الرئيسية</Link></Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setReloadKey(k => k + 1)}>تحديث القائمة</Button>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-1">الفاتورة دي مش هتسجل خروج من خزنة المصنع لأن الفلوس اتصرفت من الرئيسية.</p>
    </div>
  );
}
