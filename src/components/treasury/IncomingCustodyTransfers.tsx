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
  main_txn_id: string;
  amount: number;
  transfer_date: string;
  status: string;
  received_at: string | null;
  custody_keeper_id: string | null;
  notes: string | null;
  created_at: string;
  reference_no?: string;
  description?: string;
}

export default function IncomingCustodyTransfers({ onReceived }: { onReceived?: () => void }) {
  const { user, roles, isGeneralManager, isExecutiveManager } = useAuth();
  const isKeeper = roles?.includes("slaughterhouse_custody_keeper");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: xfers, error } = await supabase
      .from("main_treasury_to_custody_transfers")
      .select("id, main_txn_id, amount, transfer_date, status, received_at, custody_keeper_id, notes, created_at")
      .is("received_at", null)
      .eq("status", "sent")
      .order("created_at", { ascending: false });
    if (error) { toast.error("تعذر تحميل التحويلات الواردة"); setLoading(false); return; }
    const ids = (xfers || []).map(x => x.main_txn_id);
    let txnMap: Record<string, any> = {};
    if (ids.length) {
      const { data: txns } = await supabase
        .from("main_treasury_transactions")
        .select("id, reference_no, description, status")
        .in("id", ids);
      (txns || []).forEach(t => { txnMap[t.id] = t; });
    }
    // only show transfers where parent txn is posted/approved
    const merged = (xfers || [])
      .map(x => ({ ...x, reference_no: txnMap[x.main_txn_id]?.reference_no, description: txnMap[x.main_txn_id]?.description, _parentStatus: txnMap[x.main_txn_id]?.status }))
      .filter(x => x._parentStatus === "posted" || x._parentStatus === "approved");
    setRows(merged);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const confirm = async (r: Row) => {
    setBusy(r.id);
    const { error } = await supabase
      .from("main_treasury_to_custody_transfers")
      .update({ received_at: new Date().toISOString(), received_by: user?.id, status: "received" })
      .eq("id", r.id);
    setBusy(null);
    if (error) { toast.error("تعذر تأكيد الاستلام: " + error.message); return; }
    toast.success("تم تأكيد استلام التحويل وإضافته لرصيد العهدة");
    await load();
    onReceived?.();
  };

  const canConfirm = isKeeper || isGeneralManager || isExecutiveManager;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="w-5 h-5 text-primary" />
          تحويلات واردة من الخزنة الرئيسية — بانتظار الاستلام
          {rows.length > 0 && <Badge variant="destructive" className="mr-2">{rows.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحميل…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">لا توجد تحويلات بانتظار الاستلام.</div>
        ) : (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">{r.reference_no || "—"}</span>
                    <Badge variant="outline">{r.transfer_date}</Badge>
                  </div>
                  <div className="font-bold text-lg font-mono tabular-nums mt-1">{Number(r.amount).toLocaleString()} ج.م</div>
                  {r.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{r.description}</div>}
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
