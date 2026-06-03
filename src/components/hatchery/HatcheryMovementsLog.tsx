import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Printer, FileSpreadsheet, Search } from "lucide-react";
import { exportCSV } from "@/lib/csvExport";

type Movement = {
  id: string;
  date: string;
  type: string;
  direction?: "in" | "out" | "";
  customer?: string;
  batch?: string;
  eggs?: number;
  chicks?: number;
  amount?: number;
  status?: string;
  notes?: string;
};

export default function HatcheryMovementsLog() {
  const { data: shipments = [] } = useQuery({
    queryKey: ["hat_log_shipments"],
    queryFn: async () => (await supabase.from("farm_to_hatchery_shipments").select("*").order("production_date", { ascending: false }).limit(500)).data || [],
  });
  const { data: batches = [] } = useQuery({
    queryKey: ["hat_log_batches"],
    queryFn: async () => (await supabase.from("hatch_batches").select("*").order("receive_date", { ascending: false }).limit(500)).data || [],
  });
  const { data: chicks = [] } = useQuery({
    queryKey: ["hat_log_chicks"],
    queryFn: async () => (await supabase.from("chick_movements").select("*").order("movement_date", { ascending: false }).limit(500)).data || [],
  });
  const { data: treasury = [] } = useQuery({
    queryKey: ["hat_log_treasury"],
    queryFn: async () => (await supabase.from("hatchery_treasury_txns").select("*").order("txn_date", { ascending: false }).limit(500)).data || [],
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["hat_log_cust"],
    queryFn: async () => (await supabase.from("hatch_customers").select("id,name")).data || [],
  });

  const custName = (id: string | null) => customers.find((c: any) => c.id === id)?.name || "—";
  const batchNo = (id: string | null) => (batches as any[]).find((b) => b.id === id)?.batch_number || "—";

  const movements: Movement[] = useMemo(() => {
    const rows: Movement[] = [];
    (shipments as any[]).forEach((s) => rows.push({
      id: "S-" + s.id, date: s.production_date, type: "نقل بيض من مزرعة الأمهات",
      direction: "in", customer: "نعام العاصمة", batch: batchNo(s.hatch_batch_id),
      eggs: s.received_egg_count || s.egg_count, status: s.status, notes: s.receipt_notes,
    }));
    (batches as any[]).forEach((b) => {
      rows.push({ id: "B-" + b.id, date: b.receive_date, type: "دخول دفعة", direction: "in",
        customer: custName(b.customer_id), batch: b.batch_number, eggs: b.received_eggs, status: b.status });
      if (b.candle1_date) rows.push({ id: "C1-" + b.id, date: b.candle1_date, type: "كشف إخصاب 1",
        customer: custName(b.customer_id), batch: b.batch_number, eggs: (b.candle1_fertile || 0) + (b.candle1_infertile || 0),
        notes: `مخصب ${b.candle1_fertile || 0} / غير مخصب ${b.candle1_infertile || 0}` });
      if (b.candle2_date) rows.push({ id: "C2-" + b.id, date: b.candle2_date, type: "كشف إخصاب 2 / نقل للهاتشر",
        customer: custName(b.customer_id), batch: b.batch_number, notes: `ميت ${b.candle2_dead || 0}` });
      if (b.exit_date) rows.push({ id: "EX-" + b.id, date: b.exit_date, type: "فقس / خروج كتاكيت", direction: "out",
        customer: custName(b.customer_id), batch: b.batch_number, chicks: b.hatched_chicks, status: "completed",
        notes: `نافق هاتشر ${b.hatcher_dead || 0}` });
    });
    (chicks as any[]).forEach((c) => rows.push({
      id: "CH-" + c.id, date: c.movement_date, type: c.movement_type || "حركة كتاكيت",
      direction: (c.movement_type || "").includes("out") ? "out" : "in",
      chicks: c.qty, notes: c.notes,
    }));
    (treasury as any[]).forEach((t) => rows.push({
      id: "T-" + t.id, date: t.txn_date, type: `خزنة: ${t.category}`,
      direction: t.direction, customer: custName(t.customer_id), batch: batchNo(t.batch_id),
      amount: Number(t.amount), notes: t.notes,
    }));
    return rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [shipments, batches, chicks, treasury, customers]);

  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("all");
  const types = useMemo(() => Array.from(new Set(movements.map((m) => m.type))), [movements]);

  const filtered = useMemo(() => movements.filter((m) => {
    if (type !== "all" && m.type !== type) return false;
    if (search) {
      const q = search.toLowerCase();
      return [m.customer, m.batch, m.notes, m.type].some((v) => (v || "").toLowerCase().includes(q));
    }
    return true;
  }), [movements, type, search]);

  const exportLog = () => exportCSV("hatchery-movements.csv", filtered.map((m) => ({
    التاريخ: m.date, النوع: m.type, الاتجاه: m.direction === "in" ? "وارد" : m.direction === "out" ? "منصرف" : "",
    العميل: m.customer || "", الدفعة: m.batch || "", البيض: m.eggs || "", الكتاكيت: m.chicks || "",
    المبلغ: m.amount || "", الحالة: m.status || "", ملاحظات: m.notes || "",
  })));

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold">سجل حركات معمل التفريخ</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
          <Button size="sm" variant="outline" onClick={exportLog}><FileSpreadsheet className="w-4 h-4 ml-1" />تصدير</Button>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute right-3 top-3 text-muted-foreground" />
          <Input placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-10" />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card className="p-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>الاتجاه</TableHead>
              <TableHead>العميل</TableHead>
              <TableHead>الدفعة</TableHead>
              <TableHead>البيض</TableHead>
              <TableHead>الكتاكيت</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>ملاحظات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 500).map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.date}</TableCell>
                <TableCell>{m.type}</TableCell>
                <TableCell>
                  {m.direction === "in" && <Badge>وارد</Badge>}
                  {m.direction === "out" && <Badge variant="destructive">منصرف</Badge>}
                </TableCell>
                <TableCell>{m.customer || "—"}</TableCell>
                <TableCell>{m.batch || "—"}</TableCell>
                <TableCell>{m.eggs ? m.eggs.toLocaleString("ar-EG") : "—"}</TableCell>
                <TableCell>{m.chicks ? m.chicks.toLocaleString("ar-EG") : "—"}</TableCell>
                <TableCell>{m.amount ? m.amount.toLocaleString("ar-EG") : "—"}</TableCell>
                <TableCell>{m.status || "—"}</TableCell>
                <TableCell className="max-w-[220px] truncate">{m.notes || "—"}</TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">لا توجد حركات</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        {filtered.length > 500 && (
          <p className="text-xs text-muted-foreground p-2">يظهر أول 500 من إجمالي {filtered.length}. استخدم الفلتر للتضييق.</p>
        )}
      </Card>
    </div>
  );
}
