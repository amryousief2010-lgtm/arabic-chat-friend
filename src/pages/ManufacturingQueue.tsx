import { useState, useEffect, useMemo, Fragment } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, RefreshCw, Factory, Search, ArrowLeft, Plus, FileDown, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type MfgStatus = "pending" | "in_progress" | "completed";

interface AffectedOrder {
  order_id: string;
  order_number: string;
  qty: number;
  status: string;
  created_at: string;
}

interface Row {
  product_id: string;
  product_name: string;
  unit: string;
  current_stock: number;
  low_stock_threshold: number;
  pending_quantity: number;
  shortage: number;
  oldest_order_at: string | null;
  affected_orders: AffectedOrder[];
  priority: "critical" | "high" | "medium" | "low";
  mfg_status: MfgStatus;
}

const ManufacturingQueue = () => {
  const { canManageStock, profile } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("priority");
  const [replenishProduct, setReplenishProduct] = useState<Row | null>(null);
  const [replenishQty, setReplenishQty] = useState<string>("");
  const [replenishPrice, setReplenishPrice] = useState<string>("");
  const [replenishRef, setReplenishRef] = useState<string>("");
  const [replenishNotes, setReplenishNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const { data: products, error: pErr } = await supabase
        .from("products")
        .select("id, name, unit, stock, low_stock_threshold, is_active")
        .eq("is_active", true);
      if (pErr) throw pErr;

      const { data: items, error: iErr } = await supabase
        .from("order_items")
        .select("id, product_id, product_name, quantity, production_status, order_id, orders!inner(id, order_number, status, created_at)")
        .neq("production_status", "completed");
      if (iErr) throw iErr;

      const filteredItems = (items || []).filter(
        (it: any) => it.orders && it.orders.status !== "cancelled"
      );

      const { data: statuses } = await (supabase as any)
        .from("manufacturing_status")
        .select("product_id, status");
      const statusMap = new Map<string, MfgStatus>();
      (statuses || []).forEach((s: any) => statusMap.set(s.product_id, s.status));

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
          oldest_order_at: null,
          affected_orders: [],
          priority: "low",
          mfg_status: statusMap.get(p.id) || "pending",
        });
      });

      filteredItems.forEach((it: any) => {
        if (!it.product_id) return;
        const r = map.get(it.product_id);
        if (!r) return;
        const qty = Number(it.quantity);
        r.pending_quantity += qty;
        r.affected_orders.push({
          order_id: it.orders.id,
          order_number: it.orders.order_number,
          qty,
          status: it.orders.status,
          created_at: it.orders.created_at,
        });
        if (!r.oldest_order_at || it.orders.created_at < r.oldest_order_at) {
          r.oldest_order_at = it.orders.created_at;
        }
      });

      const result: Row[] = [];
      map.forEach((r) => {
        r.shortage = Math.max(r.pending_quantity - r.current_stock, 0);
        if (r.current_stock <= 0 && r.pending_quantity > 0) r.priority = "critical";
        else if (r.shortage > 0) r.priority = "high";
        else if (r.current_stock <= r.low_stock_threshold) r.priority = "medium";
        else r.priority = "low";

        if (r.pending_quantity > 0 || r.current_stock <= r.low_stock_threshold) {
          result.push(r);
        }
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

  const filtered = useMemo(() => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    let arr = rows.filter(r => r.product_name.toLowerCase().includes(search.toLowerCase()));
    if (priorityFilter !== "all") arr = arr.filter(r => r.priority === priorityFilter);
    if (statusFilter !== "all") arr = arr.filter(r => r.mfg_status === statusFilter);

    arr = [...arr].sort((a, b) => {
      switch (sortBy) {
        case "shortage_desc": return b.shortage - a.shortage;
        case "shortage_asc": return a.shortage - b.shortage;
        case "oldest": {
          const ax = a.oldest_order_at || "9999";
          const bx = b.oldest_order_at || "9999";
          return ax.localeCompare(bx);
        }
        case "newest": {
          const ax = a.oldest_order_at || "0";
          const bx = b.oldest_order_at || "0";
          return bx.localeCompare(ax);
        }
        case "priority":
        default:
          if (order[a.priority] !== order[b.priority]) return order[a.priority] - order[b.priority];
          return b.shortage - a.shortage;
      }
    });
    return arr;
  }, [rows, search, priorityFilter, statusFilter, sortBy]);

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

  const statusLabel: Record<MfgStatus, string> = {
    pending: "مطلوب",
    in_progress: "تم البدء",
    completed: "اكتمل",
  };

  const updateStatus = async (productId: string, newStatus: MfgStatus) => {
    try {
      const { error } = await (supabase as any)
        .from("manufacturing_status")
        .upsert({
          product_id: productId,
          status: newStatus,
          updated_by: profile?.id ?? null,
          updated_by_name: profile?.full_name ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "product_id" });
      if (error) throw error;
      setRows(prev => prev.map(r => r.product_id === productId ? { ...r, mfg_status: newStatus } : r));
      toast.success("تم تحديث الحالة");
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "فشل تحديث الحالة");
    }
  };

  const submitReplenish = async () => {
    if (!replenishProduct) return;
    const qty = Number(replenishQty);
    const price = Number(replenishPrice || 0);
    if (!qty || qty <= 0) { toast.error("أدخل كمية صحيحة"); return; }
    setSubmitting(true);
    try {
      const newStock = replenishProduct.current_stock + qty;
      const { error: upErr } = await supabase
        .from("products")
        .update({ stock: newStock })
        .eq("id", replenishProduct.product_id);
      if (upErr) throw upErr;

      const { error: logErr } = await (supabase as any).from("stock_replenishment_log").insert({
        product_id: replenishProduct.product_id,
        product_name: replenishProduct.product_name,
        previous_stock: replenishProduct.current_stock,
        quantity_added: qty,
        new_stock: newStock,
        unit_price: price,
        supplier_reference: replenishRef || null,
        performed_by: profile?.id ?? null,
        performed_by_name: profile?.full_name ?? null,
        notes: replenishNotes || null,
      });
      if (logErr) throw logErr;

      // Auto-update manufacturing status
      const newStatus: MfgStatus = newStock >= replenishProduct.pending_quantity ? "completed" : "in_progress";
      await (supabase as any).from("manufacturing_status").upsert({
        product_id: replenishProduct.product_id,
        status: newStatus,
        updated_by: profile?.id ?? null,
        updated_by_name: profile?.full_name ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "product_id" });

      toast.success(`تم تزويد المخزون بـ ${qty} ${replenishProduct.unit}`);
      setReplenishProduct(null);
      setReplenishQty(""); setReplenishPrice(""); setReplenishRef(""); setReplenishNotes("");
      await load();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "فشل تزويد المخزون");
    } finally {
      setSubmitting(false);
    }
  };

  const exportCsv = () => {
    if (filtered.length === 0) { toast.error("لا توجد بيانات"); return; }
    const header = ["الصنف","الوحدة","المخزون","المطلوب","العجز","عدد الطلبات","أقدم طلب","الأولوية","الحالة"];
    const lines = [header.join(",")];
    filtered.forEach(r => {
      lines.push([
        `"${r.product_name}"`, r.unit, r.current_stock, r.pending_quantity, r.shortage,
        r.affected_orders.length,
        r.oldest_order_at ? new Date(r.oldest_order_at).toLocaleDateString("ar-EG") : "-",
        r.priority, statusLabel[r.mfg_status],
      ].join(","));
    });
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `قائمة-التصنيع-${new Date().toISOString().split("T")[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("تم تصدير CSV");
  };

  const exportPdf = () => {
    if (filtered.length === 0) { toast.error("لا توجد بيانات"); return; }
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text(`Manufacturing Queue - ${new Date().toLocaleDateString("en-GB")}`, 14, 14);
    autoTable(doc, {
      startY: 20,
      head: [["Product","Unit","Stock","Required","Shortage","Orders","Oldest","Priority","Status"]],
      body: filtered.map(r => [
        r.product_name, r.unit, r.current_stock, r.pending_quantity, r.shortage,
        r.affected_orders.length,
        r.oldest_order_at ? new Date(r.oldest_order_at).toLocaleDateString("en-GB") : "-",
        r.priority, r.mfg_status,
      ]),
      styles: { fontSize: 8 },
    });
    doc.save(`manufacturing-queue-${new Date().toISOString().split("T")[0]}.pdf`);
    toast.success("تم تصدير PDF");
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
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-3 justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Factory className="w-5 h-5 text-primary" />
                  الأصناف المطلوب تصنيعها
                </CardTitle>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2">
                    <FileDown className="w-4 h-4" /> CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportPdf} className="gap-2">
                    <FileText className="w-4 h-4" /> PDF
                  </Button>
                  <Button variant="outline" size="icon" onClick={load} disabled={loading}>
                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="بحث..." value={search} onChange={e => setSearch(e.target.value)} className="pr-9" />
                </div>
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="الأولوية" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الأولويات</SelectItem>
                    <SelectItem value="critical">حرجة جدًا</SelectItem>
                    <SelectItem value="high">عالية</SelectItem>
                    <SelectItem value="medium">متوسطة</SelectItem>
                    <SelectItem value="low">منخفضة</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="الحالة" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الحالات</SelectItem>
                    <SelectItem value="pending">مطلوب</SelectItem>
                    <SelectItem value="in_progress">تم البدء</SelectItem>
                    <SelectItem value="completed">اكتمل</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="ترتيب" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="priority">حسب الأولوية</SelectItem>
                    <SelectItem value="shortage_desc">العجز (الأكبر)</SelectItem>
                    <SelectItem value="shortage_asc">العجز (الأقل)</SelectItem>
                    <SelectItem value="oldest">أقدم طلب أولاً</SelectItem>
                    <SelectItem value="newest">أحدث طلب أولاً</SelectItem>
                  </SelectContent>
                </Select>
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
                لا توجد أصناف مطابقة
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
                      <TableHead className="text-center">أقدم طلب</TableHead>
                      <TableHead className="text-center">الطلبات</TableHead>
                      <TableHead className="text-center">الأولوية</TableHead>
                      <TableHead className="text-center">الحالة</TableHead>
                      <TableHead className="text-center">إجراء</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(r => (
                      <>
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
                          <TableCell className="text-center text-xs">
                            {r.oldest_order_at ? new Date(r.oldest_order_at).toLocaleDateString("ar-EG") : "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            {r.affected_orders.length > 0 ? (
                              <Button
                                size="sm" variant="ghost"
                                onClick={() => setExpanded(prev => ({ ...prev, [r.product_id]: !prev[r.product_id] }))}
                              >
                                {r.affected_orders.length} طلب
                              </Button>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="text-center">{priorityBadge(r.priority)}</TableCell>
                          <TableCell className="text-center">
                            {canManageStock ? (
                              <Select value={r.mfg_status} onValueChange={(v) => updateStatus(r.product_id, v as MfgStatus)}>
                                <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="pending">مطلوب</SelectItem>
                                  <SelectItem value="in_progress">تم البدء</SelectItem>
                                  <SelectItem value="completed">اكتمل</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge variant="outline">{statusLabel[r.mfg_status]}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {canManageStock && (
                              <Button
                                size="sm" variant="outline"
                                onClick={() => {
                                  setReplenishProduct(r);
                                  setReplenishQty(String(r.shortage > 0 ? r.shortage : r.low_stock_threshold));
                                }}
                              >
                                <Plus className="w-4 h-4" /> تزويد
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                        {expanded[r.product_id] && r.affected_orders.length > 0 && (
                          <TableRow key={`${r.product_id}-details`} className="bg-muted/20">
                            <TableCell colSpan={9}>
                              <div className="p-3">
                                <div className="text-xs text-muted-foreground mb-2">الطلبات المتأثرة:</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                  {r.affected_orders
                                    .sort((a,b) => a.created_at.localeCompare(b.created_at))
                                    .map(o => (
                                      <Link
                                        key={o.order_id}
                                        to={`/orders/${o.order_id}`}
                                        className="flex justify-between items-center gap-2 px-3 py-2 rounded border bg-background hover:bg-muted/50 text-xs"
                                      >
                                        <div className="flex flex-col">
                                          <span className="font-mono font-semibold">{o.order_number}</span>
                                          <span className="text-muted-foreground">
                                            {new Date(o.created_at).toLocaleDateString("ar-EG")} · {o.status}
                                          </span>
                                        </div>
                                        <Badge variant="secondary">{o.qty} {r.unit}</Badge>
                                      </Link>
                                    ))}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
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
              <Label>الكمية المضافة *</Label>
              <Input type="number" value={replenishQty} onChange={e => setReplenishQty(e.target.value)} min={1} />
            </div>
            <div>
              <Label>سعر الوحدة (اختياري)</Label>
              <Input type="number" value={replenishPrice} onChange={e => setReplenishPrice(e.target.value)} min={0} step="0.01" placeholder="0.00" />
            </div>
            <div>
              <Label>مرجع التوريد (اختياري)</Label>
              <Input value={replenishRef} onChange={e => setReplenishRef(e.target.value)} placeholder="رقم الفاتورة / المورد" />
            </div>
            <div>
              <Label>ملاحظات (اختياري)</Label>
              <Input value={replenishNotes} onChange={e => setReplenishNotes(e.target.value)} placeholder="مثلاً: دفعة تصنيع رقم..." />
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
