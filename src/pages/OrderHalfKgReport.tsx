import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Scale, Search, Download, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";

const isKgUnit = (unit?: string | null) => {
  const u = (unit || "").trim().toLowerCase().replace(/\s+/g, "");
  return /^(كجم|كيلو|كيلوجرام|كيلوغرام|كغم|كغ|kg|kgs|kilogram|kilogramme|kilo)$/i.test(u);
};

interface ItemRow {
  order_id: string;
  order_number: string;
  customer_name: string;
  product_name: string;
  unit: string | null;
  quantity: number;
  is_half_kg: boolean;
  kg: number; // calculated weight in kg
  unit_price: number;
}

const OrderHalfKgReport = () => {
  const [params, setParams] = useSearchParams();
  const [orderNumber, setOrderNumber] = useState(params.get("order") || "");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!orderNumber.trim()) { toast.error("أدخل رقم طلب أو اتركه فارغًا للبحث في كل الطلبات"); return; }
    setLoading(true);
    try {
      const { data: orders, error: oErr } = await supabase
        .from("orders")
        .select("id, order_number, customers(name)")
        .ilike("order_number", `%${orderNumber.trim()}%`)
        .limit(100);
      if (oErr) throw oErr;

      if (!orders || orders.length === 0) {
        setItems([]);
        toast.info("لا توجد نتائج");
        return;
      }

      const orderIds = orders.map(o => o.id);
      const { data: itemsData, error: iErr } = await supabase
        .from("order_items")
        .select("order_id, product_id, product_name, quantity, unit_price, is_half_kg")
        .in("order_id", orderIds);
      if (iErr) throw iErr;

      const productIds = Array.from(new Set((itemsData || []).map(i => i.product_id).filter(Boolean))) as string[];
      const unitMap = new Map<string, string>();
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from("products")
          .select("id, unit")
          .in("id", productIds);
        (products || []).forEach((p: any) => unitMap.set(p.id, p.unit));
      }

      const orderMap = new Map(orders.map((o: any) => [o.id, { order_number: o.order_number, customer_name: o.customers?.name || "—" }]));

      const rows: ItemRow[] = (itemsData || []).map((it: any) => {
        const unit = it.product_id ? unitMap.get(it.product_id) || null : null;
        const isHalf = !!it.is_half_kg;
        const isKg = isKgUnit(unit);
        const qty = Number(it.quantity);
        let kg = 0;
        if (isHalf) kg = qty / 2;
        else if (isKg) kg = qty;
        return {
          order_id: it.order_id,
          order_number: orderMap.get(it.order_id)?.order_number || "",
          customer_name: orderMap.get(it.order_id)?.customer_name || "—",
          product_name: it.product_name,
          unit,
          quantity: qty,
          is_half_kg: isHalf,
          kg,
          unit_price: Number(it.unit_price),
        };
      });

      // Show only kg-related items (half-kg or kg unit)
      const filteredRows = rows.filter(r => r.is_half_kg || isKgUnit(r.unit));
      setItems(filteredRows);
      if (filteredRows.length === 0) toast.info("لا توجد أصناف بوحدة الكيلو في هذه الطلبات");
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "تعذر البحث");
    } finally {
      setLoading(false);
      setParams({ order: orderNumber });
    }
  };

  useEffect(() => {
    if (params.get("order")) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalKg = items.reduce((s, r) => s + r.kg, 0);
  const halfKgItems = items.filter(r => r.is_half_kg).length;

  const exportExcel = () => {
    if (items.length === 0) return;
    const data = items.map(r => ({
      "الطلب": r.order_number,
      "العميل": r.customer_name,
      "الصنف": r.product_name,
      "الوحدة": r.unit || "—",
      "الكمية": r.quantity,
      "نصف كيلو؟": r.is_half_kg ? "نعم (2 = 1 كجم)" : "لا",
      "الوزن بالكجم": r.kg,
      "سعر الوحدة": r.unit_price,
    }));
    data.push({
      "الطلب": "الإجمالي",
      "العميل": "",
      "الصنف": "",
      "الوحدة": "",
      "الكمية": items.reduce((s, r) => s + r.quantity, 0),
      "نصف كيلو؟": `${halfKgItems} صنف`,
      "الوزن بالكجم": totalKg,
      "سعر الوحدة": 0,
    } as any);
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تقرير نصف كيلو");
    XLSX.writeFile(wb, `تقرير-نصف-كيلو-${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Header title="تقرير تحويل ½ كيلو إلى كجم" subtitle="2 = 1 كيلو · للتحقق من صحة الحساب لكل صنف" />

        <Card className="glass-card">
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1 w-full">
              <Label>رقم الطلب (أو جزء منه)</Label>
              <Input
                value={orderNumber}
                onChange={e => setOrderNumber(e.target.value)}
                placeholder="ORD-..."
                onKeyDown={(e) => e.key === "Enter" && search()}
              />
            </div>
            <Button onClick={search} disabled={loading} className="gap-2">
              <Search className="w-4 h-4" />
              {loading ? "جاري البحث..." : "بحث"}
            </Button>
            <Button variant="outline" onClick={exportExcel} disabled={items.length === 0} className="gap-2">
              <Download className="w-4 h-4" /> تصدير
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="glass-card border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">عدد الأصناف بالكجم</p>
              <p className="text-2xl font-bold">{items.length}</p>
            </CardContent>
          </Card>
          <Card className="glass-card border-secondary/20 bg-secondary/5">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">أصناف نصف كيلو</p>
              <p className="text-2xl font-bold">{halfKgItems}</p>
            </CardContent>
          </Card>
          <Card className="glass-card border-success/20 bg-success/5">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">إجمالي الوزن</p>
              <p className="text-2xl font-bold text-success">{totalKg.toLocaleString()} كجم</p>
            </CardContent>
          </Card>
        </div>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="w-5 h-5 text-primary" />
              تفاصيل التحويل لكل صنف
            </CardTitle>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                ابحث برقم طلب لعرض تحويل ½ كيلو
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الطلب</TableHead>
                      <TableHead className="text-right">العميل</TableHead>
                      <TableHead className="text-right">الصنف</TableHead>
                      <TableHead className="text-center">الوحدة</TableHead>
                      <TableHead className="text-center">الكمية</TableHead>
                      <TableHead className="text-center">نوع</TableHead>
                      <TableHead className="text-center">الوزن (كجم)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Link to={`/orders/${r.order_id}`} className="text-primary hover:underline">
                            {r.order_number}
                          </Link>
                        </TableCell>
                        <TableCell>{r.customer_name}</TableCell>
                        <TableCell className="font-medium">{r.product_name}</TableCell>
                        <TableCell className="text-center text-xs">{r.unit || "—"}</TableCell>
                        <TableCell className="text-center">{r.quantity}</TableCell>
                        <TableCell className="text-center">
                          {r.is_half_kg ? (
                            <Badge variant="secondary" className="text-xs">نصف كيلو (÷2)</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">كيلو كامل</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center font-bold text-primary">
                          {r.kg.toLocaleString()} كجم
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell colSpan={6} className="text-left">الإجمالي</TableCell>
                      <TableCell className="text-center text-success">
                        {totalKg.toLocaleString()} كجم
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default OrderHalfKgReport;
