import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Scale, Download } from "lucide-react";
import { toast } from "sonner";

const isKgUnit = (unit?: string | null) => {
  const u = (unit || "").trim().toLowerCase().replace(/\s+/g, "");
  return /^(كجم|كيلو|كيلوجرام|كيلوغرام|كغم|كغ|kg|kgs|kilogram|kilogramme|kilo)$/i.test(u);
};

interface Row {
  customer_id: string;
  customer_name: string;
  total_kg: number;
  half_kg_qty: number; // count of half-kg units
  full_kg_qty: number; // kg from full-kg items
  orders_count: number;
  total_amount: number;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthStartISO = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

const CustomerWeightReport = () => {
  const [from, setFrom] = useState<string>(monthStartISO());
  const [to, setTo] = useState<string>(todayISO());
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1) Orders in range (exclude cancelled), with customer info
      const fromTs = `${from}T00:00:00`;
      const toTs = `${to}T23:59:59`;
      const { data: orders, error: oErr } = await supabase
        .from("orders")
        .select("id, customer_id, total, status, created_at, customers(name)")
        .gte("created_at", fromTs)
        .lte("created_at", toTs)
        .neq("status", "cancelled");
      if (oErr) throw oErr;

      const orderIds = (orders || []).map((o: any) => o.id);
      if (!orderIds.length) {
        setRows([]);
        return;
      }

      // 2) Items for those orders (in chunks of 1000 ids)
      const items: any[] = [];
      for (let i = 0; i < orderIds.length; i += 500) {
        const chunk = orderIds.slice(i, i + 500);
        const { data, error } = await supabase
          .from("order_items")
          .select("order_id, product_id, quantity, total_price, is_half_kg")
          .in("order_id", chunk);
        if (error) throw error;
        items.push(...(data || []));
      }

      // 3) Product units
      const productIds = Array.from(
        new Set(items.map((i) => i.product_id).filter(Boolean))
      );
      const unitMap = new Map<string, string>();
      if (productIds.length) {
        for (let i = 0; i < productIds.length; i += 500) {
          const chunk = productIds.slice(i, i + 500);
          const { data } = await supabase
            .from("products")
            .select("id, unit")
            .in("id", chunk as string[]);
          (data || []).forEach((p: any) => unitMap.set(p.id, p.unit));
        }
      }

      // 4) Aggregate per customer
      const orderById = new Map<string, any>();
      (orders || []).forEach((o: any) => orderById.set(o.id, o));
      const agg = new Map<string, Row>();

      for (const it of items) {
        const order = orderById.get(it.order_id);
        if (!order) continue;
        const cid = order.customer_id || "unknown";
        const cname = order.customers?.name || "عميل غير معروف";
        const unit = it.product_id ? unitMap.get(it.product_id) : null;
        const qty = Number(it.quantity) || 0;
        let halfQty = 0;
        let fullKg = 0;
        if (it.is_half_kg) halfQty = qty;
        else if (isKgUnit(unit)) fullKg = qty;
        const kg = fullKg + halfQty / 2;

        const cur =
          agg.get(cid) ||
          {
            customer_id: cid,
            customer_name: cname,
            total_kg: 0,
            half_kg_qty: 0,
            full_kg_qty: 0,
            orders_count: 0,
            total_amount: 0,
          };
        cur.total_kg += kg;
        cur.half_kg_qty += halfQty;
        cur.full_kg_qty += fullKg;
        agg.set(cid, cur);
      }

      // orders_count + total_amount per customer
      const seen = new Map<string, Set<string>>();
      for (const o of orders || []) {
        const cid = (o as any).customer_id || "unknown";
        const cur = agg.get(cid);
        if (!cur) continue;
        const set = seen.get(cid) || new Set<string>();
        set.add((o as any).id);
        seen.set(cid, set);
        cur.total_amount += Number((o as any).total) || 0;
      }
      seen.forEach((set, cid) => {
        const cur = agg.get(cid);
        if (cur) cur.orders_count = set.size;
      });

      const result = Array.from(agg.values()).sort((a, b) => b.total_kg - a.total_kg);
      setRows(result);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "حدث خطأ أثناء توليد التقرير");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(
    () => ({
      kg: rows.reduce((s, r) => s + r.total_kg, 0),
      orders: rows.reduce((s, r) => s + r.orders_count, 0),
      amount: rows.reduce((s, r) => s + r.total_amount, 0),
    }),
    [rows]
  );

  const exportCsv = () => {
    const header = ["العميل", "إجمالي الكجم", "كمية نصف كيلو", "كمية الكيلو الكامل", "عدد الطلبات", "إجمالي المبلغ"];
    const lines = [header.join(",")];
    rows.forEach((r) => {
      lines.push(
        [
          `"${r.customer_name.replace(/"/g, '""')}"`,
          r.total_kg.toFixed(2),
          r.half_kg_qty,
          r.full_kg_qty,
          r.orders_count,
          r.total_amount.toFixed(2),
        ].join(",")
      );
    });
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customer-weight-${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Scale className="w-7 h-7 text-primary" />
              تقرير وزن العملاء (كجم)
            </h1>
            <p className="text-muted-foreground mt-1">
              إجمالي الكيلوجرام لكل عميل خلال نطاق تاريخي، يحسب الكيلو الكامل + (نصف كيلو ÷ 2).
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">الفلترة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div className="space-y-1.5">
                <Label>من</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>إلى</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <Button onClick={fetchData} disabled={loading}>
                {loading ? "جاري التحميل..." : "تحديث التقرير"}
              </Button>
              <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
                <Download className="w-4 h-4 ml-1" />
                تصدير CSV
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">إجمالي الكجم</p>
              <p className="text-2xl font-bold text-primary">{totals.kg.toLocaleString(undefined, { maximumFractionDigits: 2 })} كجم</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">عدد العملاء</p>
              <p className="text-2xl font-bold">{rows.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">إجمالي المبيعات</p>
              <p className="text-2xl font-bold">{totals.amount.toLocaleString()} ج.م</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">تفاصيل العملاء</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>العميل</TableHead>
                    <TableHead className="text-center">إجمالي الكجم</TableHead>
                    <TableHead className="text-center">نصف كيلو (وحدة)</TableHead>
                    <TableHead className="text-center">كيلو كامل</TableHead>
                    <TableHead className="text-center">عدد الطلبات</TableHead>
                    <TableHead className="text-center">إجمالي المبلغ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        {loading ? "جاري التحميل..." : "لا توجد بيانات في النطاق المحدد"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow key={r.customer_id}>
                        <TableCell className="font-medium">{r.customer_name}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default">{r.total_kg.toLocaleString(undefined, { maximumFractionDigits: 2 })} كجم</Badge>
                        </TableCell>
                        <TableCell className="text-center">{r.half_kg_qty}</TableCell>
                        <TableCell className="text-center">{r.full_kg_qty}</TableCell>
                        <TableCell className="text-center">{r.orders_count}</TableCell>
                        <TableCell className="text-center">{r.total_amount.toLocaleString()} ج.م</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default CustomerWeightReport;
