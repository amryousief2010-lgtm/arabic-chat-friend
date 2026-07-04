import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertTriangle, RefreshCw, Package } from "lucide-react";
import { format } from "date-fns";

interface OrderRow {
  id: string;
  order_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  total: number;
  total_at_delivery: number | null;
  status: string;
  shipping_bill_no: string | null;
  shipping_company: string | null;
  created_at: string;
  moderator: string | null;
  items: { product_name: string; quantity: number; unit_price: number; total_price: number; is_gift: boolean; offer_name: string | null }[];
  reviewed: boolean;
  has_open_flag: boolean;
}

export default function MegaOrdersReview() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"unreviewed" | "reviewed" | "flagged" | "all">("unreviewed");
  const [search, setSearch] = useState("");
  const [flagFor, setFlagFor] = useState<OrderRow | null>(null);
  const [flagType, setFlagType] = useState<"products" | "amount" | "both">("products");
  const [flagNote, setFlagNote] = useState("");
  const [megaProducts, setMegaProducts] = useState("");
  const [megaAmount, setMegaAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      // Recent orders (last 30 days) — reviewer works on fresh orders
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data: ordersData, error: e1 } = await supabase
        .from("orders")
        .select("id, order_number, status, total, total_at_delivery, shipping_bill_no, shipping_company, created_at, moderator, customer_id")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      if (e1) throw e1;

      const orderIds = (ordersData || []).map((o: any) => o.id);
      const custIds = Array.from(new Set((ordersData || []).map((o: any) => o.customer_id).filter(Boolean)));

      const [{ data: items }, { data: customers }, { data: reviewed }, { data: flags }] = await Promise.all([
        supabase.from("order_items").select("order_id, product_name, quantity, unit_price, total_price, is_gift, offer_name").in("order_id", orderIds.length ? orderIds : ["00000000-0000-0000-0000-000000000000"]),
        supabase.from("customers").select("id, name, phone").in("id", custIds.length ? custIds : ["00000000-0000-0000-0000-000000000000"]),
        user ? supabase.from("order_review_status").select("order_id, is_reviewed").in("order_id", orderIds.length ? orderIds : ["00000000-0000-0000-0000-000000000000"]).eq("user_id", user.id) : Promise.resolve({ data: [] as any[] }),
        supabase.from("order_mega_discrepancies").select("order_id, status").in("order_id", orderIds.length ? orderIds : ["00000000-0000-0000-0000-000000000000"]).eq("status", "open"),
      ]);

      const itemsByOrder = new Map<string, OrderRow["items"]>();
      (items || []).forEach((it: any) => {
        const arr = itemsByOrder.get(it.order_id) || [];
        arr.push({ product_name: it.product_name, quantity: Number(it.quantity), unit_price: Number(it.unit_price), total_price: Number(it.total_price), is_gift: !!it.is_gift, offer_name: it.offer_name });
        itemsByOrder.set(it.order_id, arr);
      });
      const custMap = new Map((customers || []).map((c: any) => [c.id, c]));
      const reviewedSet = new Set((reviewed || []).filter((r: any) => r.is_reviewed).map((r: any) => r.order_id));
      const flaggedSet = new Set((flags || []).map((f: any) => f.order_id));

      const rows: OrderRow[] = (ordersData || []).map((o: any) => {
        const c = custMap.get(o.customer_id) as any;
        return {
          id: o.id,
          order_number: o.order_number,
          customer_name: c?.name || null,
          customer_phone: c?.phone || null,
          total: Number(o.total || 0),
          total_at_delivery: o.total_at_delivery !== null ? Number(o.total_at_delivery) : null,
          status: o.status,
          shipping_bill_no: o.shipping_bill_no,
          shipping_company: o.shipping_company,
          created_at: o.created_at,
          moderator: o.moderator,
          items: itemsByOrder.get(o.id) || [],
          reviewed: reviewedSet.has(o.id),
          has_open_flag: flaggedSet.has(o.id),
        };
      });
      setOrders(rows);
    } catch (err: any) {
      toast.error(err?.message || "فشل تحميل الأوردرات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const filtered = useMemo(() => {
    let list = orders;
    if (filter === "unreviewed") list = list.filter((o) => !o.reviewed && !o.has_open_flag);
    else if (filter === "reviewed") list = list.filter((o) => o.reviewed);
    else if (filter === "flagged") list = list.filter((o) => o.has_open_flag);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (o) =>
          o.order_number?.toLowerCase().includes(q) ||
          o.customer_name?.toLowerCase().includes(q) ||
          o.customer_phone?.toLowerCase().includes(q) ||
          o.shipping_bill_no?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [orders, filter, search]);

  const markReviewed = async (order: OrderRow) => {
    if (!user) return;
    const { error } = await supabase
      .from("order_review_status")
      .upsert(
        { order_id: order.id, user_id: user.id, is_reviewed: true, reviewed_at: new Date().toISOString() },
        { onConflict: "order_id,user_id" }
      );
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`تمت مراجعة أوردر ${order.order_number} ✓`);
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, reviewed: true } : o)));
  };

  const openFlag = (order: OrderRow) => {
    setFlagFor(order);
    setFlagType("products");
    setFlagNote("");
    setMegaProducts("");
    setMegaAmount("");
  };

  const submitFlag = async () => {
    if (!flagFor || !user) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("order_mega_discrepancies").insert({
        order_id: flagFor.id,
        reported_by: user.id,
        discrepancy_type: flagType,
        reporter_note: flagNote.trim() || null,
        mega_products_text: megaProducts.trim() || null,
        mega_amount: megaAmount.trim() ? Number(megaAmount) : null,
      });
      if (error) throw error;
      toast.success("تم إرسال إشعار الاختلاف لـ م. آلاء حامد");
      setFlagFor(null);
      setOrders((prev) => prev.map((o) => (o.id === flagFor.id ? { ...o, has_open_flag: true } : o)));
    } catch (err: any) {
      toast.error(err?.message || "فشل إرسال الإشعار");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-xl">مراجعة أوردرات ميجا</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              افتحى نفس الأوردر على ميجا وقارنى المنتجات والمبلغ. لو مطابق اضغطى «تمت المراجعة»، ولو فيه اختلاف اضغطى «أبلغى عن اختلاف».
            </p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="mr-2">تحديث</span>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(["unreviewed", "flagged", "reviewed", "all"] as const).map((f) => (
              <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)}>
                {f === "unreviewed" ? "لسه لم تراجع" : f === "flagged" ? "بها اختلاف مفتوح" : f === "reviewed" ? "تمت المراجعة" : "الكل"}
              </Button>
            ))}
            <div className="flex-1 min-w-[200px]">
              <Input placeholder="بحث برقم الأوردر / العميل / التليفون / البوليصة…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Badge variant="secondary">{filtered.length} أوردر</Badge>
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الأوردر</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>المنتجات (عندنا)</TableHead>
                  <TableHead>الإجمالى</TableHead>
                  <TableHead>البوليصة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead className="text-center">إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">لا توجد أوردرات</TableCell></TableRow>
                ) : (
                  filtered.map((o) => (
                    <TableRow key={o.id} className={o.has_open_flag ? "bg-amber-50 dark:bg-amber-950/30" : o.reviewed ? "bg-emerald-50/40 dark:bg-emerald-950/20" : ""}>
                      <TableCell className="font-mono font-semibold">
                        {o.order_number}
                        {o.reviewed && <CheckCircle2 className="inline w-4 h-4 text-emerald-600 mr-1" />}
                        {o.has_open_flag && <AlertTriangle className="inline w-4 h-4 text-amber-600 mr-1" />}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{o.customer_name || "—"}</div>
                        <div className="text-xs text-muted-foreground font-mono" dir="ltr">{o.customer_phone || ""}</div>
                      </TableCell>
                      <TableCell className="max-w-[280px]">
                        <ul className="text-xs space-y-0.5">
                          {o.items.length === 0 && <li className="text-muted-foreground">—</li>}
                          {o.items.map((it, idx) => (
                            <li key={idx} className="flex items-start gap-1">
                              <Package className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
                              <span>
                                {it.offer_name ? <span className="text-purple-600">[{it.offer_name}] </span> : null}
                                {it.product_name} × {it.quantity}
                                {it.is_gift ? <Badge variant="outline" className="mr-1 text-[10px]">هدية</Badge> : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                      <TableCell className="font-mono">
                        {o.total.toLocaleString()} ج
                        {o.total_at_delivery !== null && Math.abs(o.total_at_delivery - o.total) > 0.01 && (
                          <div className="text-xs text-amber-600">تسليم: {o.total_at_delivery.toLocaleString()} ج</div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs" dir="ltr">{o.shipping_bill_no || "—"}</TableCell>
                      <TableCell className="text-xs">{format(new Date(o.created_at), "yyyy-MM-dd HH:mm")}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 items-stretch">
                          <Button size="sm" variant={o.reviewed ? "secondary" : "default"} onClick={() => markReviewed(o)} disabled={o.reviewed}>
                            <CheckCircle2 className="w-4 h-4 ml-1" />
                            {o.reviewed ? "تمت المراجعة" : "مطابق"}
                          </Button>
                          <Button size="sm" variant="outline" className="border-amber-500 text-amber-700 hover:bg-amber-50" onClick={() => openFlag(o)} disabled={o.has_open_flag}>
                            <AlertTriangle className="w-4 h-4 ml-1" />
                            {o.has_open_flag ? "تم الإبلاغ" : "فيه اختلاف"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!flagFor} onOpenChange={(v) => !v && setFlagFor(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إبلاغ عن اختلاف — أوردر {flagFor?.order_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>نوع الاختلاف</Label>
              <RadioGroup value={flagType} onValueChange={(v) => setFlagType(v as any)} className="flex gap-4 mt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="products" id="ft-p" />
                  <span>المنتجات</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="amount" id="ft-a" />
                  <span>المبلغ</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="both" id="ft-b" />
                  <span>الاتنين</span>
                </label>
              </RadioGroup>
            </div>

            {(flagType === "products" || flagType === "both") && (
              <div>
                <Label>المنتجات على ميجا (اختيارى)</Label>
                <Textarea placeholder="اكتبى المنتجات و الكميات زى ما ظاهرة على ميجا…" value={megaProducts} onChange={(e) => setMegaProducts(e.target.value)} rows={3} />
              </div>
            )}
            {(flagType === "amount" || flagType === "both") && (
              <div>
                <Label>المبلغ على ميجا (اختيارى)</Label>
                <Input type="number" inputMode="decimal" placeholder="مثال: 1500" value={megaAmount} onChange={(e) => setMegaAmount(e.target.value)} />
              </div>
            )}

            <div>
              <Label>ملاحظات إضافية</Label>
              <Textarea placeholder="أى تفاصيل تفيد المهندسة آلاء…" value={flagNote} onChange={(e) => setFlagNote(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFlagFor(null)} disabled={submitting}>إلغاء</Button>
            <Button onClick={submitFlag} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
              إرسال الإشعار
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
