import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, FileSpreadsheet, FileText, Printer, Search, Users } from "lucide-react";
import * as XLSX from "xlsx";
import { openPrintWindow, escapeHtml } from "@/lib/printPdf";
import { supabase } from "@/integrations/supabase/client";
import {
  aggregateByCustomer,
  batchStageLabel,
  CustomerStats,
  HatchBatchRow,
  HatchCustomerLite,
} from "@/lib/hatcheryCustomerStats";

const fmt = (n: number) => Math.round(n || 0).toLocaleString("ar-EG");
const pct = (n: number) => (n || 0).toFixed(1) + "%";

type SortKey = "eggs" | "batches" | "chicks" | "charge";

export default function HatcheryCustomerStatements() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCustomer = searchParams.get("customer") || "";

  const [batches, setBatches] = useState<HatchBatchRow[]>([]);
  const [customers, setCustomers] = useState<HatchCustomerLite[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeInternal, setIncludeInternal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "in_progress">("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("eggs");
  const [openCustomer, setOpenCustomer] = useState<CustomerStats | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const all: HatchBatchRow[] = [];
      let off = 0;
      const SIZE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("hatch_batches")
          .select(
            "id,customer_id,is_test,entry_date,receive_date,machine,batch_number,operational_batch_no,status,received_eggs,net_eggs,candle1_fertile,candle1_infertile,candle2_dead,hatcher_dead,hatched_chicks,exit_date,notes",
          )
          .range(off, off + SIZE - 1);
        if (error) break;
        all.push(...((data ?? []) as any));
        if (!data || data.length < SIZE) break;
        off += SIZE;
      }
      setBatches(all);
      const { data: cs } = await supabase.from("hatch_customers").select("*");
      setCustomers((cs ?? []) as any);
      const { data: ps } = await supabase
        .from("hatch_customer_payments")
        .select("customer_id,amount,payment_date");
      setPayments(ps ?? []);
      setLoading(false);
    })();
  }, []);

  // Auto-open dialog when ?customer=... and data loads
  useEffect(() => {
    if (!initialCustomer || loading) return;
    const stats = aggregateByCustomer(batches, customers, payments as any, {
      includeInternal: true,
    });
    const found = stats.find((s) => s.customer_id === initialCustomer);
    if (found) setOpenCustomer(found);
  }, [initialCustomer, loading, batches, customers, payments]);

  const stats = useMemo(() => {
    const arr = aggregateByCustomer(batches, customers, payments as any, {
      includeInternal,
      from: from || undefined,
      to: to || undefined,
      statusFilter,
      search,
    });
    const byKey: Record<SortKey, (s: CustomerStats) => number> = {
      eggs: (s) => s.total_eggs,
      batches: (s) => s.batches,
      chicks: (s) => s.chicks,
      charge: (s) => s.estimated_charge,
    };
    return [...arr].sort((a, b) => byKey[sortBy](b) - byKey[sortBy](a));
  }, [batches, customers, payments, includeInternal, from, to, statusFilter, search, sortBy]);

  const totals = useMemo(
    () =>
      stats.reduce(
        (acc, s) => ({
          customers: acc.customers + 1,
          batches: acc.batches + s.batches,
          eggs: acc.eggs + s.total_eggs,
          chicks: acc.chicks + s.chicks,
          charge: acc.charge + s.estimated_charge,
          paid: acc.paid + s.paid,
          remaining: acc.remaining + s.remaining,
        }),
        { customers: 0, batches: 0, eggs: 0, chicks: 0, charge: 0, paid: 0, remaining: 0 },
      ),
    [stats],
  );

  const exportExcel = () => {
    const data = stats.map((s, i) => ({
      "الترتيب": i + 1,
      "العميل": s.name,
      "النوع": s.is_internal ? "داخلي" : "خارجي",
      "عدد الدفعات": s.batches,
      "إجمالي البيض": s.total_eggs,
      "إجمالي الصافي": s.net_eggs,
      "غير المخصب": s.infertile,
      "المخصب": s.fertile,
      "نافق كشف 2": s.candle2_dead,
      "نافق هاتشر": s.hatcher_dead,
      "الكتاكيت": s.chicks,
      "نسبة الخصوبة": pct(s.fertility_pct),
      "نسبة الفقس": pct(s.hatch_rate_pct),
      "الحساب التقديري": s.estimated_charge,
      "المحصل": s.paid,
      "المتبقي": s.remaining,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "كشف العملاء");
    XLSX.writeFile(wb, `كشف-عملاء-المعمل-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const buildPdfBody = (compact: boolean) => {
    const head = `
      <h1>كشف حساب عملاء المعمل حسب البيض والدفعات</h1>
      <div style="font-size:11px;margin-bottom:8px">${new Date().toLocaleString("ar-EG")}</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px"><tr>
        <td>عدد العملاء: <b>${totals.customers}</b></td>
        <td>إجمالي الدفعات: <b>${totals.batches}</b></td>
        <td>إجمالي البيض: <b>${fmt(totals.eggs)}</b></td>
        <td>إجمالي الكتاكيت: <b>${fmt(totals.chicks)}</b></td>
      </tr><tr>
        <td>الحساب التقديري الكلي: <b>${fmt(totals.charge)} ج.م</b></td>
        <td>المحصل: <b>${fmt(totals.paid)} ج.م</b></td>
        <td>المتبقي: <b>${fmt(totals.remaining)} ج.م</b></td>
        <td></td>
      </tr></table>`;
    if (compact) return head;
    const rows = stats
      .map(
        (s, i) => `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.is_internal ? "داخلي" : "خارجي"}</td>
        <td>${s.batches}</td>
        <td>${s.total_eggs}</td>
        <td>${s.fertile}</td>
        <td>${s.infertile}</td>
        <td>${s.chicks}</td>
        <td>${pct(s.fertility_pct)}</td>
        <td>${pct(s.hatch_rate_pct)}</td>
        <td>${fmt(s.estimated_charge)}</td>
        <td>${fmt(s.paid)}</td>
        <td>${fmt(s.remaining)}</td>
      </tr>`,
      )
      .join("");
    return (
      head +
      `<table style="width:100%;border-collapse:collapse;font-size:10px" border="1">
        <thead><tr style="background:#eee">
          <th>#</th><th>العميل</th><th>النوع</th><th>دفعات</th>
          <th>بيض</th><th>مخصب</th><th>غير مخصب</th><th>كتاكيت</th>
          <th>الخصوبة</th><th>الفقس</th><th>تقديري</th><th>محصل</th><th>متبقي</th>
        </tr></thead><tbody>${rows}</tbody></table>`
    );
  };

  const printCustomer = (c: CustomerStats) => {
    const rowsHtml = c.rowsRaw
      .slice()
      .sort((a, b) => (a.entry_date || "").localeCompare(b.entry_date || ""))
      .map(
        (r) => `<tr>
          <td>${r.operational_batch_no ?? "—"}</td>
          <td>${r.entry_date || "—"}</td>
          <td>${escapeHtml(r.machine || "—")}</td>
          <td>${r.received_eggs || 0}</td>
          <td>${r.candle1_fertile || 0}</td>
          <td>${r.candle1_infertile || 0}</td>
          <td>${r.hatched_chicks || 0}</td>
          <td>${escapeHtml(batchStageLabel(r))}</td>
        </tr>`,
      )
      .join("");
    const body = `
      <h1>كشف حساب العميل — ${escapeHtml(c.name)}</h1>
      <div style="font-size:11px">النوع: <b>${c.is_internal ? "داخلي (نعام العاصمة)" : "خارجي"}</b> — ${new Date().toLocaleString("ar-EG")}</div>
      <table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:11px"><tr>
        <td>عدد الدفعات: <b>${c.batches}</b></td>
        <td>إجمالي البيض: <b>${fmt(c.total_eggs)}</b></td>
        <td>الصافي: <b>${fmt(c.net_eggs)}</b></td>
        <td>المخصب: <b>${fmt(c.fertile)}</b></td>
      </tr><tr>
        <td>غير المخصب: <b>${fmt(c.infertile)}</b></td>
        <td>نافق كشف2: <b>${fmt(c.candle2_dead)}</b></td>
        <td>نافق هاتشر: <b>${fmt(c.hatcher_dead)}</b></td>
        <td>الكتاكيت: <b>${fmt(c.chicks)}</b></td>
      </tr><tr>
        <td>الخصوبة: <b>${pct(c.fertility_pct)}</b></td>
        <td>الفقس: <b>${pct(c.hatch_rate_pct)}</b></td>
        <td>تقديري: <b>${fmt(c.estimated_charge)} ج.م</b></td>
        <td>محصل/متبقي: <b>${fmt(c.paid)} / ${fmt(c.remaining)}</b></td>
      </tr></table>
      <table style="width:100%;border-collapse:collapse;font-size:10px" border="1">
        <thead><tr style="background:#eee">
          <th>دفعة</th><th>الدخول</th><th>الماكينة</th><th>بيض</th>
          <th>مخصب</th><th>غير مخصب</th><th>كتاكيت</th><th>الحالة</th>
        </tr></thead><tbody>${rowsHtml}</tbody></table>`;
    openPrintWindow(`كشف حساب — ${c.name}`, body);
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 max-w-[1400px] mx-auto" dir="rtl">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" /> كشف حساب عملاء المعمل حسب البيض والدفعات
          </h1>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={exportExcel}>
              <FileSpreadsheet className="w-4 h-4 ml-1" /> Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => openPrintWindow("كشف عملاء المعمل", buildPdfBody(false))}>
              <Printer className="w-4 h-4 ml-1" /> طباعة PDF
            </Button>
            <Button size="sm" variant="outline" onClick={() => openPrintWindow("ملخص عملاء المعمل", buildPdfBody(true))}>
              <FileText className="w-4 h-4 ml-1" /> ملخص مختصر
            </Button>
          </div>
        </div>

        <Alert className="border-amber-400 bg-amber-50 dark:bg-amber-950/20">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-xs">
            تحليلات وتقارير فقط. الحساب التقديري ليس تحصيلًا فعليًا. نعام العاصمة قيمة داخلية للتحليل ولا تُعتبر مديونية.
            بيانات TEST والصفوف اليتيمة مستبعدة تلقائيًا.
          </AlertDescription>
        </Alert>

        <Card className="p-3">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="relative md:col-span-2">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="بحث باسم العميل..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9"
              />
            </div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="من" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} placeholder="إلى" />
            <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
              <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الدفعات</SelectItem>
                <SelectItem value="completed">مكتملة فقط</SelectItem>
                <SelectItem value="in_progress">جارية فقط</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
              <SelectTrigger><SelectValue placeholder="ترتيب حسب" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="eggs">إجمالي البيض</SelectItem>
                <SelectItem value="batches">عدد الدفعات</SelectItem>
                <SelectItem value="chicks">الكتاكيت</SelectItem>
                <SelectItem value="charge">الحساب التقديري</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Switch id="incl-internal" checked={includeInternal} onCheckedChange={setIncludeInternal} />
            <Label htmlFor="incl-internal" className="text-sm cursor-pointer">يشمل نعام العاصمة (داخلي)</Label>
            {(from || to || search || statusFilter !== "all" || includeInternal) && (
              <Button
                size="sm"
                variant="ghost"
                className="mr-auto"
                onClick={() => {
                  setFrom(""); setTo(""); setSearch("");
                  setStatusFilter("all"); setIncludeInternal(false);
                }}
              >
                مسح الفلاتر
              </Button>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
          <Stat label="عدد العملاء" value={fmt(totals.customers)} />
          <Stat label="إجمالي الدفعات" value={fmt(totals.batches)} />
          <Stat label="إجمالي البيض" value={fmt(totals.eggs)} />
          <Stat label="إجمالي الكتاكيت" value={fmt(totals.chicks)} />
          <Stat label="الحساب التقديري" value={fmt(totals.charge)} />
          <Stat label="المحصل" value={fmt(totals.paid)} />
          <Stat label="المتبقي" value={fmt(totals.remaining)} />
        </div>

        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead className="text-center">دفعات</TableHead>
                <TableHead className="text-center">بيض</TableHead>
                <TableHead className="text-center">الصافي</TableHead>
                <TableHead className="text-center">مخصب</TableHead>
                <TableHead className="text-center">غير مخصب</TableHead>
                <TableHead className="text-center">نافق ك2</TableHead>
                <TableHead className="text-center">نافق هاتشر</TableHead>
                <TableHead className="text-center">كتاكيت</TableHead>
                <TableHead className="text-center">الخصوبة</TableHead>
                <TableHead className="text-center">الفقس</TableHead>
                <TableHead className="text-center">تقديري</TableHead>
                <TableHead className="text-center">محصل</TableHead>
                <TableHead className="text-center">متبقي</TableHead>
                <TableHead className="text-center">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={17} className="text-center py-6">جاري التحميل…</TableCell></TableRow>
              )}
              {!loading && stats.length === 0 && (
                <TableRow><TableCell colSpan={17} className="text-center py-6 text-muted-foreground">لا توجد بيانات.</TableCell></TableRow>
              )}
              {stats.map((s, i) => (
                <TableRow key={s.customer_id} className="hover:bg-muted/40">
                  <TableCell className="font-bold">{i + 1}</TableCell>
                  <TableCell>
                    <button
                      className="font-medium text-primary hover:underline text-right"
                      onClick={() => setOpenCustomer(s)}
                    >
                      {s.name}
                    </button>
                  </TableCell>
                  <TableCell>
                    {s.is_internal ? (
                      <Badge className="bg-purple-600 text-white">داخلي</Badge>
                    ) : (
                      <Badge variant="outline">خارجي</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">{fmt(s.batches)}</TableCell>
                  <TableCell className="text-center font-bold">{fmt(s.total_eggs)}</TableCell>
                  <TableCell className="text-center">{fmt(s.net_eggs)}</TableCell>
                  <TableCell className="text-center">{fmt(s.fertile)}</TableCell>
                  <TableCell className="text-center">{fmt(s.infertile)}</TableCell>
                  <TableCell className="text-center">{fmt(s.candle2_dead)}</TableCell>
                  <TableCell className="text-center">{fmt(s.hatcher_dead)}</TableCell>
                  <TableCell className="text-center">{fmt(s.chicks)}</TableCell>
                  <TableCell className="text-center">{pct(s.fertility_pct)}</TableCell>
                  <TableCell className="text-center">{pct(s.hatch_rate_pct)}</TableCell>
                  <TableCell className="text-center">{fmt(s.estimated_charge)}</TableCell>
                  <TableCell className="text-center">{fmt(s.paid)}</TableCell>
                  <TableCell className="text-center font-semibold">{fmt(s.remaining)}</TableCell>
                  <TableCell className="text-center">
                    <div className="flex gap-1 justify-center">
                      <Button size="sm" variant="outline" onClick={() => setOpenCustomer(s)}>تفاصيل</Button>
                      <Button size="sm" variant="ghost" onClick={() => printCustomer(s)}>
                        <Printer className="w-3 h-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Dialog
          open={!!openCustomer}
          onOpenChange={(o) => {
            if (!o) {
              setOpenCustomer(null);
              if (initialCustomer) setSearchParams({});
            }
          }}
        >
          <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto" dir="rtl">
            {openCustomer && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 flex-wrap">
                    كشف تفصيلي — {openCustomer.name}
                    {openCustomer.is_internal ? (
                      <Badge className="bg-purple-600 text-white">داخلي</Badge>
                    ) : (
                      <Badge variant="outline">خارجي</Badge>
                    )}
                  </DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
                  <Stat label="عدد الدفعات" value={fmt(openCustomer.batches)} />
                  <Stat label="إجمالي البيض" value={fmt(openCustomer.total_eggs)} />
                  <Stat label="الكتاكيت" value={fmt(openCustomer.chicks)} />
                  <Stat label="نسبة الفقس" value={pct(openCustomer.hatch_rate_pct)} />
                  <Stat label="المخصب" value={fmt(openCustomer.fertile)} />
                  <Stat label="غير المخصب" value={fmt(openCustomer.infertile)} />
                  <Stat label="نافق هاتشر" value={fmt(openCustomer.hatcher_dead)} />
                  <Stat label="الخصوبة" value={pct(openCustomer.fertility_pct)} />
                  <Stat label="الحساب التقديري" value={`${fmt(openCustomer.estimated_charge)} ج.م`} />
                  <Stat label="المحصل" value={`${fmt(openCustomer.paid)} ج.م`} />
                  <Stat label="المتبقي" value={`${fmt(openCustomer.remaining)} ج.م`} />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>دفعة</TableHead>
                      <TableHead>الدخول</TableHead>
                      <TableHead>الماكينة</TableHead>
                      <TableHead className="text-center">بيض</TableHead>
                      <TableHead className="text-center">مخصب</TableHead>
                      <TableHead className="text-center">غير مخصب</TableHead>
                      <TableHead className="text-center">كتاكيت</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openCustomer.rowsRaw
                      .slice()
                      .sort((a, b) => (a.entry_date || "").localeCompare(b.entry_date || ""))
                      .map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono">{r.operational_batch_no ?? "—"}</TableCell>
                          <TableCell>{r.entry_date || "—"}</TableCell>
                          <TableCell>{r.machine || "—"}</TableCell>
                          <TableCell className="text-center">{r.received_eggs || 0}</TableCell>
                          <TableCell className="text-center">{r.candle1_fertile || 0}</TableCell>
                          <TableCell className="text-center">{r.candle1_infertile || 0}</TableCell>
                          <TableCell className="text-center">{r.hatched_chicks || 0}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{batchStageLabel(r)}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                <div className="flex gap-2 justify-end pt-3">
                  <Button size="sm" variant="outline" onClick={() => printCustomer(openCustomer)}>
                    <Printer className="w-4 h-4 ml-1" /> طباعة كشف العميل
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-2 bg-muted/20">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold mt-0.5">{value}</div>
    </div>
  );
}
