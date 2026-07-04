import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, ArrowLeft, Package, Wallet } from "lucide-react";

const ALAA_USER_ID = "77b71c5f-cfa8-42bc-85de-ae536a3ec1c1";
const SESSION_KEY = "mega_discrepancy_dismissed_at";
const LAST_SEEN_KEY = "mega_discrepancy_last_seen_total";

type OpenRow = {
  id: string;
  order_id: string;
  discrepancy_type: "products" | "amount" | "both";
  reporter_note: string | null;
  mega_products_text: string | null;
  mega_amount: number | null;
  created_at: string;
  order?: {
    order_number: string;
    total: number;
    customer_name: string | null;
    shipping_bill_no: string | null;
  };
};

const TYPE_LABEL: Record<OpenRow["discrepancy_type"], string> = {
  products: "المنتجات",
  amount: "المبلغ",
  both: "المنتجات + المبلغ",
};

export default function MegaDiscrepancyAlert() {
  const { user, isGeneralManager, isExecutiveManager } = useAuth();
  const navigate = useNavigate();
  const isAudience = !!user && (user.id === ALAA_USER_ID || isGeneralManager || isExecutiveManager);
  const [open, setOpen] = useState(false);
  const lastTotalRef = useRef<number>(-1);

  const { data: rows = [] } = useQuery({
    queryKey: ["mega-discrepancies-open"],
    enabled: isAudience,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_mega_discrepancies")
        .select("id, order_id, discrepancy_type, reporter_note, mega_products_text, mega_amount, created_at")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const ids = (data || []).map((d: any) => d.order_id);
      if (ids.length === 0) return [] as OpenRow[];
      const { data: orders } = await supabase
        .from("orders")
        .select("id, order_number, total, shipping_bill_no, customer_id")
        .in("id", ids);
      const custIds = Array.from(new Set((orders || []).map((o: any) => o.customer_id).filter(Boolean)));
      const { data: customers } = custIds.length
        ? await supabase.from("customers").select("id, name").in("id", custIds)
        : { data: [] as any[] };
      const custMap = new Map((customers || []).map((c: any) => [c.id, c.name]));
      const orderMap = new Map(
        (orders || []).map((o: any) => [
          o.id,
          {
            order_number: o.order_number,
            total: Number(o.total || 0),
            shipping_bill_no: o.shipping_bill_no,
            customer_name: (custMap.get(o.customer_id) as string) || null,
          },
        ])
      );
      return (data || []).map((d: any) => ({ ...d, order: orderMap.get(d.order_id) })) as OpenRow[];

    },
  });

  const count = rows.length;

  // Auto-open once per session when there are open discrepancies
  useEffect(() => {
    if (!isAudience || count === 0) return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    setOpen(true);
  }, [isAudience, count]);

  // Toast on new incoming discrepancy while app is open
  useEffect(() => {
    if (!isAudience) return;
    if (lastTotalRef.current === -1) {
      lastTotalRef.current = count;
      sessionStorage.setItem(LAST_SEEN_KEY, String(count));
      return;
    }
    if (count > lastTotalRef.current) {
      toast.warning("بلاغ اختلاف أوردر جديد من فريق المراجعة", {
        description: `إجمالى البلاغات المفتوحة: ${count}`,
        action: { label: "عرض", onClick: () => setOpen(true) },
      });
    }
    lastTotalRef.current = count;
    sessionStorage.setItem(LAST_SEEN_KEY, String(count));
  }, [count, isAudience]);

  if (!isAudience) return null;

  const dismiss = () => {
    sessionStorage.setItem(SESSION_KEY, new Date().toISOString());
    setOpen(false);
  };

  const goToInbox = () => {
    dismiss();
    navigate("/orders/mega-discrepancies");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : dismiss())}>
      <DialogContent dir="rtl" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-5 h-5" />
            بلاغات اختلاف أوردرات ميجا
            <Badge variant="destructive">{count}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {rows.slice(0, 15).map((r) => (
            <Card key={r.id} className="border-amber-200">
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono font-semibold">
                    {r.order?.order_number || "—"}
                    {r.order?.shipping_bill_no && (
                      <span className="text-[10px] font-mono text-muted-foreground mr-2" dir="ltr">
                        {r.order.shipping_bill_no}
                      </span>
                    )}
                  </div>
                  <Badge variant="outline" className="border-amber-400 text-amber-800">
                    {r.discrepancy_type === "amount" ? <Wallet className="w-3 h-3 ml-1" /> : <Package className="w-3 h-3 ml-1" />}
                    {TYPE_LABEL[r.discrepancy_type]}
                  </Badge>
                </div>
                <div className="text-sm">{r.order?.customer_name || "—"} • {r.order?.total.toLocaleString()} ج</div>
                {r.reporter_note && <div className="text-xs text-muted-foreground">{r.reporter_note}</div>}
                {(r.mega_products_text || r.mega_amount !== null) && (
                  <div className="text-xs bg-amber-50 dark:bg-amber-950/30 rounded p-2 mt-1">
                    <div className="font-semibold mb-0.5">على ميجا:</div>
                    {r.mega_products_text && <div className="whitespace-pre-line">{r.mega_products_text}</div>}
                    {r.mega_amount !== null && <div className="font-mono">{Number(r.mega_amount).toLocaleString()} ج</div>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {rows.length > 15 && (
            <div className="text-center text-sm text-muted-foreground">
              و {rows.length - 15} بلاغ آخر…
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={dismiss}>تجاهل الآن</Button>
          <Button onClick={goToInbox}>
            فتح شاشة البلاغات
            <ArrowLeft className="w-4 h-4 mr-1" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
