import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

type Run = { id: string; sheet: string; filename: string | null; status: string; total_rows: number; valid_rows: number; error_rows: number; created_at: string };
type Snap = { id: string; item_code: string | null; item_name_ar: string | null; qty: number; unit: string | null; warehouse_code: string | null; status: string; error_reason: string | null };
type Warehouse = { id: string; name: string };

export default function StockSnapshotReview() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [selectedWh, setSelectedWh] = useState<string>("");
  const [rows, setRows] = useState<Snap[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data: r }, { data: w }] = await Promise.all([
      supabase.from("import_runs").select("*").ilike("sheet", "%stock%").order("created_at", { ascending: false }).limit(50),
      supabase.from("warehouses").select("id,name").order("name"),
    ]);
    setRuns((r ?? []) as Run[]);
    setWarehouses((w ?? []) as Warehouse[]);
    setLoading(false);
  }

  async function loadRows(runId: string) {
    setSelectedRun(runId);
    const { data } = await supabase
      .from("inventory_stock_snapshots")
      .select("id,item_code,item_name_ar,qty,unit,warehouse_code,status,error_reason")
      .eq("run_id", runId)
      .order("created_at");
    setRows((data ?? []) as Snap[]);
  }

  async function post() {
    if (!selectedRun || !selectedWh) {
      toast.error("اختر رفعة ومخزن");
      return;
    }
    setPosting(true);
    const { data, error } = await supabase.rpc("import_post_stock_snapshot", {
      p_run_id: selectedRun, p_warehouse_id: selectedWh,
    });
    setPosting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`تم ترحيل ${(data as any)?.posted ?? 0} سطر كتسوية مخزون`);
    await loadRows(selectedRun);
    await load();
  }

  return (
    <div dir="rtl" className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">مراجعة أرصدة المخزون المستوردة</h1>
        <p className="text-muted-foreground text-sm">راجع snapshot ثم اعتمد ترحيله كتسوية مخزون. لا يتم الكتابة على الأرصدة الإنتاجية مباشرة.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>الرفعات</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="animate-spin" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الورقة</TableHead><TableHead>الملف</TableHead>
                  <TableHead>الحالة</TableHead><TableHead>إجمالي</TableHead>
                  <TableHead>صحيح</TableHead><TableHead>أخطاء</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map(r => (
                  <TableRow key={r.id} className={selectedRun === r.id ? "bg-muted" : ""}>
                    <TableCell>{r.sheet}</TableCell>
                    <TableCell className="text-xs">{r.filename}</TableCell>
                    <TableCell><Badge variant={r.status === "posted" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                    <TableCell>{r.total_rows}</TableCell>
                    <TableCell>{r.valid_rows}</TableCell>
                    <TableCell>{r.error_rows}</TableCell>
                    <TableCell><Button size="sm" variant="outline" onClick={() => loadRows(r.id)}>عرض</Button></TableCell>
                  </TableRow>
                ))}
                {runs.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد رفعات.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedRun && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle>تفاصيل الرفعة</CardTitle>
              <div className="flex items-center gap-2">
                <Select value={selectedWh} onValueChange={setSelectedWh}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="اختر المخزن الوجهة" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={post} disabled={posting || !selectedWh}>
                  {posting ? <Loader2 className="animate-spin h-4 w-4 ml-2" /> : <CheckCircle2 className="h-4 w-4 ml-2" />}
                  ترحيل كتسوية مخزون
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>كود</TableHead><TableHead>الصنف</TableHead>
                  <TableHead>الكمية</TableHead><TableHead>الوحدة</TableHead>
                  <TableHead>المخزن (ورقة)</TableHead><TableHead>الحالة</TableHead>
                  <TableHead>السبب</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>{r.item_code}</TableCell>
                    <TableCell>{r.item_name_ar}</TableCell>
                    <TableCell className={r.qty < 0 ? "text-destructive font-bold" : ""}>{r.qty}</TableCell>
                    <TableCell>{r.unit}</TableCell>
                    <TableCell>{r.warehouse_code}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "posted" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-destructive">
                      {r.error_reason && <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{r.error_reason}</span>}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد صفوف.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
