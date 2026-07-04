import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { format } from "date-fns";
import { ExternalLink, RefreshCw, Check, X, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface MissingRow {
  id: string;
  bill_no: string;
  customer_name: string | null;
  customer_phone: string | null;
  region: string | null;
  cod_amount: number | null;
  moderator_name: string | null;
  zodex_status: string | null;
  operation_type: string | null;
  shipment_date: string | null;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
}

interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  total_rows: number;
  delivered_matched: number;
  returned_matched: number;
  missing_created: number;
  missing_updated: number;
  error_message: string | null;
}

export default function ZodexMissingOrders() {
  const [rows, setRows] = useState<MissingRow[]>([]);
  const [lastRun, setLastRun] = useState<RunRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [ignoreDialog, setIgnoreDialog] = useState<MissingRow | null>(null);
  const [ignoreReason, setIgnoreReason] = useState("");

  const load = async () => {
    setLoading(true);
    const [{ data: missing }, { data: runs }] = await Promise.all([
      supabase.from("zodex_missing_orders").select("*").eq("status", "pending").order("shipment_date", { ascending: false }).limit(200),
      supabase.from("zodex_sync_runs").select("*").order("started_at", { ascending: false }).limit(1),
    ]);
    setRows((missing as MissingRow[]) || []);
    setLastRun((runs?.[0] as RunRow) || null);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const runSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-zodex-deliveries", {
        body: { lookback_days: 14, max_pages: 5 },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "فشلت المزامنة");
      toast.success(`تمت المزامنة: ${data.delivered_matched} تسليم • ${data.missing_created} مفقود جديد`);
      load();
    } catch (e: any) {
      toast.error(`فشلت المزامنة: ${e.message || e}`);
    } finally {
      setSyncing(false);
    }
  };

  const doIgnore = async () => {
    if (!ignoreDialog) return;
    const { error } = await supabase.from("zodex_missing_orders")
      .update({ status: "ignored", ignored_reason: ignoreReason || null, resolved_at: new Date().toISOString() })
      .eq("id", ignoreDialog.id);
    if (error) return toast.error(error.message);
    toast.success("تم التجاهل");
    setIgnoreDialog(null);
    setIgnoreReason("");
    load();
  };

  const markResolved = async (row: MissingRow) => {
    const { error } = await supabase.from("zodex_missing_orders")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("تم التعليم كمحلولة (البنت هتسجل الأوردر)");
    load();
  };

  return (
    <div className="container mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">أوردرات زودكس غير المسجلة</h1>
          <p className="text-sm text-muted-foreground">أوردرات مسجلة على زودكس ومش موجودة عندنا - تنبيه من المزامنة الآلية.</p>
        </div>
        <div className="flex items-center gap-2">
          {lastRun && (
            <span className="text-xs text-muted-foreground">
              آخر مزامنة: {format(new Date(lastRun.started_at), "yyyy-MM-dd HH:mm")}
              {" • "}تسليم: {lastRun.delivered_matched} • مفقود: {lastRun.missing_created}
            </span>
          )}
          <Button size="sm" onClick={runSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <RefreshCw className="h-4 w-4 ml-1" />}
            مزامنة الآن
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">القائمة ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">جارِ التحميل...</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">🎉 مفيش أوردرات مفقودة</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم البوليصة</TableHead>
                  <TableHead>تليفون العميل</TableHead>
                  <TableHead>الموديرتور</TableHead>
                  <TableHead>المنطقة</TableHead>
                  <TableHead className="text-left">القيمة</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>تاريخ الشحن</TableHead>
                  <TableHead className="text-center">إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">
                      <a href={`https://zodex-eg.com/admin-area/shippings.php?action=details&waybill=${r.bill_no}`}
                         target="_blank" rel="noreferrer"
                         className="inline-flex items-center gap-1 text-primary hover:underline">
                        {r.bill_no}<ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell className="font-mono">{r.customer_phone || "—"}</TableCell>
                    <TableCell>{r.moderator_name || "—"}</TableCell>
                    <TableCell>{r.region || "—"}</TableCell>
                    <TableCell className="text-left tabular-nums">{Number(r.cod_amount || 0).toLocaleString("ar-EG")}</TableCell>
                    <TableCell>
                      <Badge variant={r.operation_type === "مرتجعات" ? "destructive" : "secondary"}>
                        {r.operation_type || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.shipment_date ? format(new Date(r.shipment_date), "yyyy-MM-dd HH:mm") : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-center">
                        <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => markResolved(r)} title="البنت سجلت الأوردر">
                          <Check className="h-3.5 w-3.5" />تم التسجيل
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setIgnoreDialog(r)} title="مش تبع نعام العاصمة">
                          <X className="h-3.5 w-3.5" />تجاهل
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!ignoreDialog} onOpenChange={(o) => !o && setIgnoreDialog(null)}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تجاهل الأوردر</DialogTitle></DialogHeader>
          <p className="text-sm">بوليصة {ignoreDialog?.bill_no}</p>
          <Textarea placeholder="السبب (اختياري)" value={ignoreReason} onChange={(e) => setIgnoreReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoreDialog(null)}>إلغاء</Button>
            <Button onClick={doIgnore}>تأكيد التجاهل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
