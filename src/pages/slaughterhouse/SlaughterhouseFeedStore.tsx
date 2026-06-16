import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wheat, ArrowDownToLine, ArrowUpFromLine, Boxes, FileText, RefreshCw, Printer, Drumstick } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import FeedInternalDebtDashboard from "@/components/feed/FeedInternalDebtDashboard";
import { openPrintWindow } from "@/lib/printPdf";
import { OstrichFeedConsumptionDialog } from "@/components/slaughterhouse/OstrichFeedConsumptionDialog";

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

const FATTENING_TAG = "__FATTENING__";

// Encode extra structured fields in the notes column to avoid a schema change.
function encodeFatteningNotes(payload: { birds?: number; perBirdKg?: number; responsible?: string; note?: string }) {
  return `${FATTENING_TAG}${JSON.stringify({
    b: payload.birds || 0,
    r: payload.perBirdKg || 0,
    p: payload.responsible || "",
    n: payload.note || "",
  })}`;
}
function decodeFatteningNotes(notes?: string | null) {
  if (!notes || !notes.startsWith(FATTENING_TAG)) return null;
  try {
    const raw = JSON.parse(notes.slice(FATTENING_TAG.length));
    return { birds: Number(raw.b || 0), perBirdKg: Number(raw.r || 0), responsible: String(raw.p || ""), note: String(raw.n || "") };
  } catch { return null; }
}
const isCancelledNote = (n?: string | null) => !!n && n.trim().startsWith("[ملغي]");

export default function SlaughterhouseFeedStore() {
  const qc = useQueryClient();
  const { roles } = useAuth() as any;
  const canManage = (roles || []).some((r: string) =>
    ["general_manager", "executive_manager", "slaughterhouse_manager", "warehouse_supervisor"].includes(r),
  );

  const invQ = useQuery({
    queryKey: ["sl_feed_inv"],
    queryFn: async () => {
      const { data, error } = await supabase.from("slaughterhouse_feed_inventory" as any).select("*").order("feed_name");
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
        .limit(1000);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const [issueOpen, setIssueOpen] = useState(false);
  const [fatteningOpen, setFatteningOpen] = useState(false);
  const [ostrichOpen, setOstrichOpen] = useState(false);

  const liveBatchesQ = useQuery({
    queryKey: ["sl_live_batches_for_feed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slaughter_live_receipts" as any)
        .select("id,receipt_number,receipt_date,bird_count,current_alive_count,cost_per_bird_current")
        .gt("current_alive_count", 0)
        .order("receipt_date", { ascending: false });
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const ostrichLogQ = useQuery({
    queryKey: ["sl_ostrich_feed_log_tab"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slaughter_ostrich_feed_consumption" as any)
        .select("*, live:slaughter_live_receipts!live_batch_id(receipt_number)")
        .order("consumption_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const movs = movQ.data || [];
  const inv = invQ.data || [];

  // Inflow tab: exclude cancelled supplies
  const inflowRows = useMemo(
    () => movs.filter((m: any) => ["factory_supply", "opening"].includes(m.movement_type) && !isCancelledNote(m.notes)),
    [movs],
  );
  const outflowRows = useMemo(() => movs.filter((m: any) => m.movement_type === "consumption"), [movs]);
  const fatteningRows = useMemo(
    () => movs.filter((m: any) => m.movement_type === "consumption" && decodeFatteningNotes(m.notes)),
    [movs],
  );

  // Pre-compute before/after balances per feed by walking movements oldest→newest
  const balancesByMovementId = useMemo(() => {
    const m = new Map<string, { before: number; after: number }>();
    const byFeed = new Map<string, any[]>();
    movs.forEach((mv: any) => {
      if (isCancelledNote(mv.notes)) return; // cancelled supplies don't move stock
      const arr = byFeed.get(mv.feed_id) || [];
      arr.push(mv);
      byFeed.set(mv.feed_id, arr);
    });
    byFeed.forEach((arr) => {
      arr.sort((a, b) => new Date(a.performed_at).getTime() - new Date(b.performed_at).getTime());
      let running = 0;
      arr.forEach((mv) => {
        const before = running;
        const qty = Number(mv.quantity_kg || 0);
        const signed = mv.movement_type === "consumption" ? -Math.abs(qty) : qty;
        running += signed;
        m.set(mv.id, { before, after: running });
      });
    });
    return m;
  }, [movs]);

  const totals = useMemo(() => {
    const balance = inv.reduce((s, r) => s + Number(r.current_kg || 0), 0);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const monthMov = movs.filter((m: any) => m.performed_at >= monthStart && !isCancelledNote(m.notes));
    const inMonth = monthMov
      .filter((m: any) => ["factory_supply", "opening"].includes(m.movement_type))
      .reduce((s, m) => s + Number(m.quantity_kg), 0);
    const outMonth = monthMov.filter((m: any) => m.movement_type === "consumption").reduce((s, m) => s + Number(m.quantity_kg), 0);
    const outToday = movs
      .filter((m: any) => m.movement_type === "consumption" && m.performed_at >= todayStart)
      .reduce((s, m) => s + Number(m.quantity_kg), 0);

    // Avg daily + peak day from consumption only
    const daily = new Map<string, number>();
    movs
      .filter((m: any) => m.movement_type === "consumption")
      .forEach((m: any) => {
        const d = new Date(m.performed_at).toISOString().slice(0, 10);
        daily.set(d, (daily.get(d) || 0) + Number(m.quantity_kg || 0));
      });
    const days = Array.from(daily.values());
    const avgDaily = days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0;
    let peakDay = { date: "—", qty: 0 };
    daily.forEach((q, d) => { if (q > peakDay.qty) peakDay = { date: d, qty: q }; });
    return { balance, inMonth, outMonth, outToday, avgDaily, peakDay };
  }, [inv, movs]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["sl_feed_inv"] });
    qc.invalidateQueries({ queryKey: ["sl_feed_mov"] });
    qc.invalidateQueries({ queryKey: ["sl_ostrich_feed_log_tab"] });
    qc.invalidateQueries({ queryKey: ["sl_live_batches_for_feed"] });
  };

  const printFattening = () => {
    const nameOf = (id: string) => inv.find((i: any) => i.id === id)?.feed_name || "—";
    const rows = fatteningRows
      .map((m: any) => {
        const d = decodeFatteningNotes(m.notes);
        const bal = balancesByMovementId.get(m.id);
        return `<tr>
          <td>${new Date(m.performed_at).toLocaleString("ar-EG")}</td>
          <td>${nameOf(m.feed_id)}</td>
          <td>${fmt(m.quantity_kg)}</td>
          <td>${d?.birds || "—"}</td>
          <td>${d?.responsible || "—"}</td>
          <td>${bal ? fmt(bal.before) : "—"}</td>
          <td>${bal ? fmt(bal.after) : "—"}</td>
          <td>${d?.note || ""}</td>
        </tr>`;
      })
      .join("");
    openPrintWindow(
      "سجل صرف علف نعام التسمين",
      `<h2>سجل صرف علف نعام التسمين</h2>
        <table border="1" cellspacing="0" cellpadding="6" style="width:100%;border-collapse:collapse">
          <thead><tr><th>التاريخ</th><th>نوع العلف</th><th>الكمية (كجم)</th><th>عدد النعام</th><th>المسؤول</th><th>الرصيد قبل</th><th>الرصيد بعد</th><th>ملاحظات</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="8" style="text-align:center">لا توجد حركات</td></tr>`}</tbody>
        </table>`,
    );
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Wheat className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">مخزن علف المجزر — علف النعام التسمين</h1>
              <p className="text-sm text-muted-foreground">وارد من مصنع العلف ومصروف لتغذية النعام المنتظر دبحه</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4 ml-1" />تحديث</Button>
            {canManage && (
              <>
                <Button onClick={() => setOstrichOpen(true)} className="bg-orange-600 hover:bg-orange-700">
                  <Drumstick className="h-4 w-4 ml-1" />صرف علف للنعام (دفعات الدبح)
                </Button>
                <Button variant="outline" onClick={() => setFatteningOpen(true)}>
                  <Drumstick className="h-4 w-4 ml-1" />صرف علف للنعام التسمين
                </Button>
                <Button variant="outline" onClick={() => setIssueOpen(true)}>
                  <ArrowUpFromLine className="h-4 w-4 ml-1" />صرف عام
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Boxes className="h-4 w-4 text-primary" />الرصيد الحالي</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold text-primary">{fmt(totals.balance)} كجم</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ArrowDownToLine className="h-4 w-4 text-emerald-600" />وارد الشهر</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold text-emerald-700">{fmt(totals.inMonth)} كجم</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ArrowUpFromLine className="h-4 w-4 text-orange-600" />مصروف الشهر</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold text-orange-700">{fmt(totals.outMonth)} كجم</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">مصروف اليوم</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold">{fmt(totals.outToday)} كجم</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">متوسط/يوم</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold">{fmt(totals.avgDaily)} كجم</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">أعلى يوم استهلاك</CardTitle></CardHeader>
            <CardContent><div className="text-base font-bold">{fmt(totals.peakDay.qty)} كجم</div><div className="text-xs text-muted-foreground">{totals.peakDay.date}</div></CardContent></Card>
        </div>

        <FeedInternalDebtDashboard department="slaughterhouse" />

        <Tabs defaultValue="balances" dir="rtl">
          <TabsList className="bg-muted/60 p-2 flex-wrap h-auto">
            <TabsTrigger value="balances">الأرصدة</TabsTrigger>
            <TabsTrigger value="inflow">وارد من المصنع</TabsTrigger>
            <TabsTrigger value="ostrich-log">سجل صرف العلف للنعام (الدبح)</TabsTrigger>
            <TabsTrigger value="fattening">سجل صرف علف نعام التسمين</TabsTrigger>
            <TabsTrigger value="outflow">كل المصروفات</TabsTrigger>
            <TabsTrigger value="all">كل الحركات</TabsTrigger>
          </TabsList>

          <TabsContent value="balances">
            <Card><CardContent className="p-3">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>الصنف</TableHead><TableHead>الرصيد (كجم)</TableHead>
                  <TableHead>آخر سعر/كجم</TableHead><TableHead>قيمة الرصيد</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {inv.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.feed_name}</TableCell>
                      <TableCell><Badge variant={Number(r.current_kg) > 0 ? "default" : "secondary"}>{fmt(r.current_kg)}</Badge></TableCell>
                      <TableCell>{fmt(r.last_unit_cost)}</TableCell>
                      <TableCell className="font-bold">{fmt(Number(r.current_kg) * Number(r.last_unit_cost))} ج.م</TableCell>
                    </TableRow>
                  ))}
                  {!inv.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">لا توجد أصناف بعد</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="inflow"><MovementsTable rows={inflowRows} inventory={inv} /></TabsContent>

          <TabsContent value="fattening">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">سجل صرف علف نعام التسمين</CardTitle>
                <Button size="sm" variant="outline" onClick={printFattening}><Printer className="h-4 w-4 ml-1" />طباعة</Button>
              </CardHeader>
              <CardContent className="p-3">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>التاريخ</TableHead><TableHead>نوع العلف</TableHead>
                    <TableHead>الكمية</TableHead><TableHead>عدد النعام</TableHead>
                    <TableHead>المسؤول</TableHead><TableHead>الرصيد قبل</TableHead>
                    <TableHead>الرصيد بعد</TableHead><TableHead>ملاحظات</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {fatteningRows.map((m: any) => {
                      const d = decodeFatteningNotes(m.notes);
                      const bal = balancesByMovementId.get(m.id);
                      const nameOf = inv.find((i: any) => i.id === m.feed_id)?.feed_name || "—";
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="text-xs">{new Date(m.performed_at).toLocaleString("ar-EG")}</TableCell>
                          <TableCell>{nameOf}</TableCell>
                          <TableCell className="font-bold">{fmt(m.quantity_kg)}</TableCell>
                          <TableCell>{d?.birds || "—"}</TableCell>
                          <TableCell>{d?.responsible || "—"}</TableCell>
                          <TableCell>{bal ? fmt(bal.before) : "—"}</TableCell>
                          <TableCell className="font-medium">{bal ? fmt(bal.after) : "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{d?.note}</TableCell>
                        </TableRow>
                      );
                    })}
                    {!fatteningRows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">لا توجد حركات صرف للنعام التسمين</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ostrich-log">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">سجل صرف العلف للنعام (محمّل على دفعات الدبح)</CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>التاريخ</TableHead><TableHead>الدفعة</TableHead>
                    <TableHead>نوع العلف</TableHead><TableHead>الكمية (كجم)</TableHead>
                    <TableHead>سعر/كجم</TableHead><TableHead>إجمالي التكلفة</TableHead>
                    <TableHead>الرصيد قبل</TableHead><TableHead>الرصيد بعد</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(ostrichLogQ.data || []).map((r: any) => (
                      <TableRow key={r.id} className={r.reversed_at ? "opacity-60" : ""}>
                        <TableCell className="text-xs">{r.consumption_date}</TableCell>
                        <TableCell className="text-xs font-medium">{r.live?.receipt_number || "—"}</TableCell>
                        <TableCell>{r.feed_name}</TableCell>
                        <TableCell className="font-bold">{fmt(r.quantity_kg)}</TableCell>
                        <TableCell>{fmt(r.unit_cost)}</TableCell>
                        <TableCell className="font-bold text-orange-700">{fmt(r.total_cost)}</TableCell>
                        <TableCell>{fmt(r.stock_before)}</TableCell>
                        <TableCell className="font-medium">{fmt(r.stock_after)}</TableCell>
                        <TableCell>{r.reversed_at ? <Badge variant="destructive">عكس: {r.reversal_reason}</Badge> : <Badge variant="default">نشطة</Badge>}</TableCell>
                      </TableRow>
                    ))}
                    {!(ostrichLogQ.data || []).length && (
                      <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="outflow"><MovementsTable rows={outflowRows} inventory={inv} /></TabsContent>
          <TabsContent value="all"><MovementsTable rows={movs} inventory={inv} /></TabsContent>
        </Tabs>
      </div>

      <IssueFeedDialog open={issueOpen} onOpenChange={setIssueOpen} inventory={inv} onSaved={refresh} />
      <FatteningFeedDialog open={fatteningOpen} onOpenChange={setFatteningOpen} inventory={inv} onSaved={refresh} />
      <OstrichFeedConsumptionDialog
        open={ostrichOpen}
        onOpenChange={setOstrichOpen}
        liveBatches={(liveBatchesQ.data || []) as any}
        feedInventory={inv as any}
        onSaved={refresh}
      />
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
          {rows.map((m: any) => {
            const cancelled = isCancelledNote(m.notes);
            const fat = decodeFatteningNotes(m.notes);
            return (
              <TableRow key={m.id} className={cancelled ? "opacity-60" : ""}>
                <TableCell className="text-xs">{new Date(m.performed_at).toLocaleString("ar-EG")}</TableCell>
                <TableCell>{nameOf(m.feed_id)}</TableCell>
                <TableCell>
                  <Badge variant={(color[m.movement_type] || "outline") as any}>{label[m.movement_type] || m.movement_type}</Badge>
                  {cancelled && <Badge variant="destructive" className="mr-1">ملغي</Badge>}
                </TableCell>
                <TableCell className="font-bold">{fmt(m.quantity_kg)}</TableCell>
                <TableCell>{fmt(m.unit_cost)}</TableCell>
                <TableCell>{fmt(m.total_cost)}</TableCell>
                <TableCell className="text-xs">
                  {m.source_type === "feed_factory_invoice" ? <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{m.invoice_no || m.source_id?.slice(0, 8)}</span> : (m.source_type || "—")}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{fat ? `تسمين — ${fat.birds || 0} نعامة — ${fat.responsible || ""} — ${fat.note || ""}` : m.notes}</TableCell>
              </TableRow>
            );
          })}
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

  useEffect(() => { if (open) { setFeedId(""); setQty(0); setNotes(""); } }, [open]);

  const save = async () => {
    if (saving) return;
    if (!feedId) return toast.error("اختر الصنف");
    if (!qty || qty <= 0) return toast.error("ادخل كمية صحيحة");
    const inv = inventory.find((i: any) => i.id === feedId);
    if (inv && qty > Number(inv.current_kg)) return toast.error(`الرصيد الحالي ${fmt(inv.current_kg)} كجم فقط`);
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("slaughterhouse_feed_movements" as any).insert({
        feed_id: feedId, movement_type: "consumption", quantity_kg: qty,
        unit_cost: inv?.last_unit_cost || 0, total_cost: qty * Number(inv?.last_unit_cost || 0),
        source_type: "manual_issue", notes, performed_by: user?.id,
      });
      if (error) throw error;
      toast.success("تم تسجيل صرف العلف");
      onOpenChange(false); onSaved();
    } catch (e: any) { toast.error(e.message || "فشل الحفظ"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader><DialogTitle>صرف علف (عام)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>الصنف</Label>
            <Select value={feedId} onValueChange={setFeedId}>
              <SelectTrigger><SelectValue placeholder="اختر الصنف" /></SelectTrigger>
              <SelectContent>{inventory.map((i: any) => <SelectItem key={i.id} value={i.id}>{i.feed_name} (متاح: {fmt(i.current_kg)} كجم)</SelectItem>)}</SelectContent>
            </Select></div>
          <div><Label>الكمية (كجم)</Label><Input type="number" value={qty || ""} onChange={(e) => setQty(Number(e.target.value))} /></div>
          <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FatteningFeedDialog({ open, onOpenChange, inventory, onSaved }: any) {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 16));
  const [feedId, setFeedId] = useState("");
  const [birds, setBirds] = useState<number>(0);
  const [perBird, setPerBird] = useState<number>(0);
  const [qty, setQty] = useState<number>(0);
  const [qtyTouched, setQtyTouched] = useState(false);
  const [responsible, setResponsible] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(new Date().toISOString().slice(0, 16));
      setFeedId(""); setBirds(0); setPerBird(0); setQty(0); setQtyTouched(false); setResponsible(""); setNote("");
    }
  }, [open]);

  // Auto-compute total when birds*perBird changes (unless user typed qty manually)
  useEffect(() => {
    if (!qtyTouched && birds > 0 && perBird > 0) setQty(Number((birds * perBird).toFixed(3)));
  }, [birds, perBird, qtyTouched]);

  const inv = inventory.find((i: any) => i.id === feedId);
  const available = Number(inv?.current_kg || 0);

  const save = async () => {
    if (saving) return;
    if (!feedId) return toast.error("اختر نوع العلف");
    if (!qty || qty <= 0) return toast.error("ادخل كمية صحيحة");
    if (qty > available) return toast.error("الرصيد المتاح من علف المجزر غير كافٍ لإتمام الصرف");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const ts = Date.now();
      const refDate = date.slice(0, 10);
      const reference_no = `slaughter_fattening_feed_${refDate}_${feedId.slice(0, 8)}_${ts}`;
      const performed_at = new Date(date).toISOString();
      const encoded = encodeFatteningNotes({ birds, perBirdKg: perBird, responsible, note });
      const { error } = await supabase.from("slaughterhouse_feed_movements" as any).insert({
        feed_id: feedId,
        movement_type: "consumption",
        quantity_kg: qty,
        unit_cost: inv?.last_unit_cost || 0,
        total_cost: qty * Number(inv?.last_unit_cost || 0),
        source_type: "slaughter_fattening_feed_consumption",
        reference_no,
        notes: encoded,
        performed_by: user?.id,
        performed_at,
      });
      if (error) throw error;
      toast.success(`تم صرف ${fmt(qty)} كجم — الرصيد بعد: ${fmt(available - qty)} كجم`);
      onOpenChange(false); onSaved();
    } catch (e: any) {
      toast.error(e.message || "فشل الحفظ");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Drumstick className="h-5 w-5 text-orange-600" />صرف علف للنعام التسمين</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>التاريخ والوقت</Label><Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label>نوع العلف</Label>
            <Select value={feedId} onValueChange={setFeedId}>
              <SelectTrigger><SelectValue placeholder="اختر العلف" /></SelectTrigger>
              <SelectContent>{inventory.map((i: any) => <SelectItem key={i.id} value={i.id}>{i.feed_name} (متاح: {fmt(i.current_kg)} كجم)</SelectItem>)}</SelectContent>
            </Select></div>
          <div><Label>عدد النعام</Label><Input type="number" value={birds || ""} onChange={(e) => setBirds(Number(e.target.value))} /></div>
          <div><Label>معدل الاستهلاك/نعامة (كجم)</Label><Input type="number" step="0.01" value={perBird || ""} onChange={(e) => setPerBird(Number(e.target.value))} /></div>
          <div className="col-span-2"><Label>إجمالي الكمية المصروفة (كجم)</Label>
            <Input type="number" step="0.01" value={qty || ""} onChange={(e) => { setQtyTouched(true); setQty(Number(e.target.value)); }} />
            {feedId && <div className="text-xs text-muted-foreground mt-1">الرصيد قبل الصرف: <b>{fmt(available)}</b> كجم — الرصيد بعد: <b className={qty > available ? "text-destructive" : ""}>{fmt(available - qty)}</b> كجم</div>}
          </div>
          <div className="col-span-2"><Label>المسؤول عن الصرف</Label><Input value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="اسم المسؤول" /></div>
          <div className="col-span-2"><Label>ملاحظات</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="مثال: حظيرة رقم 3 - الوجبة الصباحية" /></div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving || !feedId || qty <= 0 || qty > available} className="bg-orange-600 hover:bg-orange-700">
            {saving ? "جاري الحفظ..." : "حفظ الصرف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
