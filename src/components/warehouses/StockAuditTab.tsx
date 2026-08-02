import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw, History } from "lucide-react";

interface Row {
  id: string;
  item_name: string | null;
  old_stock: number | null;
  new_stock: number | null;
  delta: number | null;
  source: string | null;
  created_at: string;
  changed_by: string | null;
}

/**
 * سجل تغيّر أرصدة الأصناف: يوضح أي تغيير حدث على الرصيد بعد الجرد،
 * ومصدره (حركة مخزون فعلية أم تعديل مباشر بدون حركة).
 */
export default function StockAuditTab({ warehouseId }: { warehouseId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("inventory_stock_audit")
      .select("id,item_name,old_stock,new_stock,delta,source,created_at,changed_by")
      .eq("warehouse_id", warehouseId)
      .order("created_at", { ascending: false })
      .limit(300);
    const list = (data || []) as Row[];
    setRows(list);
    const ids = Array.from(new Set(list.map(r => r.changed_by).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      const map: Record<string, string> = {};
      (profs || []).forEach((p: any) => { map[p.id] = p.full_name; });
      setNames(map);
    }
    setLoading(false);
  };

  useEffect(() => { if (warehouseId) void load(); /* eslint-disable-next-line */ }, [warehouseId]);

  const filtered = rows.filter(r =>
    !q.trim() || (r.item_name || "").includes(q.trim()) || (r.source || "").includes(q.trim())
  );

  const manualCount = rows.filter(r => (r.source || "").includes("بدون حركة")).length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            سجل تغيّر الأرصدة
          </CardTitle>
          <CardDescription>
            كل تغيير في رصيد أي صنف مع مصدره — لمعرفة سبب اختلاف الأرقام بعد ضبط الجرد
            {manualCount > 0 && ` · ${manualCount} تغيير بدون حركة مخزون`}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Input placeholder="بحث بالصنف أو السبب" value={q} onChange={e => setQ(e.target.value)} className="w-48" />
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 max-h-[32rem] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>الصنف</TableHead>
              <TableHead>قبل</TableHead>
              <TableHead>بعد</TableHead>
              <TableHead>الفرق</TableHead>
              <TableHead>المصدر</TableHead>
              <TableHead>بواسطة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(r => {
              const manual = (r.source || "").includes("بدون حركة");
              return (
                <TableRow key={r.id} className={manual ? "bg-destructive/5" : ""}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}
                  </TableCell>
                  <TableCell className="text-sm">{r.item_name}</TableCell>
                  <TableCell className="text-sm">{Number(r.old_stock ?? 0)}</TableCell>
                  <TableCell className="text-sm font-medium">{Number(r.new_stock ?? 0)}</TableCell>
                  <TableCell className={`text-sm font-bold ${Number(r.delta) < 0 ? "text-destructive" : "text-success"}`}>
                    {Number(r.delta) > 0 ? "+" : ""}{Number(r.delta ?? 0)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {manual ? <Badge variant="destructive">{r.source}</Badge> : <span className="text-muted-foreground">{r.source}</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.changed_by ? (names[r.changed_by] || "—") : "النظام"}
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  لا توجد تغييرات مسجّلة بعد
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
