import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Inbox, CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface Row {
  id: string;
  lab_movement_id: string;
  amount: number;
  payment_method: string;
  transfer_date: string;
  status: string;
  custody_keeper_id: string | null;
  notes: string | null;
  created_at: string;
}

const PM_LBL: Record<string, string> = {
  cash: "نقدي", vodafone_cash: "فودافون كاش", instapay: "إنستا باي", bank_transfer: "تحويل بنكي",
};

export default function IncomingLabCustodyTransfers({ onReceived }: { onReceived?: () => void }) {
  const { roles, isGeneralManager, isExecutiveManager } = useAuth();
  const isKeeper = roles?.includes("slaughterhouse_custody_keeper");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("lab_treasury_to_custody_transfers")
      .select("id, lab_movement_id, amount, payment_method, transfer_date, status, custody_keeper_id, notes, created_at")
      .eq("status", "sent")
      .order("created_at", { ascending: false });
    if (error) { toast.error("تعذر تحميل التحويلات من المعمل"); setLoading(false); return; }
    setRows((data || []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const confirm = async (r: Row) => {
    setBusy(r.id);
    const { error } = await supabase.rpc("confirm_lab_to_custody_transfer" as any, { p_transfer_id: r.id });
    setBusy(null);
    if (error) { toast.error("تعذر تأكيد الاستلام: " + error.message); return; }
    toast.success("تم تأكيد الاستلام وإضافة المبلغ إلى رصيد الخزنة الرئيسية للمجزر");
    await load();
    onReceived?.();
  };

  const canConfirm = isKeeper || isGeneralManager || isExecutiveManager;

  return (
    <Card className="border-amber-400/40 bg-amber-50/40 dark:bg-amber-950/10">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="w-5 h-5 text-amber-600" />
          تحويلات واردة من خزنة المعمل إلى الخزنة الرئيسية للمجزر — بانتظار التأكيد
          {rows.length > 0 && <Badge variant="destructive" className="mr-2">{rows.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحميل…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">لا توجد تحويلات من المعمل بانتظار الاستلام.</div>
        ) : (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{r.transfer_date}</Badge>
                    <Badge variant="secondary">{PM_LBL[r.payment_method] || r.payment_method}</Badge>
                  </div>
                  <div className="font-bold text-lg font-mono tabular-nums mt-1">{Number(r.amount).toLocaleString()} ج.م</div>
                  {r.notes && <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{r.notes}</div>}
                </div>
                {canConfirm ? (
                  <Button size="sm" onClick={() => confirm(r)} disabled={busy === r.id} className="gap-2">
                    {busy === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    تأكيد الاستلام
                  </Button>
                ) : (
                  <Badge variant="secondary">بانتظار أمين العهدة</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
