import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, RefreshCw, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";

interface Row {
  id: string;
  order_id: string;
  reported_by: string;
  discrepancy_type: "products" | "amount" | "both";
  reporter_note: string | null;
  mega_products_text: string | null;
  mega_amount: number | null;
  status: "open" | "resolved" | "rejected";
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  order?: {
    order_number: string;
    total: number;
    customer_name: string | null;
    customer_phone: string | null;
    shipping_bill_no: string | null;
    items: { product_name: string; quantity: number; is_gift: boolean; offer_name: string | null }[];
  };
  reporter_name?: string;
}

const TYPE_AR: Record<Row["discrepancy_type"], string> = {
  products: "المنتجات",
  amount: "المبلغ",
  both: "المنتجات + المبلغ",
};

export default function MegaOrderDiscrepancies() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "resolved" | "rejected" | "all">("open");
  const [actOn, setActOn] = useState<{ row: Row; action: "resolved" | "rejected" } | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: discs, error } = await supabase
        .from("order_mega_discrepancies")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      const orderIds = Array.from(new Set((discs || []).map((d: any) => d.order_id)));
      const reporterIds = Array.from(new Set((discs || []).map((d: any) => d.reported_by).filter(Boolean)));

      const [{ data: orders }, { data: items }, { data: reporters }] = await Promise.all([
        supabase.from("orders").select("id, order_number, total, shipping_bill_no, customer_id").in("id", orderIds.length ? orderIds : ["00000000-0000-0000-0000-000000000000"]),
        supabase.from("order_items").select("order_id, product_name, quantity, is_gift, offer_name").in("order_id", orderIds.length ? orderIds : ["00000000-0000-0000-0000-000000000000"]),
        supabase.from("profiles").select("id, full_name").in("id", reporterIds.length ? reporterIds : ["00000000-0000-0000-0000-000000000000"]),
      ]);

      const custIds = Array.from(new Set((orders || []).map((o: any) => o.customer_id).filter(Boolean)));
      const { data: customers } = await supabase.from("customers").select("id, name, phone").in("id", custIds.length ? custIds : ["00000000-0000-0000-0000-000000000000"]);

      const custMap = new Map((customers || []).map((c: any) => [c.id, c]));
      const orderMap = new Map(
        (orders || []).map((o: any) => {
          const c = custMap.get(o.customer_id) as any;
          return [
            o.id,
            {
              order_number: o.order_number,
              total: Number(o.total || 0),
              shipping_bill_no: o.shipping_bill_no,
              customer_name: c?.name || null,
              customer_phone: c?.phone || null,
              items: [] as { product_name: string; quantity: number; is_gift: boolean; offer_name: string | null }[],
            },
          ];
        })
      );
      (items || []).forEach((it: any) => {
        const o = orderMap.get(it.order_id) as any;
        if (o) o.items.push({ product_name: it.product_name, quantity: Number(it.quantity), is_gift: !!it.is_gift, offer_name: it.offer_name });
      });
      const reporterMap = new Map((reporters || []).map((r: any) => [r.id, r.full_name]));

      const enriched: Row[] = (discs || []).map((d: any) => ({
        ...d,
        order: orderMap.get(d.order_id) as any,
        reporter_name: reporterMap.get(d.reported_by) as string | undefined,
      }));
      setRows(enriched);
    } catch (err: any) {
      toast.error(err?.message || "فشل التحميل");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const openCount = rows.filter((r) => r.status === "open").length;

  const submitAct = async () => {
    if (!actOn) return;
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("order_mega_discrepancies")
        .update({
          status: actOn.action,
          resolution_note: note.trim() || null,
          resolved_by: userData.user?.id,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", actOn.row.id);
      if (error) throw error;
      toast.success(actOn.action === "resolved" ? "تم إنهاء البلاغ" : "تم رفض البلاغ");
      setActOn(null);
      setNote("");
      load();
    } catch (err: any) {
      toast.error(err?.message || "فشل التحديث");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              بلاغات اختلاف أوردرات ميجا
              {openCount > 0 && <Badge variant="destructive">{openCount} مفتوح</Badge>}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              الأوردرات ال بينا وبين ميجا اختلاف فيها منتجات أو مبلغ — بلاغات من فريق المراجعة.
            </p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="mr-2">تحديث</span>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["open", "resolved", "rejected", "all"] as const).map((f) => (
              <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)}>
                {f === "open" ? "مفتوح" : f === "resolved" ? "تم الحل" : f === "rejected" ? "مرفوض" : "الكل"}
              </Button>
            ))}
            <Badge variant="secondary">{filtered.length}</Badge>
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الأوردر</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>عندنا</TableHead>
                  <TableHead>على ميجا</TableHead>
                  <TableHead>نوع الاختلاف</TableHead>
                  <TableHead>البلاغ</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead className="text-center">إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">لا توجد بلاغات</TableCell></TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.id} className={r.status === "open" ? "bg-amber-50 dark:bg-amber-950/30" : ""}>
                      <TableCell className="font-mono font-semibold">
                        <Link to={`/orders/${r.order_id}`} className="hover:underline flex items-center gap-1">
                          {r.order?.order_number || "—"}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                        {r.order?.shipping_bill_no && (
                          <div className="text-[10px] font-mono text-muted-foreground" dir="ltr">{r.order.shipping_bill_no}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{r.order?.customer_name || "—"}</div>
                        <div className="text-xs text-muted-foreground font-mono" dir="ltr">{r.order?.customer_phone || ""}</div>
                      </TableCell>
                      <TableCell className="max-w-[240px]">
                        <ul className="text-xs space-y-0.5">
                          {(r.order?.items || []).map((it, idx) => (
                            <li key={idx}>
                              {it.offer_name ? <span className="text-purple-600">[{it.offer_name}] </span> : null}
                              {it.product_name} × {it.quantity}
                              {it.is_gift ? " (هدية)" : ""}
                            </li>
                          ))}
                        </ul>
                        <div className="text-xs font-semibold mt-1">{r.order?.total.toLocaleString()} ج</div>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        {r.mega_products_text && <div className="text-xs whitespace-pre-line">{r.mega_products_text}</div>}
                        {r.mega_amount !== null && <div className="text-xs font-semibold mt-1">{Number(r.mega_amount).toLocaleString()} ج</div>}
                        {!r.mega_products_text && r.mega_amount === null && <span className="text-muted-foreground text-xs">لم تدخل</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{TYPE_AR[r.discrepancy_type]}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <div className="text-xs whitespace-pre-line">{r.reporter_note || "—"}</div>
                        <div className="text-[10px] text-muted-foreground mt-1">{r.reporter_name || ""}</div>
                        {r.resolution_note && (
                          <div className="mt-1 text-[11px] text-emerald-700 border-t pt-1">
                            رد: {r.resolution_note}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}</TableCell>
                      <TableCell>
                        {r.status === "open" ? (
                          <div className="flex flex-col gap-1">
                            <Button size="sm" onClick={() => { setActOn({ row: r, action: "resolved" }); setNote(""); }}>
                              <CheckCircle2 className="w-4 h-4 ml-1" />
                              تم الحل
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setActOn({ row: r, action: "rejected" }); setNote(""); }}>
                              <XCircle className="w-4 h-4 ml-1" />
                              رفض
                            </Button>
                          </div>
                        ) : (
                          <Badge variant={r.status === "resolved" ? "default" : "secondary"}>
                            {r.status === "resolved" ? "تم الحل" : "مرفوض"}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!actOn} onOpenChange={(v) => !v && setActOn(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {actOn?.action === "resolved" ? "إنهاء البلاغ" : "رفض البلاغ"} — أوردر {actOn?.row.order?.order_number}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>ملاحظة (اختيارية)</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={actOn?.action === "resolved" ? "مثال: عدّلت المنتجات والمبلغ" : "سبب الرفض…"} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActOn(null)} disabled={submitting}>إلغاء</Button>
            <Button onClick={submitAct} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
              تأكيد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
