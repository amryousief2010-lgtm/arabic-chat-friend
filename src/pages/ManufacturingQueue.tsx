import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, RefreshCw, Factory, Search, ArrowLeft, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Row {
  product_id: string;
  product_name: string;
  unit: string;
  current_stock: number;
  low_stock_threshold: number;
  pending_quantity: number; // total quantity needed for non-completed items in non-cancelled orders
  shortage: number; // pending - current_stock (clamped >= 0)
  affected_orders: { id: string; order_number: string; qty: number; status: string }[];
  priority: "critical" | "high" | "medium" | "low";
}

const ManufacturingQueue = () => {
  const { canManageStock, profile } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [replenishProduct, setReplenishProduct] = useState<Row | null>(null);
  const [replenishQty, setReplenishQty] = useState<string>("");
  const [replenishNotes, setReplenishNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      // Load all active products
      const { data: products, error: pErr } = await supabase
        .from("products")
        .select("id, name, unit, stock, low_stock_threshold, is_active")
        .eq("is_active", true);
      if (pErr) throw pErr;

      // Load all open order items (orders not cancelled, items not completed)
      const { data: items, error: iErr } = await supabase
        .from("order_items")
        .select("id, product_id, product_name, quantity, production_status, order_id, orders!inner(id, order_number, status)")
        .neq("production_status", "completed");
      if (iErr) throw iErr;

      const filteredItems = (items || []).filter(
        (it: any) => it.orders && it.orders.status !== "cancelled"
      );

      const map = new Map<string, Row>();
      (products || []).forEach((p: any) => {
        map.set(p.id, {
          product_id: p.id,
          product_name: p.name,
          unit: p.unit,
          current_stock: p.stock,
          low_stock_threshold: p.low_stock_threshold,
          pending_quantity: 0,
          shortage: 0,
          affected_orders: [],
          priority: "low",
        });
      });

      filteredItems.forEach((it: any) => {
        if (!it.product_id) return;
        const r = map.get(it.product_id);
        if (!r) return;
        const qty = Number(it.quantity);
        r.pending_quantity += qty;
        r.affected_orders.push({
          id: it.orders.id,
          order_number: it.orders.order_number,
          qty,
          status: it.orders.status,
        });
      });

      const result: Row[] = [];
      map.forEach((r) => {
        r.shortage = Math.max(r.pending_quantity - r.current_stock, 0);
        // Priority logic
        if (r.current_stock <= 0 && r.pending_quantity > 0) r.priority = "critical";
        else if (r.shortage > 0) r.priority = "high";
        else if (r.current_stock <= r.low_stock_threshold) r.priority = "medium";
        else r.priority = "low";

        // Only show items needing attention
        if (r.pending_quantity > 0 || r.current_stock <= r.low_stock_threshold) {
          result.push(r);
        }
      });

      // Sort by priority then by shortage desc
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      result.sort((a, b) => {
        if (order[a.priority] !== order[b.priority]) return order[a.priority] - order[b.priority];
        return b.shortage - a.shortage;
      });

      setRows(result);
    } catch (e) {
      console.error(e);
      toast.error("تعذر تحميل قائمة التصنيع");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => rows.filter(r => r.product_name.toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  );

  const stats = useMemo(() => ({
    critical: rows.filter(r => r.priority === "critical").length,
    high: rows.filter(r => r.priority === "high").length,
    medium: rows.filter(r => r.priority === "medium").length,
    totalShortage: rows.reduce((s, r) => s + r.shortage, 0),
  }), [rows]);

  const priorityBadge = (p: Row["priority"]) => {
    const map = {
      critical: { label: "حرجة جدًا", variant: "destructive" as const },
      high: { label: "عالية", variant: "destructive" as const },
      medium: { label: "متوسطة", variant: "warning" as const },
      low: { label: "منخفضة", variant: "secondary" as const },
    };
    return <Badge variant={map[p].variant}>{map[p].label}</Badge>;
  };

  const submitReplenish = async () => {
    if (!replenishProduct) return;
    const qty = Number(replenishQty);
    if (!qty || qty <= 0) { toast.error("أدخل كمية صحيحة"); return; }
    setSubmitting(true);
    try {
      const newStock = replenishProduct.current_stock + qty;
      const { error: upErr } = await supabase
        .from("products")
        .update({ stock: newStock })
        .eq("id", replenishProduct.product_id);
      if (upErr) throw upErr;

      const { error: logErr } = await supabase.from("stock_replenishment_log").insert({
        product_id: replenishProduct.product_id,
        product_name: replenishProduct.product_name,
        previous_stock: replenishProduct.current_stock,
        quantity_added: qty,
        new_stock: newStock,
        performed_by: profile?.id ?? null,
        performed_by_name: profile?.full_name ?? null,
        notes: replenishNotes || null,
      });
      if (logErr) throw logErr;

      toast.success(`تم تزويد المخزون بـ ${qty} ${replenishProduct.unit}`);
      setReplenishProduct(null);
      setReplenishQty("");
      setReplenishNotes("");
      await load();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "فشل تزويد المخزون");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Header
          title="قائمة التصنيع"
          subtitle={`${rows.length} صنف يحتاج توجيه فريق الإنتاج`}
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="glass-card border-destructive/20 bg-destructive/5">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">حرجة جدًا</p>
              <p className="text-2xl font-bold text-destructive">{stats.critical}</p>
            </CardContent>
          </Card>
          <Card className="glass-card border-destructive/20">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">عجز للطلبات</p>
              <p className="text-2xl font-bold">{stats.high}</p>
            </CardContent>
          </Card>
          <Card className="glass-card border-warning/20 bg-warning/5">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">منخفضة</p>
              <p className="text-2xl font-bold text-warning">{stats.medium}</p>
            </CardContent>
          </Card>
          <Card className="glass-card border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">إجمالي العجز</p>
              <p className="text-2xl font-bold text-primary">{stats.totalShortage}</p>
            </CardContent>
          </Card>
        </div>

        <Card className="glass-card">
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-3 justify-between">
              <CardTitle className="flex items-center gap-2">
                <Factory className="w-5 h-5 text-primary" />
                الأصناف المطلوب تصنيعها (مرتبة حسب الأولوية)
              </CardTitle>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pr-9 w-56"
                  />
                </div>
                <Button variant="outline" size="icon" onClick={load} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                لا توجد أصناف تحتاج تصنيع حاليًا
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الصنف</TableHead>
                      <TableHead className="text-center">المخزون</TableHead>
                      <TableHead className="text-center">المطلوب</TableHead>
                      <TableHead className="text-center">العجز</TableHead>
                      <TableHead className="text-center">الطلبات</TableHead>
                      <TableHead className="text-center">الأولوية</TableHead>
                      <TableHead className="text-center">إجراء</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(r => (
                      <TableRow key={r.product_id} className="hover:bg-muted/50">
                        <TableCell className="font-medium">{r.product_name}</TableCell>
                        <TableCell className="text-center">
                          <span className={r.current_stock <= 0 ? "text-destructive font-bold" : ""}>
                            {r.current_stock} {r.unit}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">{r.pending_quantity} {r.unit}</TableCell>
                        <TableCell className="text-center font-bold text-destructive">
                          {r.shortage > 0 ? `${r.shortage} ${r.unit}` : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {r.affected_orders.length > 0 ? (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-primary">
                                {r.affected_orders.length} طلب
                              </summary>
                              <div className="mt-2 space-y-1 text-right max-w-xs">
                                {r.affected_orders.slice(0, 10).map(o => (
                                  <Link
                                    key={o.id}
                                    to={`/orders/${o.id}`}
                                    className="flex justify-between gap-2 hover:bg-muted/50 px-2 py-1 rounded"
                                  >
                                    <span>{o.order_number}</span>
                                    <span className="text-muted-foreground">{o.qty} {r.unit}</span>
                                  </Link>
                                ))}
                                {r.affected_orders.length > 10 && (
                                  <p className="text-muted-foreground text-center">+{r.affected_orders.length - 10}</p>
                                )}
                              </div>
                            </details>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-center">{priorityBadge(r.priority)}</TableCell>
                        <TableCell className="text-center">
                          {canManageStock && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setReplenishProduct(r);
                                setReplenishQty(String(r.shortage > 0 ? r.shortage : r.low_stock_threshold));
                              }}
                            >
                              <Plus className="w-4 h-4" />
                              تزويد
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Link to="/stock-replenishment-log">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              سجل تزويد المخزون
            </Button>
          </Link>
        </div>
      </div>

      <Dialog open={!!replenishProduct} onOpenChange={(o) => !o && setReplenishProduct(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تزويد مخزون: {replenishProduct?.product_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              المخزون الحالي: <strong>{replenishProduct?.current_stock} {replenishProduct?.unit}</strong>
              {replenishProduct && replenishProduct.shortage > 0 && (
                <> · العجز للطلبات: <strong className="text-destructive">{replenishProduct.shortage}</strong></>
              )}
            </div>
            <div>
              <Label>الكمية المضافة</Label>
              <Input
                type="number"
                value={replenishQty}
                onChange={e => setReplenishQty(e.target.value)}
                min={1}
              />
            </div>
            <div>
              <Label>ملاحظات (اختياري)</Label>
              <Input
                value={replenishNotes}
                onChange={e => setReplenishNotes(e.target.value)}
                placeholder="مثلاً: دفعة تصنيع رقم..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplenishProduct(null)}>إلغاء</Button>
            <Button onClick={submitReplenish} disabled={submitting}>
              {submitting ? "جاري التزويد..." : "تأكيد التزويد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default ManufacturingQueue;
