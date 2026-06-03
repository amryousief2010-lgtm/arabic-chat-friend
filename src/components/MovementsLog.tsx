import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Printer, FileSpreadsheet, ArrowRightLeft, RefreshCw } from "lucide-react";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";
import * as XLSX from "xlsx";
import { toast } from "sonner";

export type MovementSource = "brooding_movements" | "feed_factory_movements";

type Row = {
  id: string;
  movement_no: string;
  movement_type: string;
  direction: "IN" | "OUT" | "NONE";
  batch_id?: string | null;
  item_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unit_cost?: number | null;
  total_cost?: number | null;
  from_party?: string | null;
  to_party?: string | null;
  status: string;
  created_by?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  linked_movement_id?: string | null;
  reference_no?: string | null;
  source_table?: string | null;
  notes?: string | null;
  created_at: string;
};

const TYPE_LABELS_BR: Record<string, string> = {
  batch_add: "إضافة دفعة",
  batch_edit: "تعديل دفعة",
  mortality: "نافق",
  feed_issue: "صرف علف",
  medicine_issue: "صرف دواء",
  expense: "مصروف",
  feed_receive: "استلام علف",
  chicks_sale: "بيع كتاكيت",
  slaughter_transfer: "تحويل للمجزر",
  adjustment: "تسوية",
  opening: "رصيد افتتاحي",
  reversal: "حركة عكسية",
};

const TYPE_LABELS_FF: Record<string, string> = {
  raw_purchase: "شراء خامات",
  feed_production: "تصنيع علف",
  external_sale: "بيع علف خارجي",
  brooding_supply: "توريد علف للتحضين",
  feed_return: "مرتجع علف",
  inventory_adjustment: "تسوية مخزون",
  treasury: "حركة خزنة",
  stock_deduction: "خصم مخزون",
  reversal: "حركة عكسية",
};

const dirBadge = (d: string) => {
  if (d === "IN") return <Badge className="bg-emerald-600">داخل</Badge>;
  if (d === "OUT") return <Badge className="bg-orange-600">خارج</Badge>;
  return <Badge variant="secondary">—</Badge>;
};

const statusBadge = (s: string) => {
  if (s === "posted") return <Badge className="bg-purple-600">معتمدة</Badge>;
  if (s === "reversed") return <Badge variant="destructive">ملغاة</Badge>;
  return <Badge variant="secondary">{s}</Badge>;
};

export function MovementsLog({
  source,
  title,
  batches = [],
  users = {},
}: {
  source: MovementSource;
  title: string;
  batches?: Array<{ id: string; batch_no: string }>;
  users?: Record<string, string>;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [batchFilter, setBatchFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const TYPE_LABELS = source === "brooding_movements" ? TYPE_LABELS_BR : TYPE_LABELS_FF;

  const load = async () => {
    setLoading(true);
    const all: Row[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from(source as any)
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) {
        toast.error("تعذّر تحميل سجل الحركات: " + error.message);
        break;
      }
      const chunk = ((data || []) as unknown) as Row[];
      all.push(...chunk);
      if (chunk.length < PAGE) break;
      from += PAGE;
    }
    setRows(all);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`mov-${source}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: source },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (fromDate && new Date(r.created_at) < new Date(fromDate)) return false;
      if (toDate && new Date(r.created_at) > new Date(toDate + "T23:59:59"))
        return false;
      if (typeFilter !== "all" && r.movement_type !== typeFilter) return false;
      if (batchFilter !== "all" && r.batch_id !== batchFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = [
          r.movement_no, r.item_name, r.from_party, r.to_party,
          r.notes, r.reference_no,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [rows, fromDate, toDate, typeFilter, batchFilter, statusFilter, search]);

  const totals = useMemo(() => {
    let inQty = 0, outQty = 0, inCost = 0, outCost = 0;
    filtered.forEach((r) => {
      if (r.direction === "IN") {
        inQty += Number(r.quantity || 0);
        inCost += Number(r.total_cost || 0);
      } else if (r.direction === "OUT") {
        outQty += Number(r.quantity || 0);
        outCost += Number(r.total_cost || 0);
      }
    });
    return { inQty, outQty, inCost, outCost, count: filtered.length };
  }, [filtered]);

  const batchNoOf = (id?: string | null) =>
    id ? batches.find((b) => b.id === id)?.batch_no || "—" : "—";

  const userOf = (id?: string | null) =>
    id ? users[id] || "—" : "—";

  const printRow = (r: Row) => {
    const html = `
      <header>
        <div><h1>حركة ${escapeHtml(r.movement_no)}</h1>
          <div class="en">${escapeHtml(TYPE_LABELS[r.movement_type] || r.movement_type)}</div></div>
        <div class="meta">${escapeHtml(fmtDate(r.created_at))}</div>
      </header>
      <table><tbody>
        <tr><th>رقم الحركة</th><td>${escapeHtml(r.movement_no)}</td></tr>
        <tr><th>النوع</th><td>${escapeHtml(TYPE_LABELS[r.movement_type] || r.movement_type)}</td></tr>
        <tr><th>الاتجاه</th><td>${escapeHtml(r.direction)}</td></tr>
        <tr><th>الدفعة</th><td>${escapeHtml(batchNoOf(r.batch_id))}</td></tr>
        <tr><th>الصنف / البيان</th><td>${escapeHtml(r.item_name)}</td></tr>
        <tr><th>الكمية</th><td>${escapeHtml(fmtNum(r.quantity, 2))} ${escapeHtml(r.unit || "")}</td></tr>
        <tr><th>سعر الوحدة</th><td>${escapeHtml(fmtNum(r.unit_cost, 2))}</td></tr>
        <tr><th>الإجمالي</th><td>${escapeHtml(fmtNum(r.total_cost, 2))}</td></tr>
        <tr><th>من</th><td>${escapeHtml(r.from_party)}</td></tr>
        <tr><th>إلى</th><td>${escapeHtml(r.to_party)}</td></tr>
        <tr><th>سجّل بواسطة</th><td>${escapeHtml(userOf(r.created_by))}</td></tr>
        <tr><th>اعتمد بواسطة</th><td>${escapeHtml(userOf(r.approved_by))}</td></tr>
        <tr><th>الحالة</th><td>${escapeHtml(r.status)}</td></tr>
        <tr><th>رقم مرجعي</th><td>${escapeHtml(r.reference_no)}</td></tr>
        <tr><th>ملاحظات</th><td>${escapeHtml(r.notes)}</td></tr>
      </tbody></table>`;
    openPrintWindow(`حركة ${r.movement_no}`, html);
  };

  const printReport = () => {
    const head = `
      <header>
        <div><h1>${escapeHtml(title)}</h1>
          <div class="en">Movements Report</div></div>
        <div class="meta">${escapeHtml(fmtDate(new Date()))}<br/>عدد الحركات: ${escapeHtml(fmtNum(totals.count))}</div>
      </header>
      <div class="stats">
        <div class="stat"><div class="k">إجمالي داخل</div><div class="v">${escapeHtml(fmtNum(totals.inQty, 2))}</div></div>
        <div class="stat"><div class="k">إجمالي خارج</div><div class="v">${escapeHtml(fmtNum(totals.outQty, 2))}</div></div>
        <div class="stat"><div class="k">قيمة الداخل</div><div class="v">${escapeHtml(fmtNum(totals.inCost, 2))}</div></div>
        <div class="stat"><div class="k">قيمة الخارج</div><div class="v">${escapeHtml(fmtNum(totals.outCost, 2))}</div></div>
      </div>`;
    const rowsHtml = filtered.map((r) => `
      <tr>
        <td>${escapeHtml(r.movement_no)}</td>
        <td>${escapeHtml(fmtDate(r.created_at))}</td>
        <td>${escapeHtml(TYPE_LABELS[r.movement_type] || r.movement_type)}</td>
        <td>${escapeHtml(r.direction)}</td>
        <td>${escapeHtml(batchNoOf(r.batch_id))}</td>
        <td>${escapeHtml(r.item_name)}</td>
        <td class="num">${escapeHtml(fmtNum(r.quantity, 2))} ${escapeHtml(r.unit || "")}</td>
        <td class="num">${escapeHtml(fmtNum(r.total_cost, 2))}</td>
        <td>${escapeHtml(r.from_party)}</td>
        <td>${escapeHtml(r.to_party)}</td>
        <td>${escapeHtml(userOf(r.created_by))}</td>
        <td>${escapeHtml(r.reference_no)}</td>
        <td>${escapeHtml(r.status)}</td>
      </tr>`).join("");
    const body = head + `
      <table>
        <thead><tr>
          <th>رقم</th><th>التاريخ</th><th>النوع</th><th>اتجاه</th>
          <th>الدفعة</th><th>البيان</th><th>الكمية</th><th>الإجمالي</th>
          <th>من</th><th>إلى</th><th>سجّل</th><th>مرجع</th><th>الحالة</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    openPrintWindow(title, body);
  };

  const exportExcel = () => {
    const data = filtered.map((r) => ({
      "رقم الحركة": r.movement_no,
      "التاريخ": new Date(r.created_at).toLocaleString("ar-EG-u-nu-latn"),
      "النوع": TYPE_LABELS[r.movement_type] || r.movement_type,
      "الاتجاه": r.direction,
      "رقم الدفعة": batchNoOf(r.batch_id),
      "الصنف/البيان": r.item_name || "",
      "الكمية": Number(r.quantity || 0),
      "الوحدة": r.unit || "",
      "سعر الوحدة": Number(r.unit_cost || 0),
      "الإجمالي": Number(r.total_cost || 0),
      "من": r.from_party || "",
      "إلى": r.to_party || "",
      "سجّل بواسطة": userOf(r.created_by),
      "اعتمد بواسطة": userOf(r.approved_by),
      "رقم مرجعي": r.reference_no || "",
      "حركة مرتبطة": r.linked_movement_id || "",
      "الحالة": r.status,
      "ملاحظات": r.notes || "",
    }));
    exportToExcel(data, `${title}-${new Date().toISOString().slice(0, 10)}`);
  };

  const distinctTypes = Array.from(new Set(rows.map((r) => r.movement_type)));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle>{title}</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={printReport}>
            <Printer className="h-4 w-4 ml-1" /> طباعة التقرير
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel}>
            <FileSpreadsheet className="h-4 w-4 ml-1" /> Excel
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div>
            <Label className="text-xs">من تاريخ</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">إلى تاريخ</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">نوع الحركة</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {distinctTypes.map((t) => (
                  <SelectItem key={t} value={t}>{TYPE_LABELS[t] || t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {source === "brooding_movements" && batches.length > 0 && (
            <div>
              <Label className="text-xs">الدفعة</Label>
              <Select value={batchFilter} onValueChange={setBatchFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {batches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.batch_no}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs">الحالة</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="posted">معتمدة</SelectItem>
                <SelectItem value="reversed">ملغاة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">بحث</Label>
            <Input placeholder="رقم/بيان/مرجع" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
          <div className="rounded border p-2"><div className="text-xs text-muted-foreground">عدد الحركات</div><div className="font-bold">{fmtNum(totals.count)}</div></div>
          <div className="rounded border p-2"><div className="text-xs text-muted-foreground">داخل (كمية)</div><div className="font-bold text-emerald-600">{fmtNum(totals.inQty, 2)}</div></div>
          <div className="rounded border p-2"><div className="text-xs text-muted-foreground">خارج (كمية)</div><div className="font-bold text-orange-600">{fmtNum(totals.outQty, 2)}</div></div>
          <div className="rounded border p-2"><div className="text-xs text-muted-foreground">قيمة الداخل</div><div className="font-bold">{fmtNum(totals.inCost, 2)}</div></div>
          <div className="rounded border p-2"><div className="text-xs text-muted-foreground">قيمة الخارج</div><div className="font-bold">{fmtNum(totals.outCost, 2)}</div></div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="p-2 text-right">رقم</th>
                <th className="p-2 text-right">التاريخ</th>
                <th className="p-2 text-right">النوع</th>
                <th className="p-2 text-right">اتجاه</th>
                {source === "brooding_movements" && <th className="p-2 text-right">الدفعة</th>}
                <th className="p-2 text-right">البيان</th>
                <th className="p-2 text-right">الكمية</th>
                <th className="p-2 text-right">الإجمالي</th>
                <th className="p-2 text-right">من → إلى</th>
                <th className="p-2 text-right">سجّل</th>
                <th className="p-2 text-right">مرجع</th>
                <th className="p-2 text-right">الحالة</th>
                <th className="p-2 text-right">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={13} className="p-4 text-center text-muted-foreground">لا توجد حركات</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/50">
                  <td className="p-2 font-mono">{r.movement_no}</td>
                  <td className="p-2 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="p-2">{TYPE_LABELS[r.movement_type] || r.movement_type}</td>
                  <td className="p-2">{dirBadge(r.direction)}</td>
                  {source === "brooding_movements" && <td className="p-2">{batchNoOf(r.batch_id)}</td>}
                  <td className="p-2">{r.item_name || "—"}</td>
                  <td className="p-2 num">{fmtNum(r.quantity, 2)} {r.unit || ""}</td>
                  <td className="p-2 num">{fmtNum(r.total_cost, 2)}</td>
                  <td className="p-2 text-xs">{r.from_party || "—"} ← {r.to_party || "—"}</td>
                  <td className="p-2 text-xs">{userOf(r.created_by)}</td>
                  <td className="p-2 text-xs">
                    {r.reference_no ? (
                      <span className="font-mono inline-flex items-center gap-1">
                        <ArrowRightLeft className="h-3 w-3" />{r.reference_no}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="p-2">{statusBadge(r.status)}</td>
                  <td className="p-2">
                    <Button variant="ghost" size="sm" onClick={() => printRow(r)}>
                      <Printer className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
