import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Warehouse, CheckCircle2, XCircle, Loader2, Printer } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface Row {
  id: string;
  amount: number;
  reference: string | null;
  notes: string | null;
  courier_name: string | null;
  performed_by: string | null;
  performed_at: string;
  status: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export default function IncomingWarehouseTreasuryTransfers({ onReceived }: { onReceived?: () => void }) {
  const { roles, isGeneralManager, isExecutiveManager } = useAuth();
  const rs = (roles || []) as string[];
  const canApprove =
    isGeneralManager ||
    isExecutiveManager ||
    rs.includes("financial_manager") ||
    rs.includes("main_treasury_approver") ||
    rs.includes("main_treasury_accountant");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("main_warehouse_treasury_txns")
      .select("id, amount, reference, notes, courier_name, performed_by, performed_at, status")
      .eq("category", "transfer_from_main_warehouse_treasury")
      .eq("direction", "out")
      .eq("status", "pending_approval")
      .order("performed_at", { ascending: false });
    if (error) {
      console.error("MWT load error", error);
      toast.error(error.message || "تعذر تحميل تحويلات المخزن الرئيسي");
      setLoading(false);
      return;
    }
    const list = (data || []) as Row[];
    setRows(list);
    const ids = Array.from(new Set(list.map((r) => r.performed_by).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: profs } = await (supabase as any)
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      const map: Record<string, string> = {};
      (profs || []).forEach((p: any) => { map[p.id] = p.full_name || ""; });
      setNames(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (r: Row) => {
    if (!canApprove) return;
    if (!window.confirm(`اعتماد تحويل بمبلغ ${fmt(r.amount)} ج.م؟ سيُضاف للخزينة الرئيسية.`)) return;
    setBusy(r.id);
    const { error } = await (supabase as any).rpc("approve_main_warehouse_transfer", { _txn_id: r.id });
    setBusy(null);
    if (error) {
      toast.error(error.message || "تعذر الاعتماد");
      return;
    }
    toast.success("تم اعتماد التحويل وإضافته للخزينة الرئيسية");
    load();
    onReceived?.();
  };

  const reject = async (r: Row) => {
    if (!canApprove) return;
    const reason = window.prompt("سبب الرفض:", "") || "";
    if (!reason.trim()) {
      toast.error("أدخل سبب الرفض");
      return;
    }
    setBusy(r.id);
    const { error } = await (supabase as any).rpc("reject_main_warehouse_transfer", {
      _txn_id: r.id,
      _reason: reason,
    });
    setBusy(null);
    if (error) {
      toast.error(error.message || "تعذر الرفض");
      return;
    }
    toast.success("تم رفض التحويل");
    load();
    onReceived?.();
  };

  if (loading) {
    return (
      <Card className="border-sky-300 bg-sky-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Warehouse className="w-4 h-4" /> تحويلات واردة من خزينة المخزن الرئيسي
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">جاري التحميل...</CardContent>
      </Card>
    );
  }

  if (rows.length === 0) return null;

  return (
    <Card className="border-sky-300 bg-sky-50/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Warehouse className="w-4 h-4 text-sky-700" />
          تحويلات واردة من خزينة المخزن الرئيسي
          <Badge className="bg-amber-500 text-white">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border bg-white p-3 space-y-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="bg-emerald-600 text-white">{fmt(Number(r.amount || 0))} ج.م</Badge>
                  {r.courier_name && (
                    <Badge variant="outline" className="text-xs">المندوب: {r.courier_name}</Badge>
                  )}
                  {r.reference && <span className="text-xs text-muted-foreground">{r.reference}</span>}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  بواسطة: <b>{(r.performed_by && names[r.performed_by]) || "—"}</b> •{" "}
                  {new Date(r.performed_at).toLocaleString("ar-EG")}
                </div>
              </div>
              {canApprove && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={busy === r.id}
                    onClick={() => approve(r)}
                  >
                    {busy === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 ml-1" />}
                    اعتماد
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-rose-700 border-rose-300 hover:bg-rose-50"
                    disabled={busy === r.id}
                    onClick={() => reject(r)}
                  >
                    <XCircle className="w-4 h-4 ml-1" /> رفض
                  </Button>
                </div>
              )}
            </div>
            {r.notes && (
              <pre className="whitespace-pre-wrap text-xs bg-muted/40 rounded p-2 font-sans leading-relaxed">
                {r.notes}
              </pre>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
