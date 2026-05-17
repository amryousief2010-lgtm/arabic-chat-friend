import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Plus, ArrowLeft, RefreshCw, PackageOpen, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/dateFormat";

const statusFlow: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; next?: string }> = {
  draft: { label: "مسودة", variant: "secondary", next: "issued" },
  issued: { label: "تم صرف الخامات", variant: "default", next: "mixing" },
  mixing: { label: "خلط/تشغيل", variant: "default", next: "packed" },
  packed: { label: "تعبئة", variant: "default", next: "qc_pending" },
  qc_pending: { label: "بانتظار الجودة", variant: "secondary" },
  approved: { label: "معتمدة", variant: "outline" },
  needs_review: { label: "تحتاج مراجعة", variant: "destructive" },
  rejected: { label: "مرفوضة", variant: "destructive" },
  posted: { label: "مرحّلة", variant: "outline" },
};

const nextLabel: Record<string, string> = {
  issued: "تأكيد الصرف", mixing: "بدء الخلط", packed: "تم التعبئة", qc_pending: "إرسال للجودة",
};

interface Order {
  id: string; order_no: string; feed_product_id: string; recipe_id: string | null;
  status: string; target_output_kg: number; notes: string | null; created_at: string;
  feed_product?: { name: string; feed_code: string };
  recipe?: { name: string; batch_size: number };
}

const fmt = (n: number, d = 0) => (Number.isFinite(n) ? n : 0).toLocaleString("en-GB", { maximumFractionDigits: d });

export default function Orders() {
  const { canManageFeedFactory, user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>("all");

  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState({ feed_product_id: "", recipe_id: "", target_output_kg: 1000, notes: "" });

  const fetchAll = async () => {
    setLoading(true);
    const [o, p, r] = await Promise.all([
      supabase.from("feed_production_orders").select("*, feed_product:feed_products(name, feed_code), recipe:feed_recipes(name, batch_size)").order("created_at", { ascending: false }).limit(300),
      supabase.from("feed_products").select("id, name, feed_code").is("archived_at", null).order("name"),
      supabase.from("feed_recipes").select("id, name, feed_type, batch_size, feed_product_id").eq("is_active", true).order("name"),
    ]);
    if (o.error) toast({ title: "خطأ", description: o.error.message, variant: "destructive" });
    setOrders((o.data || []) as any);
    setProducts(p.data || []);
    setRecipes(r.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const visible = filter === "all" ? orders : orders.filter(o => o.status === filter);

  const recipesForProduct = form.feed_product_id
    ? recipes.filter(r => !r.feed_product_id || r.feed_product_id === form.feed_product_id)
    : recipes;

  const createOrder = async () => {
    if (!form.feed_product_id || form.target_output_kg <= 0) {
      toast({ title: "بيانات ناقصة", description: "اختر المنتج وحدد الكمية", variant: "destructive" });
      return;
    }
    const order_no = `FO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const { error } = await supabase.from("feed_production_orders").insert({
      order_no,
      feed_product_id: form.feed_product_id,
      recipe_id: form.recipe_id || null,
      target_output_kg: form.target_output_kg,
      notes: form.notes || null,
      status: "draft",
      created_by: user?.id,
    });
    if (error) toast({ title: "خطأ", description: error.message, variant: "destructive" });
    else {
      toast({ title: "تم إنشاء الأمر", description: order_no });
      setDialog(false);
      setForm({ feed_product_id: "", recipe_id: "", target_output_kg: 1000, notes: "" });
      fetchAll();
    }
  };

  const advance = async (o: Order) => {
    const next = statusFlow[o.status]?.next;
    if (!next) return;
    const { error } = await supabase.from("feed_production_orders").update({ status: next as any }).eq("id", o.id);
    if (error) toast({ title: "خطأ", description: error.message, variant: "destructive" });
    else { toast({ title: "تم تحديث الحالة", description: statusFlow[next]?.label }); fetchAll(); }
  };

  const reject = async (o: Order) => {
    const { error } = await supabase.from("feed_production_orders").update({ status: "rejected" as any }).eq("id", o.id);
    if (error) toast({ title: "خطأ", description: error.message, variant: "destructive" });
    else fetchAll();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <ClipboardList className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">أوامر الإنتاج</h1>
              <p className="text-muted-foreground mt-1">من إنشاء الطلب وحتى الصرف والاعتماد</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {Object.entries(statusFlow).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ml-2 ${loading ? "animate-spin" : ""}`} />تحديث
            </Button>
            <Link to="/modules/feed-factory/issues">
              <Button size="sm" variant="outline"><PackageOpen className="w-4 h-4 ml-2" />صرف الخامات</Button>
            </Link>
            <Link to="/modules/feed-factory">
              <Button size="sm" variant="ghost"><ArrowLeft className="w-4 h-4 ml-2" />رجوع</Button>
            </Link>
            {canManageFeedFactory && (
              <Button size="sm" onClick={() => setDialog(true)}><Plus className="w-4 h-4 ml-2" />أمر إنتاج جديد</Button>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الأمر</TableHead>
                  <TableHead>المنتج</TableHead>
                  <TableHead>الوصفة</TableHead>
                  <TableHead>المستهدف (كجم)</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
                ) : visible.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">لا توجد أوامر</TableCell></TableRow>
                ) : visible.map(o => {
                  const s = statusFlow[o.status];
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs">{o.order_no}</TableCell>
                      <TableCell>{o.feed_product?.name || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{o.recipe?.name || "—"}</TableCell>
                      <TableCell>{fmt(Number(o.target_output_kg))}</TableCell>
                      <TableCell><Badge variant={s?.variant || "outline"}>{s?.label || o.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(o.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-start flex-wrap">
                          {o.status === "draft" && (
                            <Link to={`/modules/feed-factory/issues?order=${o.id}`}>
                              <Button size="sm" variant="outline"><PackageOpen className="w-3 h-3 ml-1" />صرف</Button>
                            </Link>
                          )}
                          {canManageFeedFactory && s?.next && o.status !== "draft" && (
                            <Button size="sm" variant="outline" onClick={() => advance(o)}>
                              <CheckCircle2 className="w-3 h-3 ml-1" />{nextLabel[s.next] || "التالي"}
                            </Button>
                          )}
                          {canManageFeedFactory && !["approved", "posted", "rejected"].includes(o.status) && (
                            <Button size="sm" variant="ghost" onClick={() => reject(o)} title="رفض">
                              <XCircle className="w-3 h-3 text-destructive" />
                            </Button>
                          )}
                          {o.status === "needs_review" && (
                            <AlertTriangle className="w-4 h-4 text-warning self-center" />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={dialog} onOpenChange={setDialog}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>أمر إنتاج جديد</DialogTitle>
              <DialogDescription>سيُنشأ الأمر بحالة "مسودة" ويتم تحريكه عبر الصرف والخلط والتعبئة والجودة</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>المنتج *</Label>
                <Select value={form.feed_product_id} onValueChange={v => setForm({ ...form, feed_product_id: v, recipe_id: "" })}>
                  <SelectTrigger><SelectValue placeholder="اختر المنتج" /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => <SelectItem key={p.id} value={p.id}>{p.feed_code} — {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>الوصفة (اختياري)</Label>
                <Select value={form.recipe_id || "none"} onValueChange={v => setForm({ ...form, recipe_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— بدون وصفة محددة —</SelectItem>
                    {recipesForProduct.map(r => <SelectItem key={r.id} value={r.id}>{r.name} ({fmt(r.batch_size)} كجم)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>الكمية المستهدفة (كجم) *</Label>
                <Input type="number" value={form.target_output_kg} onChange={e => setForm({ ...form, target_output_kg: Number(e.target.value) })} />
              </div>
              <div>
                <Label>ملاحظات</Label>
                <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(false)}>إلغاء</Button>
              <Button onClick={createOrder}>إنشاء الأمر</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
