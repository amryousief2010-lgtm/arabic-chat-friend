import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fmtNum } from "@/lib/printPdf";
import { Scale, AlertTriangle, CheckCircle2 } from "lucide-react";

type PaymentMethod = "cash" | "vodafone_cash" | "instapay" | "bank_transfer";
const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "نقدي (كاش)",
  vodafone_cash: "فودافون كاش",
  instapay: "إنستا باي",
  bank_transfer: "تحويل بنكي",
};

interface Movement {
  id: string;
  movement_type: "income" | "expense";
  movement_date: string;
  amount: number;
  payment_method: PaymentMethod;
  status: "pending" | "approved" | "rejected";
  description: string | null;
  customer_name: string | null;
  beneficiary: string | null;
  created_at: string;
}

interface Advance {
  id: string;
  recipient_name: string;
  amount: number;
  payment_method: PaymentMethod;
  status: string;
  issued_at: string;
}

interface Props {
  movements: Movement[];
  openingByMethod: Record<PaymentMethod, number>;
  officialByMethod: Record<PaymentMethod, number>;
  onChanged: () => void;
}

export default function ReconcileTab({ movements, openingByMethod, officialByMethod, onChanged }: Props) {
  const { user, isGeneralManager, isExecutiveManager } = useAuth();
  const isManager = isGeneralManager || isExecutiveManager;
  const [pm, setPm] = useState<PaymentMethod>("cash");
  const [expected, setExpected] = useState<string>("");
  const [adv, setAdv] = useState<Advance[]>([]);
  const [loadingAdv, setLoadingAdv] = useState(false);
  const [corr, setCorr] = useState({ type: "expense" as "income" | "expense", amount: "" as any, reason: "" });
  const [saving, setSaving] = useState(false);

  // Load open advances for the selected method
  useMemo(() => {
    (async () => {
      setLoadingAdv(true);
      const { data } = await (supabase as any)
        .from("lab_treasury_advances")
        .select("id,recipient_name,amount,payment_method,status,issued_at")
        .in("status", ["issued", "open", "pending"]);
      setAdv((data || []) as Advance[]);
      setLoadingAdv(false);
    })();
  }, []);

  const opening = openingByMethod[pm] || 0;
  const approved = movements.filter((m) => m.status === "approved" && m.payment_method === pm);
  const totalIncome = approved.filter((m) => m.movement_type === "income").reduce((s, m) => s + Number(m.amount), 0);
  const totalExpense = approved.filter((m) => m.movement_type === "expense").reduce((s, m) => s + Number(m.amount), 0);
  const openAdvancesTotal = adv.filter((a) => a.payment_method === pm).reduce((s, a) => s + Number(a.amount), 0);
  const systemBalance = officialByMethod[pm] || 0;
  // Final expected from raw inputs (system view)
  const computedFinal = opening + totalIncome - totalExpense;
  const expectedNum = Number(expected) || 0;
  const diff = expected.trim() === "" ? null : expectedNum - systemBalance;

  // Running ledger for the selected method
  const ledger = useMemo(() => {
    const sorted = [...approved].sort((a, b) => {
      const d = a.movement_date.localeCompare(b.movement_date);
      if (d !== 0) return d;
      return a.created_at.localeCompare(b.created_at);
    });
    let running = opening;
    return sorted.map((m) => {
      running += (m.movement_type === "income" ? 1 : -1) * Number(m.amount);
      return { ...m, balance: running };
    });
  }, [approved, opening]);

  async function submitCorrection() {
    if (!user) return;
    const amt = Number(corr.amount);
    if (!amt || amt <= 0) { toast.error("أدخل مبلغ تصحيح صحيح"); return; }
    if (!corr.reason.trim() || corr.reason.trim().length < 10) { toast.error("اكتب سبب التصحيح بوضوح (10 أحرف على الأقل)"); return; }
    if (!isManager) { toast.error("التصحيح يحتاج اعتماد المدير العام/التنفيذي"); return; }
    setSaving(true);
    const { data: ins, error } = await (supabase as any).from("lab_treasury_movements").insert({
      movement_type: corr.type,
      movement_date: new Date().toISOString().slice(0, 10),
      income_category: corr.type === "income" ? "other" : null,
      expense_category: corr.type === "expense" ? "other" : null,
      amount: amt,
      payment_method: pm,
      description: `تصحيح مطابقة الخزنة: ${corr.reason.trim()}`,
      status: "approved",
      created_by: user.id,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    }).select("id").single();
    if (error) { setSaving(false); toast.error("فشل التصحيح: " + error.message); return; }
    await (supabase as any).from("lab_treasury_audit_log").insert({
      action: "reconcile_correction",
      movement_id: ins?.id ?? null,
      actor_id: user.id,
      reason: corr.reason.trim(),
      metadata: { payment_method: pm, type: corr.type, amount: amt, expected: expectedNum, system_before: systemBalance },
    });
    toast.success("تم تسجيل حركة التصحيح المعتمدة");
    setCorr({ type: "expense", amount: "", reason: "" });
    setSaving(false);
    onChanged();
  }

  return (
    <div className="space-y-4 pt-3">
      <Alert>
        <Scale className="h-4 w-4" />
        <AlertTitle className="text-sm">مطابقة الخزنة مع الكشف اليدوي</AlertTitle>
        <AlertDescription className="text-xs">
          راجع تسلسل الحركات المعتمدة برصيد جارٍ، قارن مع الرصيد اليدوي، ولو ظهر فرق سجل حركة تصحيح معتمدة بسبب موثق (تُسجَّل في سجل التدقيق).
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">طريقة الدفع</CardTitle></CardHeader>
        <CardContent>
          <Select value={pm} onValueChange={(v) => setPm(v as PaymentMethod)}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((k) => (
                <SelectItem key={k} value={k}>{PAYMENT_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">الرصيد الافتتاحي المعتمد</div><div className="text-xl font-bold tabular-nums">{fmtNum(opening, 2)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">إجمالي الإيرادات المعتمدة</div><div className="text-xl font-bold text-[hsl(var(--success))] tabular-nums">{fmtNum(totalIncome, 2)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">إجمالي المصروفات المعتمدة</div><div className="text-xl font-bold text-destructive tabular-nums">{fmtNum(totalExpense, 2)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">العُهد المفتوحة</div><div className="text-xl font-bold tabular-nums">{fmtNum(openAdvancesTotal, 2)}</div><div className="text-[10px] text-muted-foreground">{loadingAdv ? "..." : `${adv.filter((a) => a.payment_method === pm).length} عهدة`}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">ملخص الرصيد</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between"><span>الرصيد المحسوب من البيانات الخام (افتتاحي + إيرادات − مصروفات)</span><span className="font-mono font-bold">{fmtNum(computedFinal, 2)}</span></div>
          <div className="flex justify-between"><span>الرصيد الظاهر في النظام (الرسمي المعتمد)</span><span className="font-mono font-bold text-primary">{fmtNum(systemBalance, 2)}</span></div>
          {Math.abs(computedFinal - systemBalance) > 0.01 && (
            <div className="text-xs text-destructive">⚠ فرق داخلي بين الحساب الخام ورصيد العرض = {fmtNum(computedFinal - systemBalance, 2)}</div>
          )}
          <div className="border-t pt-2 mt-2">
            <Label className="text-xs">أدخل الرصيد النهائي حسب الكشف اليدوي</Label>
            <div className="flex gap-2 mt-1">
              <Input type="number" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="مثال: 14300" className="w-48" />
              {diff !== null && (
                <Badge variant={Math.abs(diff) < 0.01 ? "default" : "destructive"} className="text-sm">
                  {Math.abs(diff) < 0.01 ? <><CheckCircle2 className="w-3 h-3 me-1" /> مطابق تمامًا</> : <><AlertTriangle className="w-3 h-3 me-1" /> فرق: {fmtNum(diff, 2)}</>}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {diff !== null && Math.abs(diff) > 0.01 && (
        <Card className="border-amber-500/50">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /> حركة تصحيح معتمدة</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Alert variant="destructive" className="py-2">
              <AlertDescription className="text-xs">
                التصحيح يضيف حركة معتمدة جديدة (لا يعدل أي حركة قديمة) ويُسجَّل في سجل التدقيق. لازم سبب واضح.
              </AlertDescription>
            </Alert>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">النوع</Label>
                <Select value={corr.type} onValueChange={(v) => setCorr({ ...corr, type: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">مصروف (يخصم من الرصيد)</SelectItem>
                    <SelectItem value="income">إيراد (يضاف للرصيد)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">المبلغ</Label>
                <Input type="number" value={corr.amount} onChange={(e) => setCorr({ ...corr, amount: e.target.value })} placeholder={`المقترح: ${fmtNum(Math.abs(diff), 2)}`} />
              </div>
              <div className="flex items-end">
                <Button onClick={() => setCorr({ ...corr, type: diff > 0 ? "income" : "expense", amount: String(Math.abs(diff).toFixed(2)) })} variant="outline" className="w-full">استخدام الفرق المقترح</Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">سبب التصحيح (إجباري)</Label>
              <Textarea value={corr.reason} onChange={(e) => setCorr({ ...corr, reason: e.target.value })} placeholder="مثال: تسجيل مصروف علاج 200 ج لم يُدخل من قبل بتاريخ 2026/06/08" rows={2} />
            </div>
            <Button onClick={submitCorrection} disabled={saving || !isManager}>
              {saving ? "جارٍ الحفظ..." : "تسجيل حركة التصحيح المعتمدة"}
            </Button>
            {!isManager && <div className="text-xs text-destructive">يتطلب صلاحية مدير عام/تنفيذي</div>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">دفتر الحركات المعتمدة - رصيد جارٍ ({PAYMENT_LABELS[pm]})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>البيان</TableHead>
                <TableHead className="text-end">مصروف</TableHead>
                <TableHead className="text-end">إيراد</TableHead>
                <TableHead className="text-end">الرصيد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/50">
                <TableCell colSpan={4} className="font-semibold">الرصيد الافتتاحي المعتمد</TableCell>
                <TableCell className="text-end font-mono font-bold">{fmtNum(opening, 2)}</TableCell>
              </TableRow>
              {ledger.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs">{m.movement_date}</TableCell>
                  <TableCell className="text-xs">{m.description || m.customer_name || m.beneficiary || "—"}</TableCell>
                  <TableCell className="text-end font-mono text-destructive tabular-nums">{m.movement_type === "expense" ? fmtNum(m.amount, 2) : ""}</TableCell>
                  <TableCell className="text-end font-mono text-[hsl(var(--success))] tabular-nums">{m.movement_type === "income" ? fmtNum(m.amount, 2) : ""}</TableCell>
                  <TableCell className="text-end font-mono font-bold tabular-nums">{fmtNum(m.balance, 2)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-primary/10">
                <TableCell colSpan={4} className="font-semibold">الرصيد النهائي</TableCell>
                <TableCell className="text-end font-mono font-bold text-primary">{fmtNum(systemBalance, 2)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
