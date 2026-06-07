import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { fmtNum } from "@/lib/printPdf";
import { Users, FileSpreadsheet, Wallet } from "lucide-react";
import * as XLSX from "xlsx";

type PaymentMethod = "cash" | "vodafone_cash" | "instapay" | "bank_transfer";

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "نقدي",
  vodafone_cash: "فودافون كاش",
  instapay: "إنستا باي",
  bank_transfer: "تحويل بنكي",
};

interface Row {
  id: string;
  movement_date: string;
  customer_name: string | null;
  batch_number: string | null;
  subtotal_amount: number | null;
  discount_amount: number | null;
  invoice_total: number | null;
  collected_amount: number | null;
  remaining_amount: number | null;
  payment_status: string | null;
  payment_method: PaymentMethod;
  status: string;
  notes: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  paid: "مدفوع بالكامل",
  partial: "مدفوع جزئيًا",
  unpaid: "غير مدفوع",
};

export default function LabCustomerDebts() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [fCustomer, setFCustomer] = useState("");
  const [fBatch, setFBatch] = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("lab_treasury_movements")
      .select("id, movement_date, customer_name, batch_number, invoice_total, collected_amount, remaining_amount, payment_status, payment_method, status, notes")
      .eq("movement_type", "income")
      .eq("income_category", "hatching")
      .not("batch_number", "is", null)
      .order("movement_date", { ascending: false })
      .limit(2000);
    if (!error) setRows((data || []) as Row[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((r) => {
    if (fCustomer && !(r.customer_name || "").toLowerCase().includes(fCustomer.toLowerCase())) return false;
    if (fBatch && !(r.batch_number || "").toLowerCase().includes(fBatch.toLowerCase())) return false;
    if (fStatus !== "all" && (r.payment_status || "") !== fStatus) return false;
    if (fFrom && r.movement_date < fFrom) return false;
    if (fTo && r.movement_date > fTo) return false;
    return true;
  }), [rows, fCustomer, fBatch, fStatus, fFrom, fTo]);

  const totals = useMemo(() => {
    let inv = 0, paid = 0, rem = 0;
    for (const r of filtered) {
      inv += Number(r.invoice_total || 0);
      paid += Number(r.collected_amount || 0);
      rem += Number(r.remaining_amount || 0);
    }
    return { inv, paid, rem };
  }, [filtered]);

  function exportExcel() {
    const data = filtered.map((r) => ({
      "التاريخ": r.movement_date,
      "اسم العميل": r.customer_name || "",
      "رقم الدفعة": r.batch_number || "",
      "إجمالي الفاتورة": Number(r.invoice_total || 0),
      "المدفوع": Number(r.collected_amount || 0),
      "المتبقي": Number(r.remaining_amount || 0),
      "حالة الدفع": STATUS_LABEL[r.payment_status || ""] || r.payment_status || "",
      "طريقة التحصيل": PAYMENT_LABELS[r.payment_method] || r.payment_method,
      "حالة الاعتماد": r.status,
      "ملاحظات": r.notes || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "مديونيات عملاء المعمل");
    XLSX.writeFile(wb, `lab-customer-debts-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="w-6 h-6 text-primary" /> مديونيات عملاء معمل الكتاكيت
            </h1>
            <p className="text-sm text-muted-foreground">لكل دفعة: اتحاسب العميل على كام، دفع كام، باقي عليه كام.</p>
          </div>
          <Button onClick={exportExcel} variant="outline" className="gap-2">
            <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">إجمالي الفواتير</div><div className="text-2xl font-mono font-bold">{fmtNum(totals.inv, 2)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">المدفوع</div><div className="text-2xl font-mono font-bold text-[hsl(var(--success))]">{fmtNum(totals.paid, 2)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">المتبقي (مديونيات)</div><div className="text-2xl font-mono font-bold text-destructive">{fmtNum(totals.rem, 2)}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">فلاتر</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div><Label className="text-xs">اسم العميل</Label><Input value={fCustomer} onChange={(e) => setFCustomer(e.target.value)} /></div>
            <div><Label className="text-xs">رقم الدفعة</Label><Input value={fBatch} onChange={(e) => setFBatch(e.target.value)} /></div>
            <div>
              <Label className="text-xs">حالة الدفع</Label>
              <Select value={fStatus} onValueChange={setFStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="paid">مدفوع بالكامل</SelectItem>
                  <SelectItem value="partial">مدفوع جزئيًا</SelectItem>
                  <SelectItem value="unpaid">غير مدفوع</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} /></div>
            <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /> الدفعات ({filtered.length})</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>تاريخ آخر تحصيل</TableHead>
                  <TableHead>اسم العميل</TableHead>
                  <TableHead>رقم الدفعة</TableHead>
                  <TableHead className="text-end">إجمالي الفاتورة</TableHead>
                  <TableHead className="text-end">المدفوع</TableHead>
                  <TableHead className="text-end">المتبقي</TableHead>
                  <TableHead>حالة الدفع</TableHead>
                  <TableHead>طريقة التحصيل</TableHead>
                  <TableHead>حالة الاعتماد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-6">جارٍ التحميل...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
                ) : filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.movement_date}</TableCell>
                    <TableCell>{r.customer_name || "—"}</TableCell>
                    <TableCell className="font-mono">{r.batch_number || "—"}</TableCell>
                    <TableCell className="text-end font-mono">{fmtNum(Number(r.invoice_total || 0), 2)}</TableCell>
                    <TableCell className="text-end font-mono text-[hsl(var(--success))]">{fmtNum(Number(r.collected_amount || 0), 2)}</TableCell>
                    <TableCell className="text-end font-mono text-destructive">{fmtNum(Number(r.remaining_amount || 0), 2)}</TableCell>
                    <TableCell>
                      <Badge variant={r.payment_status === "paid" ? "default" : r.payment_status === "partial" ? "secondary" : "destructive"}>
                        {STATUS_LABEL[r.payment_status || ""] || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>{PAYMENT_LABELS[r.payment_method]}</TableCell>
                    <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
