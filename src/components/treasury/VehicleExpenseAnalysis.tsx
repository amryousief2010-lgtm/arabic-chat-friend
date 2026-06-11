import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Truck, Eye } from "lucide-react";
import { fmtNum } from "@/lib/printPdf";

type Row = {
  id: string;
  expense_date: string;
  category: string;
  amount: number;
  status: string;
  description: string;
  vehicle_plate: string | null;
  vehicle_label: string | null;
  created_by: string;
  receipt_url: string | null;
};

type Alert = {
  id: string;
  vehicle_plate: string;
  expense_category: string;
  month: string;
  threshold_amount: number;
  total_amount: number;
  created_at: string;
};

type Props = {
  catLabel: Record<string, string>;
};

const THRESHOLD = 8000;
const STATUS_LBL: Record<string, string> = {
  pending_review: "بانتظار المراجعة",
  clarification_needed: "مطلوب توضيح",
  approved: "معتمد",
  rejected: "مرفوض",
  over_limit_pending: "تجاوز حد",
};

const monthOf = (d: string) => d.slice(0, 7);
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function VehicleExpenseAnalysis({ catLabel }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(thisMonth());
  const [plateFilter, setPlateFilter] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [detail, setDetail] = useState<{ plate: string; cat: string; month: string } | null>(null);

  async function load() {
    setLoading(true);
    const [e, a] = await Promise.all([
      (supabase as any).from("slaughter_custody_expenses")
        .select("id,expense_date,category,amount,status,description,vehicle_plate,vehicle_label,created_by,receipt_url")
        .not("vehicle_plate", "is", null)
        .order("expense_date", { ascending: false })
        .limit(2000),
      (supabase as any).from("vehicle_expense_alerts").select("*").order("created_at", { ascending: false }).limit(500),
    ]);
    setRows((e.data || []) as Row[]);
    setAlerts((a.data || []) as Alert[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const inMonth = useMemo(() => rows.filter(r => monthOf(r.expense_date) === month && r.status !== "rejected"), [rows, month]);

  type Group = {
    plate: string;
    label: string;
    category: string;
    total: number;
    count: number;
    max: number;
    last: string;
    over: boolean;
    alertSent: boolean;
  };

  const groups: Group[] = useMemo(() => {
    const m = new Map<string, Row[]>();
    inMonth.forEach(r => {
      if (!r.vehicle_plate) return;
      if (plateFilter && !r.vehicle_plate.includes(plateFilter)) return;
      if (catFilter !== "all" && r.category !== catFilter) return;
      const k = `${r.vehicle_plate}::${r.category}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    });
    const out: Group[] = [];
    m.forEach((arr, k) => {
      const [plate, cat] = k.split("::");
      const total = arr.reduce((s, r) => s + Number(r.amount || 0), 0);
      const sorted = [...arr].sort((a, b) => b.expense_date.localeCompare(a.expense_date));
      const alertSent = alerts.some(al =>
        al.vehicle_plate === plate && al.expense_category === cat && al.month === month);
      out.push({
        plate,
        label: sorted[0]?.vehicle_label || "",
        category: cat,
        total,
        count: arr.length,
        max: Math.max(...arr.map(r => Number(r.amount))),
        last: sorted[0]?.expense_date || "",
        over: total > THRESHOLD,
        alertSent,
      });
    });
    return out.sort((a, b) => b.total - a.total);
  }, [inMonth, plateFilter, catFilter, alerts, month]);

  const detailRows = useMemo(() => {
    if (!detail) return [];
    return rows.filter(r =>
      r.vehicle_plate === detail.plate &&
      r.category === detail.cat &&
      monthOf(r.expense_date) === detail.month
    ).sort((a, b) => a.expense_date.localeCompare(b.expense_date));
  }, [detail, rows]);

  const overCount = groups.filter(g => g.over).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          تحليل مصروفات العربيات
        </CardTitle>
        <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1 inline-flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          عند تجاوز إجمالي مصروف نفس العربية ونفس البند {fmtNum(THRESHOLD, 0)} ج خلال شهر، يتم إخطار المحاسب محمد شعلة تلقائيًا (مرة واحدة لكل مزيج).
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <Label className="text-xs">الشهر (YYYY-MM)</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">رقم العربية</Label>
            <Input value={plateFilter} onChange={(e) => setPlateFilter(e.target.value)} placeholder="بحث برقم اللوحة" />
          </div>
          <div>
            <Label className="text-xs">بند المصروف</Label>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {Object.entries(catLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Badge variant={overCount > 0 ? "destructive" : "outline"} className="text-sm">
              متجاوز الحد: {overCount}
            </Badge>
            <Badge variant="outline" className="text-sm">إجمالي مجموعات: {groups.length}</Badge>
          </div>
        </div>

        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العربية</TableHead>
                <TableHead>الاسم/الكود</TableHead>
                <TableHead>البند</TableHead>
                <TableHead className="text-right">الإجمالي الشهري</TableHead>
                <TableHead className="text-right">عدد الحركات</TableHead>
                <TableHead className="text-right">أعلى حركة</TableHead>
                <TableHead>آخر حركة</TableHead>
                <TableHead>تجاوز 8000؟</TableHead>
                <TableHead>التنبيه</TableHead>
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-4">جاري التحميل…</TableCell></TableRow>}
              {!loading && groups.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-4">لا توجد مصروفات عربيات في هذا الشهر</TableCell></TableRow>}
              {groups.map((g) => (
                <TableRow key={`${g.plate}-${g.category}`} className={g.over ? "bg-red-50/40" : ""}>
                  <TableCell className="font-mono font-bold">{g.plate}</TableCell>
                  <TableCell className="text-xs">{g.label || "—"}</TableCell>
                  <TableCell>{catLabel[g.category] || g.category}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{fmtNum(g.total, 2)}</TableCell>
                  <TableCell className="text-right">{g.count}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(g.max, 2)}</TableCell>
                  <TableCell className="text-xs">{g.last}</TableCell>
                  <TableCell>
                    {g.over
                      ? <Badge variant="destructive">نعم</Badge>
                      : <Badge variant="outline">لا</Badge>}
                  </TableCell>
                  <TableCell>
                    {g.alertSent
                      ? <Badge className="bg-green-600 hover:bg-green-700">تم الإرسال</Badge>
                      : g.over ? <Badge variant="secondary">قيد المعالجة</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setDetail({ plate: g.plate, cat: g.category, month })}>
                      <Eye className="h-3.5 w-3.5 ml-1" />عرض
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
          <DialogContent className="max-w-3xl" dir="rtl">
            <DialogHeader>
              <DialogTitle>
                تفاصيل مصروفات العربية {detail?.plate} — {detail ? (catLabel[detail.cat] || detail.cat) : ""} — {detail?.month}
              </DialogTitle>
            </DialogHeader>
            <div className="overflow-auto max-h-[60vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الوصف</TableHead>
                    <TableHead className="text-right">المبلغ</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>المستخدم</TableHead>
                    <TableHead>إيصال</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailRows.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{r.expense_date}</TableCell>
                      <TableCell className="text-xs">{r.description}</TableCell>
                      <TableCell className="text-right font-mono">{fmtNum(r.amount, 2)}</TableCell>
                      <TableCell><Badge variant="outline">{STATUS_LBL[r.status] || r.status}</Badge></TableCell>
                      <TableCell className="text-[10px] font-mono">{r.created_by.slice(0, 8)}</TableCell>
                      <TableCell>{r.receipt_url ? "✓" : "—"}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-muted/30">
                    <TableCell colSpan={2}>الإجمالي</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(detailRows.reduce((s, r) => s + Number(r.amount), 0), 2)}</TableCell>
                    <TableCell colSpan={3}></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
