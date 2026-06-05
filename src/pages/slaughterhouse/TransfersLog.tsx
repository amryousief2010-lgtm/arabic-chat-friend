import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, Printer, FileSpreadsheet, FileText, Truck, Search, RefreshCw, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { openPrintWindow, escapeHtml, fmtNum, COMPANY_AR } from "@/lib/printPdf";
import { formatDateTime } from "@/lib/dateFormat";

type Shipment = {
  shipment_no: string;
  batch_id: string;
  batch_number: string;
  slaughter_date: string;
  branch_id: string;
  transferred_at: string;
  created_at: string;
  received_at: string | null;
  total_kg: number;
  total_value: number;
  items_count: number;
  shipment_status: string;
  butcher_1_id: string | null;
  butcher_2_id: string | null;
  butcher_3_id: string | null;
};

type LineItem = {
  id: string;
  cut_name_ar: string;
  weight_kg: number;
  unit_price: number;
  total_value: number;
  status: string;
  notes: string | null;
  output_id: string | null;
  // joined from outputs
  damaged_weight_kg?: number;
  quarantined_weight_kg?: number;
  package_count?: number;
  quality_status?: string;
  received_status?: string;
};

const statusBadge = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "بانتظار الاستلام", cls: "bg-amber-100 text-amber-800" },
    received: { label: "مستلم", cls: "bg-green-100 text-green-800" },
    rejected: { label: "مرفوض بالكامل", cls: "bg-red-100 text-red-800" },
    partially_rejected: { label: "مرفوض جزئيًا", cls: "bg-orange-100 text-orange-800" },
  };
  const v = map[s] ?? { label: s, cls: "bg-muted text-foreground" };
  return <Badge className={v.cls + " border-0"}>{v.label}</Badge>;
};

const destLabel = (warehouses: { id: string; name: string }[], branches: { id: string; name_ar: string }[], id: string) => {
  const w = warehouses.find((x) => x.id === id);
  if (w) return w.name;
  const b = branches.find((x) => x.id === id);
  if (b) return b.name_ar;
  return "غير معروف";
};

export default function TransfersLog() {
  const [rows, setRows] = useState<Shipment[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name_ar: string }[]>([]);
  const [workers, setWorkers] = useState<Record<string, string>>({});
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [destFilter, setDestFilter] = useState<string>("all");
  const [detail, setDetail] = useState<Shipment | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);

  const fetchAll = async () => {
    setLoading(true);
    const [v, wh, br, w] = await Promise.all([
      supabase.from("v_slaughter_transfer_shipments" as any).select("*").order("transferred_at", { ascending: false }).limit(1000),
      supabase.from("warehouses").select("id,name").eq("is_active", true),
      supabase.from("branches" as any).select("id,name_ar").eq("is_active", true),
      supabase.from("slaughter_workers" as any).select("id,full_name"),
    ]);
    if (v.error) toast.error(v.error.message);
    setRows((v.data as any) || []);
    setWarehouses((wh.data as any) || []);
    setBranches((br.data as any) || []);
    const wm: Record<string, string> = {};
    (w.data as any[] || []).forEach((x: any) => { wm[x.id] = x.full_name; });
    setWorkers(wm);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.shipment_status !== statusFilter) return false;
      if (destFilter !== "all" && r.branch_id !== destFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!`${r.shipment_no} ${r.batch_number}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, destFilter]);

  const openDetails = async (s: Shipment) => {
    setDetail(s);
    setItems([]);
    // Shipment is a minute-bucket of received outputs — re-derive the same window
    const bucketStart = new Date(s.transferred_at);
    bucketStart.setSeconds(0, 0);
    const bucketEnd = new Date(bucketStart.getTime() + 60_000);
    const { data, error } = await supabase
      .from("slaughter_batch_outputs" as any)
      .select("id,cut_name_ar,actual_weight_kg,unit_price,unit_cost,damaged_weight_kg,quarantined_weight_kg,package_count,quality_status,received_status,notes")
      .eq("batch_id", s.batch_id)
      .eq("received_warehouse_id", s.branch_id)
      .gte("received_at", bucketStart.toISOString())
      .lt("received_at", bucketEnd.toISOString());
    if (error) { toast.error(error.message); return; }
    const rows = (data as any[]) || [];
    setItems(rows.map((o) => ({
      id: o.id,
      cut_name_ar: o.cut_name_ar,
      weight_kg: Number(o.actual_weight_kg) || 0,
      unit_price: Number(o.unit_price) || 0,
      total_value: (Number(o.actual_weight_kg) || 0) * (Number(o.unit_price) || 0),
      status: o.quality_status === "rejected" ? "مرفوض" : o.quality_status === "quarantine" ? "حجر" : "مقبول",
      notes: o.notes,
      output_id: o.id,
      damaged_weight_kg: o.damaged_weight_kg,
      quarantined_weight_kg: o.quarantined_weight_kg,
      package_count: o.package_count,
      quality_status: o.quality_status,
      received_status: o.received_status,
    })));
  };

  const exportExcel = () => {
    if (!detail) return;
    const dest = destLabel(warehouses, branches, detail.branch_id);
    const wsData = [
      ["إذن نقل لحوم من المجزر"],
      ["رقم الحركة", detail.shipment_no],
      ["تاريخ النقل", formatDateTime(detail.transferred_at)],
      ["أمر الذبح", detail.batch_number],
      ["الجهة المستلمة", dest],
      ["إجمالي الكمية (كجم)", Number(detail.total_kg).toFixed(2)],
      ["عدد الأصناف", detail.items_count],
      [],
      ["الصنف", "الكمية (كجم)", "السعر/كجم", "الإجمالي", "الحالة", "ملاحظات"],
      ...items.map((i) => [i.cut_name_ar, Number(i.weight_kg).toFixed(2), Number(i.unit_price).toFixed(2), Number(i.total_value).toFixed(2), i.status, i.notes || ""]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Shipment");
    XLSX.writeFile(wb, `${detail.shipment_no}.xlsx`);
  };

  const exportPrint = () => {
    if (!detail) return;
    const dest = destLabel(warehouses, branches, detail.branch_id);
    const butchers = [detail.butcher_1_id, detail.butcher_2_id, detail.butcher_3_id]
      .map((id, i) => id ? `${i + 1}) ${escapeHtml(workers[id] || "")}` : null)
      .filter(Boolean).join(" — ");

    const itemsRows = items.map((i) => `
      <tr>
        <td>${escapeHtml(i.cut_name_ar)}</td>
        <td class="num">${fmtNum(i.weight_kg, 2)}</td>
        <td class="num">${fmtNum(i.unit_price, 2)}</td>
        <td class="num">${fmtNum(i.total_value, 2)}</td>
        <td>${escapeHtml(i.status)}</td>
        <td>${escapeHtml(i.notes || "")}</td>
      </tr>`).join("");

    const body = `
      <header>
        <div>
          <h1>إذن نقل لحوم من المجزر</h1>
          <div class="en">Slaughterhouse Transfer Note</div>
        </div>
        <div class="meta">
          <div>رقم الحركة: <strong>${escapeHtml(detail.shipment_no)}</strong></div>
          <div>التاريخ: ${escapeHtml(formatDateTime(detail.transferred_at))}</div>
          <div>${escapeHtml(COMPANY_AR)}</div>
        </div>
      </header>

      <div class="stats">
        <div class="stat"><div class="k">أمر الذبح</div><div class="v">${escapeHtml(detail.batch_number)}</div></div>
        <div class="stat"><div class="k">الجهة المرسلة</div><div class="v">إدارة المجزر</div></div>
        <div class="stat"><div class="k">الجهة المستلمة</div><div class="v">${escapeHtml(dest)}</div></div>
        <div class="stat"><div class="k">إجمالي الكمية</div><div class="v">${fmtNum(detail.total_kg, 2)} كجم</div></div>
      </div>

      <h2>الأصناف المنقولة</h2>
      <table>
        <thead><tr><th>الصنف</th><th>الكمية (كجم)</th><th>السعر/كجم</th><th>الإجمالي</th><th>الحالة</th><th>ملاحظات</th></tr></thead>
        <tbody>${itemsRows}</tbody>
        <tfoot><tr><td colspan="3" style="text-align:left;font-weight:bold;background:#f3effa">الإجمالي</td>
          <td class="num" style="font-weight:bold">${fmtNum(detail.total_value, 2)}</td><td></td><td></td></tr></tfoot>
      </table>

      <h2>المسؤولون</h2>
      <div style="padding:6px 8px;background:#f9f7ff;border-radius:6px;font-size:11px">
        ${butchers || "— لم يتم تسجيل الجزارين على أمر الذبح —"}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:30px">
        <div style="border:1px solid #ccc;padding:14px 10px;border-radius:6px;min-height:90px">
          <div style="font-size:11px;color:#666;margin-bottom:6px">توقيع المسلِّم (من المجزر)</div>
          <div style="border-bottom:1px dashed #999;height:40px"></div>
        </div>
        <div style="border:1px solid #ccc;padding:14px 10px;border-radius:6px;min-height:90px">
          <div style="font-size:11px;color:#666;margin-bottom:6px">توقيع المستلِم (${escapeHtml(dest)})</div>
          <div style="border-bottom:1px dashed #999;height:40px"></div>
        </div>
      </div>
    `;
    openPrintWindow(`إذن نقل ${detail.shipment_no}`, body);
  };

  return (
    <DashboardLayout>
      <Header title="سجل نقل اللحوم" subtitle="إدارة المجزر" />
      <div dir="rtl" className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Truck className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">سجل نقل اللحوم من إدارة المجزر</h1>
              <p className="text-sm text-muted-foreground">كل نقلة في صف واحد — اضغط على العين لعرض الأصناف والطباعة</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ml-1 ${loading ? "animate-spin" : ""}`} />تحديث
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث برقم الحركة أو الدفعة..." className="pr-8" />
                </div>
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  <SelectItem value="pending">بانتظار الاستلام</SelectItem>
                  <SelectItem value="received">مستلم</SelectItem>
                  <SelectItem value="partially_rejected">مرفوض جزئيًا</SelectItem>
                  <SelectItem value="rejected">مرفوض بالكامل</SelectItem>
                </SelectContent>
              </Select>
              <Select value={destFilter} onValueChange={setDestFilter}>
                <SelectTrigger className="w-56"><SelectValue placeholder="الجهة المستلمة" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الجهات</SelectItem>
                  {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name_ar}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12 text-muted-foreground">جاري التحميل...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">لا توجد حركات نقل مطابقة.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الحركة</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>أمر الذبح</TableHead>
                      <TableHead>المرسل</TableHead>
                      <TableHead>المستلم</TableHead>
                      <TableHead className="text-center">إجمالي (كجم)</TableHead>
                      <TableHead className="text-center">عدد الأصناف</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead className="text-center">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.shipment_no}>
                        <TableCell className="font-mono text-xs">{r.shipment_no}</TableCell>
                        <TableCell className="text-xs">{formatDateTime(r.transferred_at)}</TableCell>
                        <TableCell className="font-mono text-xs">{r.batch_number}</TableCell>
                        <TableCell>إدارة المجزر</TableCell>
                        <TableCell>{destLabel(warehouses, branches, r.branch_id)}</TableCell>
                        <TableCell className="text-center font-semibold">{Number(r.total_kg).toFixed(2)}</TableCell>
                        <TableCell className="text-center">{r.items_count}</TableCell>
                        <TableCell>{statusBadge(r.shipment_status)}</TableCell>
                        <TableCell className="text-center">
                          <Button size="icon" variant="ghost" onClick={() => openDetails(r)} title="عرض التفاصيل">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent dir="rtl" className="max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 flex-wrap">
              <span>تفاصيل النقلة — {detail?.shipment_no}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={exportPrint}><Printer className="h-4 w-4 ml-1" />طباعة / PDF</Button>
                <Button size="sm" variant="outline" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4 ml-1" />Excel</Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="border rounded p-2"><div className="text-xs text-muted-foreground">أمر الذبح</div><div className="font-mono">{detail.batch_number}</div></div>
                <div className="border rounded p-2"><div className="text-xs text-muted-foreground">الجهة المستلمة</div><div>{destLabel(warehouses, branches, detail.branch_id)}</div></div>
                <div className="border rounded p-2"><div className="text-xs text-muted-foreground">إجمالي الكمية</div><div className="font-semibold">{Number(detail.total_kg).toFixed(2)} كجم</div></div>
                <div className="border rounded p-2"><div className="text-xs text-muted-foreground">الحالة</div>{statusBadge(detail.shipment_status)}</div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">الجزارون المرتبطون بأمر الذبح</h3>
                <div className="text-xs bg-muted/40 p-2 rounded">
                  {[detail.butcher_1_id, detail.butcher_2_id, detail.butcher_3_id]
                    .map((id, i) => id ? `${i + 1}) ${workers[id] || "—"}` : null)
                    .filter(Boolean).join("  —  ") || "— لم يُسجَّل جزارون —"}
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">الأصناف المنقولة ({items.length})</h3>
                <div className="border rounded overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الصنف</TableHead>
                        <TableHead className="text-center">الكمية (كجم)</TableHead>
                        <TableHead className="text-center">السعر/كجم</TableHead>
                        <TableHead className="text-center">الإجمالي</TableHead>
                        <TableHead className="text-center">الحالة</TableHead>
                        <TableHead className="text-center">المرفوض</TableHead>
                        <TableHead>ملاحظات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell>{i.cut_name_ar}</TableCell>
                          <TableCell className="text-center">{Number(i.weight_kg).toFixed(2)}</TableCell>
                          <TableCell className="text-center">{Number(i.unit_price).toFixed(2)}</TableCell>
                          <TableCell className="text-center font-semibold">{Number(i.total_value).toFixed(2)}</TableCell>
                          <TableCell className="text-center"><Badge variant="outline" className="text-[10px]">{i.status}</Badge></TableCell>
                          <TableCell className="text-center text-xs text-destructive">{(Number(i.damaged_weight_kg || 0) + Number(i.quarantined_weight_kg || 0)).toFixed(2)}</TableCell>
                          <TableCell className="text-xs">{i.notes || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
