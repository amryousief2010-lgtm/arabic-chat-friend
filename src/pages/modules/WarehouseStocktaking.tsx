import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck, ShieldCheck, Info, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Item { id: string; name: string; unit: string; stock: number; unit_cost: number; warehouse_id: string }

export default function WarehouseStocktaking() {
  const { isGeneralManager, isExecutiveManager } = useAuth();
  const canApprove = isGeneralManager || isExecutiveManager;
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [activeWh, setActiveWh] = useState<string>("");
  const [items, setItems] = useState<Item[]>([]);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from("warehouses").select("id, name").eq("is_active", true).order("name").then(({ data }) => {
      const list = (data || []) as any[];
      setWarehouses(list);
      if (list.length && !activeWh) setActiveWh(list[0].id);
    });
  }, []);

  const loadItems = async (whId: string) => {
    if (!whId) return;
    setLoading(true);
    const { data } = await supabase
      .from("inventory_items").select("id, name, unit, stock, unit_cost, warehouse_id")
      .eq("warehouse_id", whId).eq("is_active", true).order("name");
    setItems((data || []) as Item[]);
    setActuals({}); setReasons({});
    setLoading(false);
  };

  useEffect(() => { loadItems(activeWh); }, [activeWh]);

  const submit = async (it: Item) => {
    const a = actuals[it.id];
    const reason = reasons[it.id];
    if (a === undefined || a === "") { toast.error("أدخل الكمية الفعلية"); return; }
    if (!reason || reason.trim().length < 3) { toast.error("اكتب سبب التسوية"); return; }
    if (!canApprove) { toast.error("التسوية تتطلب صلاحية مدير"); return; }
    setBusy(it.id);
    try {
      const { error } = await supabase.rpc("submit_stock_adjustment", {
        p_item_id: it.id,
        p_actual_qty: Number(a),
        p_reason: reason.trim(),
      });
      if (error) throw error;
      toast.success("تم اعتماد التسوية وتسجيل حركة adjustment");
      await loadItems(activeWh);
    } catch (e: any) {
      toast.error(e.message || "فشل");
    } finally { setBusy(null); }
  };

  const filtered = useMemo(() =>
    search.trim() ? items.filter((i) => i.name.includes(search.trim())) : items
  , [items, search]);

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ClipboardCheck className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">الجرد والتسويات</h1>
            <p className="text-sm text-muted-foreground">
              أدخل الكمية الفعلية بعد الجرد. الفرق يُسجَّل كحركة <code>adjustment</code> بمرجع فريد بعد اعتماد المدير العام/التنفيذي.
            </p>
          </div>
        </div>

        {!canApprove && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>التسوية تتطلب صلاحية المدير العام أو التنفيذي. يمكنك مراجعة الأرقام فقط.</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">اختر المخزن</CardTitle>
            <CardDescription>اعرض الأصناف، اكتب الكمية الفعلية والسبب، ثم اضغط اعتماد لتسجيل التسوية.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs">المخزن</Label>
                <Select value={activeWh} onValueChange={setActiveWh}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs">بحث</Label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pr-9" placeholder="اسم الصنف" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الصنف</TableHead>
                    <TableHead>الوحدة</TableHead>
                    <TableHead>رصيد النظام</TableHead>
                    <TableHead>الكمية الفعلية</TableHead>
                    <TableHead>الفرق</TableHead>
                    <TableHead>السبب</TableHead>
                    <TableHead className="text-left">إجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">جاري التحميل...</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">لا توجد أصناف.</TableCell></TableRow>
                  ) : filtered.map((it) => {
                    const a = actuals[it.id];
                    const diff = a !== undefined && a !== "" ? Number(a) - Number(it.stock || 0) : null;
                    return (
                      <TableRow key={it.id}>
                        <TableCell className="font-medium">{it.name}</TableCell>
                        <TableCell>{it.unit}</TableCell>
                        <TableCell className="font-mono">{Number(it.stock || 0).toLocaleString("ar-EG")}</TableCell>
                        <TableCell>
                          <Input type="number" step="0.01" className="w-28" value={a ?? ""} onChange={(e) => setActuals((s) => ({ ...s, [it.id]: e.target.value }))} />
                        </TableCell>
                        <TableCell className={`font-mono ${diff !== null && diff < 0 ? "text-rose-600" : diff !== null && diff > 0 ? "text-emerald-600" : ""}`}>
                          {diff === null ? "—" : (diff > 0 ? `+${diff}` : diff)}
                        </TableCell>
                        <TableCell>
                          <Input className="w-48" placeholder="سبب التسوية" value={reasons[it.id] || ""} onChange={(e) => setReasons((s) => ({ ...s, [it.id]: e.target.value }))} />
                        </TableCell>
                        <TableCell className="text-left">
                          <Button size="sm" disabled={!canApprove || busy === it.id || diff === null || diff === 0} onClick={() => submit(it)}>
                            <ShieldCheck className="w-3 h-3 ml-1" /> اعتماد
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <Badge variant="outline" className="ml-2">قاعدة</Badge>
            لا يجوز تعديل الرصيد مباشرة. كل تسوية تُسجَّل كحركة <code>adjustment</code> في <code>inventory_movements</code> مع <code>reference_id</code> فريد وحفظ المستخدم المُعتمد في <code>approved_by</code>.
          </AlertDescription>
        </Alert>
      </div>
    </DashboardLayout>
  );
}
