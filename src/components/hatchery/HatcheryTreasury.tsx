import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { Plus, Printer, FileSpreadsheet, Wallet, Trash2 } from "lucide-react";
import { exportCSV } from "@/lib/csvExport";
import { useAuth } from "@/hooks/useAuth";
import { useTestMode } from "@/hooks/useTestMode";

const INCOME_CATEGORIES = ["مبيعات كتاكيت", "إيراد تفريخ بيض عملاء خارجيين", "تحصيل دفعات من عملاء المعمل", "إيراد آخر"];
const EXPENSE_CATEGORIES = ["كهرباء", "صيانة", "رواتب", "أدوية", "مطهرات", "مستلزمات تشغيل", "مصاريف نقل", "مصاريف أخرى"];

export default function HatcheryTreasury() {
  const qc = useQueryClient();
  const { isGeneralManager, isExecutiveManager } = useAuth();
  const { showTest } = useTestMode();
  const tf = (q: any) => (showTest ? q : q.eq("is_test", false));
  const canManage = true; // RLS handles backend; UI exposes to allowed roles
  const canDelete = isGeneralManager || isExecutiveManager;

  const { data: txns = [] } = useQuery({
    queryKey: ["hatchery_treasury_txns", showTest],
    queryFn: async () =>
      (await tf(supabase.from("hatchery_treasury_txns").select("*").order("txn_date", { ascending: false }).limit(2000))).data || [],
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["hatch_customers_tr", showTest],
    queryFn: async () => (await tf(supabase.from("hatch_customers").select("id,name"))).data || [],
  });
  const { data: batches = [] } = useQuery({
    queryKey: ["hatch_batches_tr", showTest],
    queryFn: async () => (await tf(supabase.from("hatch_batches").select("id,batch_number").order("receive_date", { ascending: false }).limit(500))).data || [],
  });

  const balance = useMemo(
    () => (txns as any[]).reduce((s, t) => s + (t.direction === "in" ? Number(t.amount) : -Number(t.amount)), 0),
    [txns]
  );

  const addMut = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase.from("hatchery_treasury_txns").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hatchery_treasury_txns"] }); qc.invalidateQueries({ queryKey: ["hatch_treasury_dash"] }); toast.success("تم تسجيل الحركة"); },
    onError: (e: any) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hatchery_treasury_txns").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hatchery_treasury_txns"] }); toast.success("تم الحذف"); },
    onError: (e: any) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [txnDate, setTxnDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [customerId, setCustomerId] = useState<string>("");
  const [batchId, setBatchId] = useState<string>("");
  const [notes, setNotes] = useState("");

  const submit = async () => {
    if (!category || !amount) return toast.error("أكمل البيانات");
    await addMut.mutateAsync({
      txn_date: txnDate, direction, category, amount: Number(amount),
      customer_id: customerId || null, batch_id: batchId || null, notes: notes || null,
    });
    setOpen(false);
    setCategory(""); setAmount(""); setCustomerId(""); setBatchId(""); setNotes("");
  };

  const printReceipt = (t: any) => {
    const w = window.open("", "_blank");
    if (!w) return;
    const cust = customers.find((c: any) => c.id === t.customer_id)?.name || "—";
    w.document.write(`<html dir="rtl"><head><title>إيصال خزنة معمل التفريخ</title>
      <style>body{font-family:Tahoma;padding:20px}h2{margin:0}table{width:100%;border-collapse:collapse;margin-top:10px}td{padding:6px;border-bottom:1px solid #ddd}</style>
      </head><body>
      <h2>إيصال ${t.direction === "in" ? "قبض" : "صرف"} — خزنة معمل التفريخ</h2>
      <table>
        <tr><td>التاريخ</td><td>${t.txn_date}</td></tr>
        <tr><td>التصنيف</td><td>${t.category}</td></tr>
        <tr><td>المبلغ</td><td>${Number(t.amount).toLocaleString("ar-EG")} ج.م</td></tr>
        <tr><td>العميل</td><td>${cust}</td></tr>
        <tr><td>ملاحظات</td><td>${t.notes || "—"}</td></tr>
      </table>
      <script>window.print()</script></body></html>`);
  };

  const exportXlsx = () => {
    exportCSV("hatchery-treasury.csv", (txns as any[]).map((t) => ({
      التاريخ: t.txn_date,
      النوع: t.direction === "in" ? "إيراد" : "مصروف",
      التصنيف: t.category,
      المبلغ: t.amount,
      العميل: customers.find((c: any) => c.id === t.customer_id)?.name || "",
      الدفعة: batches.find((b: any) => b.id === t.batch_id)?.batch_number || "",
      ملاحظات: t.notes || "",
    })));
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Wallet className="w-5 h-5" />
          <h2 className="text-xl font-bold">خزنة معمل التفريخ</h2>
          <Badge variant="secondary" className="text-base">الرصيد الحالي: {balance.toLocaleString("ar-EG")} ج.م</Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
          <Button size="sm" variant="outline" onClick={exportXlsx}><FileSpreadsheet className="w-4 h-4 ml-1" />تصدير</Button>
          {canManage && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="w-4 h-4 ml-1" />حركة جديدة</Button>
              </DialogTrigger>
              <DialogContent dir="rtl">
                <DialogHeader><DialogTitle>تسجيل حركة خزنة</DialogTitle></DialogHeader>
                <div className="grid gap-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>النوع</Label>
                      <Select value={direction} onValueChange={(v) => { setDirection(v as any); setCategory(""); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="in">إيراد (قبض)</SelectItem>
                          <SelectItem value="out">مصروف (صرف)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>التاريخ</Label>
                      <Input type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label>التصنيف</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                      <SelectContent>
                        {(direction === "in" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>المبلغ</Label>
                    <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>العميل (اختياري)</Label>
                      <Select value={customerId} onValueChange={setCustomerId}>
                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>الدفعة (اختياري)</Label>
                      <Select value={batchId} onValueChange={setBatchId}>
                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {batches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.batch_number}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>ملاحظات</Label>
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={submit} disabled={addMut.isPending}>حفظ</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Card className="p-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>التصنيف</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>العميل</TableHead>
              <TableHead>الدفعة</TableHead>
              <TableHead>ملاحظات</TableHead>
              <TableHead>إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(txns as any[]).map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.txn_date}</TableCell>
                <TableCell>
                  <Badge variant={t.direction === "in" ? "default" : "destructive"}>
                    {t.direction === "in" ? "إيراد" : "مصروف"}
                  </Badge>
                </TableCell>
                <TableCell>{t.category}</TableCell>
                <TableCell className="font-medium">{Number(t.amount).toLocaleString("ar-EG")}</TableCell>
                <TableCell>{customers.find((c: any) => c.id === t.customer_id)?.name || "—"}</TableCell>
                <TableCell>{batches.find((b: any) => b.id === t.batch_id)?.batch_number || "—"}</TableCell>
                <TableCell className="max-w-[200px] truncate">{t.notes || "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => printReceipt(t)}><Printer className="w-3 h-3" /></Button>
                    {canDelete && (
                      <Button size="sm" variant="destructive" onClick={() => {
                        if (confirm("حذف الحركة؟")) delMut.mutate(t.id);
                      }}><Trash2 className="w-3 h-3" /></Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {txns.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">لا توجد حركات</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
