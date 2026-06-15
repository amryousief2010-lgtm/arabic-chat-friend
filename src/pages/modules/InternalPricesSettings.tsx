import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Tag, Plus, Trash2, Save, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

interface SlaughterPrice {
  id?: string;
  product_name: string;
  price_per_kg: number;
  effective_from: string;
  is_active: boolean;
  notes?: string | null;
}
interface FeedPrice {
  id?: string;
  feed_name: string;
  feed_code?: string | null;
  price_per_kg: number;
  effective_from: string;
  is_active: boolean;
  notes?: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function InternalPricesSettings() {
  const [loading, setLoading] = useState(true);
  const [slaughter, setSlaughter] = useState<SlaughterPrice[]>([]);
  const [feed, setFeed] = useState<FeedPrice[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [s, f] = await Promise.all([
        supabase.from("slaughter_internal_prices").select("*").order("product_name"),
        supabase.from("feed_internal_prices").select("*").order("feed_name"),
      ]);
      if (s.error) throw s.error;
      if (f.error) throw f.error;
      setSlaughter((s.data ?? []) as any);
      setFeed((f.data ?? []) as any);
    } catch (e: any) {
      toast.error("تعذّر التحميل: " + (e?.message ?? e));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const saveSlaughter = async (row: SlaughterPrice) => {
    if (!row.product_name.trim() || row.price_per_kg < 0) {
      toast.error("الاسم وسعر الكيلو مطلوبان");
      return;
    }
    const payload = {
      product_name: row.product_name.trim(),
      price_per_kg: Number(row.price_per_kg),
      effective_from: row.effective_from || today(),
      is_active: !!row.is_active,
      notes: row.notes || null,
    };
    const res = row.id
      ? await supabase.from("slaughter_internal_prices").update(payload).eq("id", row.id)
      : await supabase.from("slaughter_internal_prices").insert(payload);
    if (res.error) return toast.error(res.error.message);
    toast.success("تم الحفظ");
    load();
  };
  const saveFeed = async (row: FeedPrice) => {
    if (!row.feed_name.trim() || row.price_per_kg < 0) {
      toast.error("الاسم وسعر الكيلو مطلوبان");
      return;
    }
    const payload = {
      feed_name: row.feed_name.trim(),
      feed_code: row.feed_code || null,
      price_per_kg: Number(row.price_per_kg),
      effective_from: row.effective_from || today(),
      is_active: !!row.is_active,
      notes: row.notes || null,
    };
    const res = row.id
      ? await supabase.from("feed_internal_prices").update(payload).eq("id", row.id)
      : await supabase.from("feed_internal_prices").insert(payload);
    if (res.error) return toast.error(res.error.message);
    toast.success("تم الحفظ");
    load();
  };
  const removeSlaughter = async (id?: string) => {
    if (!id) { setSlaughter(s => s.filter(x => x.id)); return; }
    if (!confirm("حذف السعر؟")) return;
    const res = await supabase.from("slaughter_internal_prices").delete().eq("id", id);
    if (res.error) return toast.error(res.error.message);
    toast.success("تم الحذف"); load();
  };
  const removeFeed = async (id?: string) => {
    if (!id) { setFeed(s => s.filter(x => x.id)); return; }
    if (!confirm("حذف السعر؟")) return;
    const res = await supabase.from("feed_internal_prices").delete().eq("id", id);
    if (res.error) return toast.error(res.error.message);
    toast.success("تم الحذف"); load();
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="p-4 md:p-6 space-y-4" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Tag className="h-7 w-7 text-primary" /> إعدادات الأسعار الداخلية
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          أسعار البيع الداخلية للتحويلات بين الأقسام — تستخدم فقط في الميزانية الشهرية والتحليل،
          ولا تنشئ أي حركة خزنة أو خصم مخزون.
        </p>
      </div>

      <div className="rounded-md p-3 bg-blue-50 border border-blue-200 text-sm flex gap-2">
        <AlertTriangle className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
        <span>إذا لم يوجد سعر داخلي معتمد، يستخدم النظام متوسط التكلفة من المخزون ويظهر تنبيه في تقرير الميزانية.</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin ml-2" /> جارٍ التحميل...
        </div>
      ) : (
        <Tabs defaultValue="slaughter">
          <TabsList>
            <TabsTrigger value="slaughter">أسعار ناتج المجزر ({slaughter.length})</TabsTrigger>
            <TabsTrigger value="feed">أسعار العلف الداخلية ({feed.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="slaughter">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>أسعار ناتج الذبح المحوّل داخليًا</CardTitle>
                <Button size="sm" onClick={() => setSlaughter(s => [...s, {
                  product_name: "", price_per_kg: 0, effective_from: today(), is_active: true,
                }])}>
                  <Plus className="h-4 w-4 ml-1" /> إضافة سعر
                </Button>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>المنتج</TableHead>
                    <TableHead>سعر الكيلو الداخلي</TableHead>
                    <TableHead>تاريخ بدء السعر</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>ملاحظات</TableHead>
                    <TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {slaughter.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        لا توجد أسعار داخلية معتمدة بعد
                      </TableCell></TableRow>
                    )}
                    {slaughter.map((r, i) => (
                      <TableRow key={r.id ?? `new-${i}`}>
                        <TableCell><Input value={r.product_name}
                          onChange={e => setSlaughter(arr => arr.map((x, k) => k === i ? { ...x, product_name: e.target.value } : x))}
                          placeholder="مثال: صدور دجاج" /></TableCell>
                        <TableCell><Input type="number" step="0.01" value={r.price_per_kg}
                          className="w-28"
                          onChange={e => setSlaughter(arr => arr.map((x, k) => k === i ? { ...x, price_per_kg: Number(e.target.value) } : x))} /></TableCell>
                        <TableCell><Input type="date" value={r.effective_from}
                          className="w-40"
                          onChange={e => setSlaughter(arr => arr.map((x, k) => k === i ? { ...x, effective_from: e.target.value } : x))} /></TableCell>
                        <TableCell><Switch checked={r.is_active}
                          onCheckedChange={v => setSlaughter(arr => arr.map((x, k) => k === i ? { ...x, is_active: v } : x))} /></TableCell>
                        <TableCell><Input value={r.notes ?? ""}
                          onChange={e => setSlaughter(arr => arr.map((x, k) => k === i ? { ...x, notes: e.target.value } : x))} /></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => saveSlaughter(r)}>
                              <Save className="h-3 w-3 ml-1" /> حفظ
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => removeSlaughter(r.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="feed">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>أسعار العلف الداخلية</CardTitle>
                <Button size="sm" onClick={() => setFeed(s => [...s, {
                  feed_name: "", feed_code: "", price_per_kg: 0, effective_from: today(), is_active: true,
                }])}>
                  <Plus className="h-4 w-4 ml-1" /> إضافة سعر
                </Button>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>نوع العلف</TableHead>
                    <TableHead>كود</TableHead>
                    <TableHead>سعر الكيلو الداخلي</TableHead>
                    <TableHead>تاريخ بدء السعر</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {feed.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        لا توجد أسعار داخلية معتمدة بعد
                      </TableCell></TableRow>
                    )}
                    {feed.map((r, i) => (
                      <TableRow key={r.id ?? `new-${i}`}>
                        <TableCell><Input value={r.feed_name}
                          onChange={e => setFeed(arr => arr.map((x, k) => k === i ? { ...x, feed_name: e.target.value } : x))}
                          placeholder="مثال: بادئ تسمين" /></TableCell>
                        <TableCell><Input value={r.feed_code ?? ""}
                          className="w-28"
                          onChange={e => setFeed(arr => arr.map((x, k) => k === i ? { ...x, feed_code: e.target.value } : x))} /></TableCell>
                        <TableCell><Input type="number" step="0.01" value={r.price_per_kg}
                          className="w-28"
                          onChange={e => setFeed(arr => arr.map((x, k) => k === i ? { ...x, price_per_kg: Number(e.target.value) } : x))} /></TableCell>
                        <TableCell><Input type="date" value={r.effective_from}
                          className="w-40"
                          onChange={e => setFeed(arr => arr.map((x, k) => k === i ? { ...x, effective_from: e.target.value } : x))} /></TableCell>
                        <TableCell><Switch checked={r.is_active}
                          onCheckedChange={v => setFeed(arr => arr.map((x, k) => k === i ? { ...x, is_active: v } : x))} /></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => saveFeed(r)}>
                              <Save className="h-3 w-3 ml-1" /> حفظ
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => removeFeed(r.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </motion.div>
  );
}
