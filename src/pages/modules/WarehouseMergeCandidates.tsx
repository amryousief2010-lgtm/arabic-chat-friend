import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Candidate {
  warehouse_id: string;
  warehouse_name: string;
  match_key: string;
  reason: string;
  item_id: string;
  item_name: string;
  product_id: string | null;
  stock: number;
  pack_weight_kg: number | null;
}

export default function WarehouseMergeCandidates() {
  const [rows, setRows] = useState<Candidate[]>([]);
  const [unlinked, setUnlinked] = useState<{ id: string; name: string; warehouse_id: string; stock: number }[]>([]);
  const [warehouses, setWarehouses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [{ data: cand, error: cErr }, { data: items }, { data: whs }] = await Promise.all([
      supabase.rpc("list_inventory_merge_candidates" as any),
      supabase.from("inventory_items").select("id, name, warehouse_id, stock, product_id").is("product_id", null).eq("is_active", true).order("name").limit(1000),
      supabase.from("warehouses").select("id, name"),
    ]);
    if (cErr) setError(cErr.message);
    setRows((cand || []) as Candidate[]);
    setUnlinked((items || []) as any);
    const map: Record<string, string> = {};
    (whs || []).forEach((w: any) => { map[w.id] = w.name; });
    setWarehouses(map);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    const m = new Map<string, Candidate[]>();
    rows.forEach((r) => {
      const k = `${r.warehouse_id}|${r.reason}|${r.match_key}`;
      const list = m.get(k) || [];
      list.push(r);
      m.set(k, list);
    });
    return Array.from(m.entries());
  }, [rows]);

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Link2 className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">بطاقات غير مربوطة ومرشحة للدمج</h1>
            <p className="text-sm text-muted-foreground">تقرير للمراجعة فقط. لا يتم دمج أي بطاقة تلقائياً.</p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className="w-4 h-4 ml-1" /> تحديث</Button>
        </div>

        <Alert>
          <AlertDescription>
            الصرف والبيع من بطاقة بلا منتج مربوط متوقف من شاشات الصرف. اربط البطاقة بالمنتج أولاً، ثم ادمج التكرار يدوياً بعد مراجعة هذا التقرير.
          </AlertDescription>
        </Alert>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        <Card>
          <CardHeader><CardTitle className="text-base">بطاقات بلا منتج ({unlinked.length})</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>المخزن</TableHead>
                  <TableHead>الرصيد</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unlinked.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">لا توجد بطاقات غير مربوطة في أول ألف نتيجة</TableCell></TableRow>
                ) : unlinked.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.name}</TableCell>
                    <TableCell>{warehouses[it.warehouse_id] || "—"}</TableCell>
                    <TableCell className="font-mono">{it.stock}</TableCell>
                    <TableCell><Badge variant="destructive">يحتاج ربط — لا يُصرف</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">مرشحو الدمج ({groups.length} مجموعة)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {groups.length === 0 && <p className="text-sm text-muted-foreground">لا توجد مجموعات متطابقة.</p>}
            {groups.map(([key, list]) => (
              <div key={key} className="border rounded-lg p-3 space-y-2">
                <div className="flex gap-2 items-center">
                  <Badge variant="outline">{list[0].reason}</Badge>
                  <span className="text-sm">{list[0].warehouse_name}</span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الصنف</TableHead>
                      <TableHead>منتج مربوط</TableHead>
                      <TableHead>الرصيد</TableHead>
                      <TableHead>وزن العبوة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((r) => (
                      <TableRow key={r.item_id}>
                        <TableCell>{r.item_name}</TableCell>
                        <TableCell>{r.product_id ? "نعم" : "لا"}</TableCell>
                        <TableCell className="font-mono">{r.stock}</TableCell>
                        <TableCell className="font-mono">{r.pack_weight_kg ?? "—"} كجم</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
