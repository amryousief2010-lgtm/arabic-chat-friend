import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wheat, ArrowDownToLine, ArrowUpFromLine, Boxes, FileText, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import FeedInternalDebtDashboard from "@/components/feed/FeedInternalDebtDashboard";

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function SlaughterhouseFeedStore() {
  const qc = useQueryClient();
  const { roles } = useAuth() as any;
  const canManage = (roles || []).some((r: string) =>
    ["general_manager", "executive_manager", "slaughterhouse_manager", "warehouse_supervisor"].includes(r),
  );

  const invQ = useQuery({
    queryKey: ["sl_feed_inv"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slaughterhouse_feed_inventory" as any)
        .select("*")
        .order("feed_name");
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const movQ = useQuery({
    queryKey: ["sl_feed_mov"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slaughterhouse_feed_movements" as any)
        .select("*")
        .order("performed_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const [issueOpen, setIssueOpen] = useState(false);

  const totals = useMemo(() => {
    const inv = invQ.data || [];
    const balance = inv.reduce((s, r) => s + Number(r.current_kg || 0), 0);
    const mov = movQ.data || [];
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const monthMov = mov.filter((m: any) => m.performed_at >= monthStart);
    const inMonth = monthMov.filter((m: any) => ["factory_supply", "opening"].includes(m.movement_type)).reduce((s, m) => s + Number(m.quantity_kg), 0);
    const outMonth = monthMov.filter((m: any) => m.movement_type === "consumption").reduce((s, m) => s + Number(m.quantity_kg), 0);
    return { balance, inMonth, outMonth };
  }, [invQ.data, movQ.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["sl_feed_inv"] });
    qc.invalidateQueries({ queryKey: ["sl_feed_mov"] });
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wheat className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">مخزن علف المجزر — علف النعام التسمين</h1>
              <p className="text-sm text-muted-foreground">وارد من مصنع العلف ومصروف لتغذية النعام المنتظر دبحه</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4 ml-1" />تحديث</Button>
            {canManage && (
              <Button onClick={() => setIssueOpen(true)}><ArrowUpFromLine className="h-4 w-4 ml-1" />صرف علف للنعام</Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Boxes className="h-4 w-4 text-primary" />الرصيد الحالي (كل الأصناف)</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-primary">{fmt(totals.balance)} كجم</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ArrowDownToLine className="h-4 w-4 text-emerald-600" />وارد الشهر الحالي</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-emerald-700">{fmt(totals.inMonth)} كجم</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ArrowUpFromLine className="h-4 w-4 text-orange-600" />مصروف الشهر الحالي</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-orange-700">{fmt(totals.outMonth)} كجم</div></CardContent></Card>
        </div>

        <FeedInternalDebtDashboard department="slaughterhouse" />


        <Tabs defaultValue="balances" dir="rtl">
          <TabsList className="bg-muted/60 p-2">
            <TabsTrigger value="balances">الأرصدة</TabsTrigger>
            <TabsTrigger value="inflow">وارد من المصنع</TabsTrigger>
            <TabsTrigger value="outflow">المصروف</TabsTrigger>
            <TabsTrigger value="all">كل الحركات</TabsTrigger>
          </TabsList>

          <TabsContent value="balances">
            <Card><CardContent className="p-3">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>الصنف</TableHead><TableHead>الرصيد (كجم)</TableHead>
                  <TableHead>آخر سعر/كجم</TableHead><TableHead>قيمة الرصيد التقديرية</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(invQ.data || []).map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.feed_name}</TableCell>
                      <TableCell><Badge variant={Number(r.current_kg) > 0 ? "default" : "secondary"}>{fmt(r.current_kg)}</Badge></TableCell>
                      <TableCell>{fmt(r.last_unit_cost)}</TableCell>
                      <TableCell className="font-bold">{fmt(Number(r.current_kg) * Number(r.last_unit_cost))} ج.م</TableCell>
                    </TableRow>
                  ))}
                  {!(invQ.data || []).length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">لا توجد أصناف بعد — سيظهر العلف هنا عند توريد فاتورة من مصنع العلف</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="inflow"><MovementsTable rows={(movQ.data || []).filter((m: any) => ["factory_supply", "opening"].includes(m.movement_type))} inventory={invQ.data || []} /></TabsContent>
          <TabsContent value="outflow"><MovementsTable rows={(movQ.data || []).filter((m: any) => m.movement_type === "consumption")} inventory={invQ.data || []} /></TabsContent>
          <TabsContent value="all"><MovementsTable rows={movQ.data || []} inventory={invQ.data || []} /></TabsContent>
        </Tabs>
      </div>

      <IssueFeedDialog open={issueOpen} onOpenChange={setIssueOpen} inventory={invQ.data || []} onSaved={refresh} />
    </DashboardLayout>
  );
}

function MovementsTable({ rows, inventory }: any) {
  const nameOf = (id: string) => inventory.find((i: any) => i.id === id)?.feed_name || "—";
  const label: Record<string, string> = { factory_supply: "وارد من المصنع", consumption: "مصروف", opening: "رصيد افتتاحي", adjustment: "تعديل", reversal: "إلغاء حركة" };
  const color: Record<string, string> = { factory_supply: "default", consumption: "destructive", opening: "secondary", adjustment: "outline", reversal: "outline" };
  return (
    <Card><CardContent className="p-3">
      <Table>
        <TableHeader><TableRow>
          <TableHead>التاريخ</TableHead><TableHead>الصنف</TableHead><TableHead>النوع</TableHead>
          <TableHead>الكمية</TableHead><TableHead>سعر/كجم</TableHead><TableHead>الإجمالي</TableHead>
          <TableHead>المصدر / الفاتورة</TableHead><TableHead>ملاحظات</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((m: any) => (
            <TableRow key={m.id}>
              <TableCell className="text-xs">{new Date(m.performed_at).toLocaleString("ar-EG")}</TableCell>
              <TableCell>{nameOf(m.feed_id)}</TableCell>
              <TableCell><Badge variant={(color[m.movement_type] || "outline") as any}>{label[m.movement_type] || m.movement_type}</Badge></TableCell>
              <TableCell className="font-bold">{fmt(m.quantity_kg)}</TableCell>
              <TableCell>{fmt(m.unit_cost)}</TableCell>
              <TableCell>{fmt(m.total_cost)}</TableCell>
              <TableCell className="text-xs">
                {m.source_type === "feed_factory_invoice" ? <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{m.invoice_no || m.source_id?.slice(0, 8)}</span> : (m.source_type || "—")}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{m.notes}</TableCell>
            </TableRow>
          ))}
          {!rows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">لا توجد حركات</TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function IssueFeedDialog({ open, onOpenChange, inventory, onSaved }: any) {
  const [feedId, setFeedId] = useState("");
  const [qty, setQty] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setFeedId(""); setQty(0); setNotes(""); }
  }, [open]);

  const save = async () => {
    if (!feedId) return toast.error("اختر الصنف");
    if (!qty || qty <= 0) return toast.error("ادخل كمية صحيحة");
    const inv = inventory.find((i: any) => i.id === feedId);
    if (inv && qty > Number(inv.current_kg)) return toast.error(`الرصيد الحالي ${fmt(inv.current_kg)} كجم فقط`);
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("slaughterhouse_feed_movements" as any).insert({
        feed_id: feedId,
        movement_type: "consumption",
        quantity_kg: qty,
        unit_cost: inv?.last_unit_cost || 0,
        total_cost: qty * Number(inv?.last_unit_cost || 0),
        source_type: "manual_issue",
        notes,
        performed_by: user?.id,
      });
      if (error) throw error;
      toast.success("تم تسجيل صرف العلف للنعام");
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "فشل الحفظ");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader><DialogTitle>صرف علف للنعام التسمين</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>الصنف</Label>
            <Select value={feedId} onValueChange={setFeedId}>
              <SelectTrigger><SelectValue placeholder="اختر الصنف" /></SelectTrigger>
              <SelectContent>
                {inventory.map((i: any) => (
                  <SelectItem key={i.id} value={i.id}>{i.feed_name} (متاح: {fmt(i.current_kg)} كجم)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>الكمية (كجم)</Label>
            <Input type="number" value={qty || ""} onChange={(e) => setQty(Number(e.target.value))} />
          </div>
          <div>
            <Label>ملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="مثال: تغذية يومية / حظيرة 3..." />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
