import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ClipboardCheck, CheckCircle2, XCircle, FileSpreadsheet, Printer, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { openPrintWindow, escapeHtml } from "@/lib/printPdf";

interface Row {
  id: string;
  batch_number: string;
  receive_date: string;
  machine: string | null;
  received_eggs: number;
  net_eggs: number;
  candle1_fertile: number;
  candle1_infertile: number;
  candle2_dead: number;
  hatcher_dead: number;
  hatched_chicks: number;
  status: string;
  notes: string | null;
  customer_id: string | null;
  hatch_customers: { name: string; customer_type: string; incubation_price: number; infertile_price: number; hatcher_price: number } | null;
}

const IMPORT_LOG_ID = "94124ef6-50c0-4054-8e7e-df8c4f286433";

export default function HatchBatchesReview() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<{
    importLogFound: boolean;
    capitalAsDebt: number;
    labTreasuryMovements: number;
    hatcheryTreasuryTxns: number;
  } | null>(null);

  // filters
  const [fCustomer, setFCustomer] = useState("");
  const [fType, setFType] = useState<string>("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fMachine, setFMachine] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fChicks, setFChicks] = useState<string>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);

      // fetch in batches of 1000
      const all: Row[] = [];
      let from = 0;
      const SIZE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("hatch_batches")
          .select("id,batch_number,receive_date,machine,received_eggs,net_eggs,candle1_fertile,candle1_infertile,candle2_dead,hatcher_dead,hatched_chicks,status,notes,customer_id,hatch_customers(name,customer_type,incubation_price,infertile_price,hatcher_price)")
          .order("receive_date", { ascending: false })
          .range(from, from + SIZE - 1);
        if (error) break;
        all.push(...((data ?? []) as any));
        if (!data || data.length < SIZE) break;
        from += SIZE;
      }
      setRows(all);

      // checks
      const { data: logRow } = await supabase
        .from("hatch_batch_import_log").select("id").eq("id", IMPORT_LOG_ID).maybeSingle();
      const { count: ltm } = await supabase
        .from("lab_treasury_movements").select("id", { count: "exact", head: true })
        .gte("created_at", "2026-06-06T08:00:00Z");
      const { count: htx } = await supabase
        .from("hatchery_treasury_txns").select("id", { count: "exact", head: true })
        .gte("created_at", "2026-06-06T08:00:00Z");
      // capital batches with treasury txns
      const capitalIds = all.filter(r => r.hatch_customers?.customer_type === "internal").map(r => r.id);
      let capDebt = 0;
      if (capitalIds.length) {
        const { count } = await supabase
          .from("hatchery_treasury_txns").select("id", { count: "exact", head: true })
          .in("batch_id", capitalIds);
        capDebt = count ?? 0;
      }
      setChecks({
        importLogFound: !!logRow,
        capitalAsDebt: capDebt,
        labTreasuryMovements: ltm ?? 0,
        hatcheryTreasuryTxns: htx ?? 0,
      });
      setLoading(false);
    })();
  }, []);

  const machines = useMemo(() => Array.from(new Set(rows.map(r => r.machine).filter(Boolean))) as string[], [rows]);
  const statuses = useMemo(() => Array.from(new Set(rows.map(r => r.status).filter(Boolean))) as string[], [rows]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      const name = r.hatch_customers?.name ?? "";
      if (fCustomer && !name.includes(fCustomer)) return false;
      if (fType !== "all") {
        const t = r.hatch_customers?.customer_type === "internal" ? "capital" : "external";
        if (t !== fType) return false;
      }
      if (fFrom && r.receive_date < fFrom) return false;
      if (fTo && r.receive_date > fTo) return false;
      if (fMachine !== "all" && r.machine !== fMachine) return false;
      if (fStatus !== "all" && r.status !== fStatus) return false;
      if (fChicks === "with" && (r.hatched_chicks ?? 0) <= 0) return false;
      if (fChicks === "without" && (r.hatched_chicks ?? 0) > 0) return false;
      return true;
    });
  }, [rows, fCustomer, fType, fFrom, fTo, fMachine, fStatus, fChicks]);

  // summary based on filtered set
  const sum = useMemo(() => {
    const s = {
      total: 0, capital: 0, external: 0,
      eggs: 0, net: 0, chicks: 0,
      infertile: 0, candle2Dead: 0, hatcherDead: 0,
      fertile: 0, charge: 0,
    };
    for (const r of filtered) {
      s.total++;
      const cap = r.hatch_customers?.customer_type === "internal";
      if (cap) s.capital++; else s.external++;
      s.eggs += r.received_eggs || 0;
      s.net += r.net_eggs || 0;
      s.chicks += r.hatched_chicks || 0;
      s.infertile += r.candle1_infertile || 0;
      s.fertile += r.candle1_fertile || 0;
      s.candle2Dead += r.candle2_dead || 0;
      s.hatcherDead += r.hatcher_dead || 0;
      // external customer charge = fertile*incubation + infertile*infertile_price + (fertile-hatched)*hatcher_price approximated; we just sum incubation*net as a stable proxy when present
      if (!cap && r.hatch_customers) {
        const c = r.hatch_customers;
        s.charge += (r.candle1_fertile || 0) * Number(c.incubation_price || 0)
                  + (r.candle1_infertile || 0) * Number(c.infertile_price || 0)
                  + Math.max(0, (r.candle1_fertile || 0) - (r.hatched_chicks || 0)) * Number(c.hatcher_price || 0);
      }
    }
    return s;
  }, [filtered]);

  const fertility = sum.eggs > 0 ? (sum.fertile / sum.eggs) * 100 : 0;
  const hatchRate = sum.fertile > 0 ? (sum.chicks / sum.fertile) * 100 : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 max-w-[1400px] mx-auto" dir="rtl">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">مراجعة دفعات المعمل المستوردة</h1>
        </div>

        {/* Verification checks */}
        <Card>
          <CardHeader><CardTitle>تحققات ما بعد الاستيراد</CardTitle></CardHeader>
          <CardContent>
            {!checks ? <div className="text-sm">جاري التحقق…</div> : (
              <div className="grid sm:grid-cols-2 gap-2 text-sm">
                <CheckLine ok={checks.importLogFound}
                  label={`سجل الاستيراد موجود (${IMPORT_LOG_ID.slice(0, 8)}…)`} />
                <CheckLine ok={checks.capitalAsDebt === 0}
                  label={`دفعات العاصمة لا تظهر كمديونية عملاء (${checks.capitalAsDebt} حركة)`} />
                <CheckLine ok={checks.labTreasuryMovements === 0}
                  label={`لم تُنشأ حركات خزنة معمل (${checks.labTreasuryMovements})`} />
                <CheckLine ok={checks.hatcheryTreasuryTxns === 0}
                  label={`لم تُنشأ حركات خزنة تفريخ (${checks.hatcheryTreasuryTxns})`} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Summary */}
        <Card>
          <CardHeader><CardTitle>ملخص الدفعات (حسب الفلاتر)</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="إجمالي الدفعات" value={sum.total} />
              <Stat label="دفعات العاصمة" value={sum.capital} />
              <Stat label="دفعات العملاء" value={sum.external} />
              <Stat label="إجمالي البيض" value={sum.eggs} />
              <Stat label="إجمالي الصافي" value={sum.net} />
              <Stat label="إجمالي الكتاكيت" value={sum.chicks} />
              <Stat label="إجمالي غير المخصب" value={sum.infertile} />
              <Stat label="نافق كشف 2" value={sum.candle2Dead} />
              <Stat label="نافق الهاتشر" value={sum.hatcherDead} />
              <Stat label="نسبة الخصوبة" value={`${fertility.toFixed(1)}%`} />
              <Stat label="نسبة الفقس" value={`${hatchRate.toFixed(1)}%`} />
              <Stat label="حسابات العملاء (تقديري)" value={`${sum.charge.toLocaleString("ar-EG")} ج.م`} />
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <Card>
          <CardHeader><CardTitle>الفلاتر</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <Input placeholder="اسم العميل" value={fCustomer} onChange={e => setFCustomer(e.target.value)} />
              <Select value={fType} onValueChange={setFType}>
                <SelectTrigger><SelectValue placeholder="نوع العميل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل العملاء</SelectItem>
                  <SelectItem value="capital">العاصمة</SelectItem>
                  <SelectItem value="external">عملاء</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} placeholder="من تاريخ" />
              <Input type="date" value={fTo} onChange={e => setFTo(e.target.value)} placeholder="إلى تاريخ" />
              <Select value={fMachine} onValueChange={setFMachine}>
                <SelectTrigger><SelectValue placeholder="الماكينة" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الماكينات</SelectItem>
                  {machines.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={fStatus} onValueChange={setFStatus}>
                <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  {statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={fChicks} onValueChange={setFChicks}>
                <SelectTrigger><SelectValue placeholder="كتاكيت" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="with">بها كتاكيت</SelectItem>
                  <SelectItem value="without">بدون كتاكيت</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" onClick={() => {
                setFCustomer(""); setFType("all"); setFFrom(""); setFTo("");
                setFMachine("all"); setFStatus("all"); setFChicks("all");
              }}>مسح الفلاتر</Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>الدفعات ({filtered.length.toLocaleString("ar-EG")})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل…</div>
            ) : (
              <div className="overflow-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-right">
                      <th className="p-2">العميل</th>
                      <th className="p-2">النوع</th>
                      <th className="p-2">رقم الدفعة</th>
                      <th className="p-2">تاريخ الوارد</th>
                      <th className="p-2">البيض</th>
                      <th className="p-2">الصافي</th>
                      <th className="p-2">المخصب</th>
                      <th className="p-2">غير المخصب</th>
                      <th className="p-2">الكتاكيت</th>
                      <th className="p-2">الماكينة</th>
                      <th className="p-2">الحالة</th>
                      <th className="p-2">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => {
                      const cap = r.hatch_customers?.customer_type === "internal";
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="p-2">{r.hatch_customers?.name ?? "—"}</td>
                          <td className="p-2">
                            <Badge variant={cap ? "secondary" : "outline"}>{cap ? "داخلي" : "خارجي"}</Badge>
                          </td>
                          <td className="p-2 font-mono">{r.batch_number}</td>
                          <td className="p-2">{r.receive_date}</td>
                          <td className="p-2">{r.received_eggs}</td>
                          <td className="p-2">{r.net_eggs}</td>
                          <td className="p-2">{r.candle1_fertile}</td>
                          <td className="p-2">{r.candle1_infertile}</td>
                          <td className="p-2">{r.hatched_chicks}</td>
                          <td className="p-2">{r.machine ?? "—"}</td>
                          <td className="p-2">{r.status}</td>
                          <td className="p-2 max-w-[200px] truncate">{r.notes ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border p-3 bg-muted/20">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-1">{typeof value === "number" ? value.toLocaleString("ar-EG") : value}</div>
    </div>
  );
}

function CheckLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 rounded p-2 ${ok ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-destructive/10"}`}>
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-destructive" />}
      <span>{label}</span>
    </div>
  );
}
