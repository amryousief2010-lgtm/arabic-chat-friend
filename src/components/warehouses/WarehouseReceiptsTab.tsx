import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Beef, Factory, ArrowLeftRight, Printer, Eye, Inbox, Loader2, Pencil, Trash2, Package } from "lucide-react";
import { formatDateTime } from "@/lib/dateFormat";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate, COMPANY_AR } from "@/lib/printPdf";
import { toast } from "sonner";

type ReceiptKind = "slaughter" | "meat_factory" | "internal" | "other";

interface ReceiptLine {
  name: string;
  qty: number;
  unit: string;
  quality?: string;
  notes?: string;
  received_at?: string;
}

interface ReceiptRow {
  id: string;
  kind: ReceiptKind;
  batch_no: string;
  date: string; // ISO
  source_label: string;
  destination_label: string;
  dest_warehouse_id?: string | null;
  items_count: number;
  total_qty: number;
  quality: string; // مقبول / مرفوض / مقبول جزئيًا / —
  status: string; // received / pending / partial / rejected
  receiver: string;
  notes?: string;
  lines: ReceiptLine[];
}

interface WarehouseReceiptsTabProps {
  /** If provided, only receipts whose destination is this warehouse are shown. */
  warehouseId?: string | null;
  /** Optional label used in the header when scoped to a specific warehouse. */
  warehouseName?: string | null;
  /**
   * If provided (YYYY-MM-DD or ISO), receipts before this date are hidden.
   * Used to start a fresh receipts log per warehouse from a given date.
   */
  startDate?: string | null;
}

const STATUS_LABELS: Record<string, { label: string; variant: any }> = {
  received: { label: "مقبول", variant: "default" },
  partial: { label: "مقبول جزئيًا", variant: "secondary" },
  rejected: { label: "مرفوض", variant: "destructive" },
  pending: { label: "بانتظار المراجعة", variant: "outline" },
};

const KIND_LABEL: Record<ReceiptKind, string> = {
  slaughter: "استلام من المجزر",
  meat_factory: "استلام من مصنع اللحوم",
  internal: "استلام تحويل داخلي",
  other: "استلامات أخرى",
};

function summarizeQuality(lines: { quality?: string }[]): string {
  if (!lines.length) return "—";
  const accepted = lines.filter((l) => l.quality === "accepted" || l.quality === "مقبول").length;
  const rejected = lines.filter((l) => l.quality === "rejected" || l.quality === "مرفوض").length;
  if (rejected && accepted) return "مقبول جزئيًا";
  if (rejected && !accepted) return "مرفوض";
  return "مقبول";
}

function qualityLabel(q?: string) {
  if (q === "accepted") return "مقبول";
  if (q === "rejected") return "مرفوض";
  if (q === "quarantined") return "حجر صحي";
  return q || "—";
}

function printReceipt(row: ReceiptRow) {
  const linesHtml = row.lines
    .map(
      (l, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(l.name)}</td>
      <td class="num">${fmtNum(l.qty, 2)}</td>
      <td>${escapeHtml(l.unit)}</td>
      <td>${escapeHtml(qualityLabel(l.quality))}</td>
      <td>${escapeHtml(l.notes || "—")}</td>
    </tr>`
    )
    .join("");

  const body = `
    <header>
      <div>
        <h1>${COMPANY_AR}</h1>
        <div class="en">محضر استلام مخزون — ${escapeHtml(KIND_LABEL[row.kind])}</div>
      </div>
      <div class="meta">
        <div>رقم الدفعة: <b>${escapeHtml(row.batch_no)}</b></div>
        <div>التاريخ: ${escapeHtml(fmtDate(row.date))}</div>
        <div>الوقت: ${escapeHtml(formatDateTime(row.date))}</div>
      </div>
    </header>

    <div class="stats">
      <div class="stat"><div class="k">المصدر</div><div class="v">${escapeHtml(row.source_label)}</div></div>
      <div class="stat"><div class="k">المخزن المستلم</div><div class="v">${escapeHtml(row.destination_label)}</div></div>
      <div class="stat"><div class="k">عدد الأصناف</div><div class="v">${row.items_count}</div></div>
      <div class="stat"><div class="k">إجمالي الكمية</div><div class="v">${fmtNum(row.total_qty, 2)}</div></div>
    </div>

    <h2>تفاصيل الأصناف</h2>
    <table>
      <thead><tr>
        <th>م</th><th>الصنف</th><th>الكمية</th><th>الوحدة</th><th>الجودة</th><th>ملاحظات</th>
      </tr></thead>
      <tbody>${linesHtml || `<tr><td colspan="6" style="text-align:center;color:#888">لا توجد أصناف</td></tr>`}</tbody>
    </table>

    ${row.notes ? `<h2>ملاحظات عامة</h2><div style="border:1px solid #ddd;padding:8px;border-radius:4px;background:#fafafa">${escapeHtml(row.notes)}</div>` : ""}

    <h2>الاعتماد والتوقيع</h2>
    <table>
      <thead><tr><th>المستلم</th><th>المراجع</th><th>المدير</th></tr></thead>
      <tbody><tr>
        <td style="height:60px">${escapeHtml(row.receiver || "—")}</td>
        <td></td>
        <td></td>
      </tr></tbody>
    </table>

    <footer>${COMPANY_AR} — محضر استلام مخزون — ${escapeHtml(row.batch_no)}</footer>
  `;
  openPrintWindow(`محضر استلام ${row.batch_no}`, body);
}

export default function WarehouseReceiptsTab({ warehouseId, warehouseName, startDate }: WarehouseReceiptsTabProps = {}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [activeSub, setActiveSub] = useState<ReceiptKind>("slaughter");

  // filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [destFilter, setDestFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [batchSearch, setBatchSearch] = useState("");
  const [itemSearch, setItemSearch] = useState("");

  const [detail, setDetail] = useState<ReceiptRow | null>(null);
  const [editTarget, setEditTarget] = useState<ReceiptRow | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ReceiptRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void loadAll(); }, []);

  function openEdit(r: ReceiptRow) {
    setEditTarget(r);
    setEditNotes(r.notes || "");
  }

  async function saveEdit() {
    if (!editTarget) return;
    setBusy(true);
    try {
      const table = editTarget.kind === "internal" ? "warehouse_transfers"
        : editTarget.kind === "meat_factory" ? "meat_production_transfers"
        : editTarget.kind === "slaughter" ? "slaughter_batches"
        : null;
      if (!table) {
        toast.error("هذا النوع غير قابل للتعديل من هنا");
        return;
      }
      const { error } = await supabase.from(table as any).update({ notes: editNotes }).eq("id", editTarget.id);
      if (error) throw error;
      toast.success("تم تحديث الملاحظات");
      setEditTarget(null);
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message || "تعذّر التحديث");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    // Safety: any receipt that has been received affects stock — block destructive delete.
    if (deleteTarget.status === "received" || deleteTarget.status === "partial") {
      toast.error("لا يمكن الحذف — هذا الاستلام مرتبط بحركة مخزون. استخدم سجل المخزون لعمل تسوية عكسية.");
      setDeleteTarget(null);
      return;
    }
    setBusy(true);
    try {
      const table = deleteTarget.kind === "internal" ? "warehouse_transfers"
        : deleteTarget.kind === "meat_factory" ? "meat_production_transfers"
        : null;
      if (!table) {
        toast.error("هذا النوع غير قابل للحذف من هنا");
        return;
      }
      const { error } = await supabase.from(table as any).delete().eq("id", deleteTarget.id);
      if (error) throw error;
      toast.success("تم الحذف");
      setDeleteTarget(null);
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message || "تعذّر الحذف");
    } finally {
      setBusy(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    try {
      const all: ReceiptRow[] = [];

      // ---------------- 1) Slaughter receipts ----------------
      // Includes BOTH already-received outputs AND pending outputs that were
      // dispatched to a main/branch warehouse but still await warehouse-
      // supervisor approval. Pending rows appear with status="pending" so the
      // main-warehouse team sees every transfer the moment it's dispatched
      // from the slaughterhouse (not only after approval).
      const [receivedOutsRes, pendingOutsRes] = await Promise.all([
        supabase
          .from("slaughter_batch_outputs")
          .select("id, batch_id, cut_name_ar, actual_weight_kg, quality_status, received_at, received_warehouse_id, received_by, notes, destination, batch:slaughter_batches(batch_number, slaughter_date)")
          .eq("received_status", "received")
          .order("received_at", { ascending: false })
          .limit(2000),
        supabase
          .from("slaughter_batch_outputs")
          .select("id, batch_id, cut_name_ar, actual_weight_kg, quality_status, received_at, received_warehouse_id, received_by, notes, destination, batch:slaughter_batches(batch_number, slaughter_date, created_at)")
          .in("destination", ["warehouse", "branch"])
          .neq("received_status", "received")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      const outs = [...(receivedOutsRes.data || []), ...(pendingOutsRes.data || [])];

      // Resolve a default main-warehouse id so pending rows (received_warehouse_id
      // is NULL until approval) still show under the main-warehouse scope.
      let defaultMainId: string | null = null;
      if (pendingOutsRes.data && pendingOutsRes.data.length > 0) {
        const { data: mainWhRow } = await supabase
          .from("warehouses")
          .select("id")
          .eq("is_active", true)
          .or("name.ilike.%الرئيسي%,name.ilike.%المقر%")
          .limit(1)
          .maybeSingle();
        defaultMainId = (mainWhRow as any)?.id || null;
      }

      const slaughterGroups = new Map<string, ReceiptRow>();
      for (const o of outs || []) {
        const batch: any = (o as any).batch;
        const isPending = (o as any).received_status !== "received";
        const key = String(o.batch_id) + (isPending ? ":pending" : ":received");
        if (!slaughterGroups.has(key)) {
          slaughterGroups.set(key, {
            id: key,
            kind: "slaughter",
            batch_no: batch?.batch_number || "—",
            date: (o as any).received_at || batch?.slaughter_date || (batch as any)?.created_at || new Date().toISOString(),
            source_label: "المجزر",
            destination_label: isPending ? "المخزن الرئيسي (بانتظار الاعتماد)" : "المخزن الرئيسي",
            dest_warehouse_id: (o as any).received_warehouse_id ?? (isPending ? defaultMainId : null),
            items_count: 0,
            total_qty: 0,
            quality: "—",
            status: isPending ? "pending" : "received",
            receiver: "—",
            lines: [],
          });
        }
        const row = slaughterGroups.get(key)!;
        row.lines.push({
          name: (o as any).cut_name_ar || "—",
          qty: Number((o as any).actual_weight_kg || 0),
          unit: "كجم",
          quality: (o as any).quality_status,
          notes: (o as any).notes,
          received_at: (o as any).received_at,
        });
      }
      for (const r of slaughterGroups.values()) {
        r.items_count = r.lines.length;
        r.total_qty = r.lines.reduce((s, l) => s + (l.qty || 0), 0);
        if (r.status !== "pending") {
          r.quality = summarizeQuality(r.lines);
          r.status = r.quality === "مرفوض" ? "rejected" : r.quality === "مقبول جزئيًا" ? "partial" : "received";
        } else {
          r.quality = "بانتظار الاعتماد";
        }
        all.push(r);
      }

      // ---------------- 2) Meat factory production transfers ----------------
      const { data: mpts } = await supabase
        .from("meat_production_transfers")
        .select("id, transfer_no, quantity, unit_cost, destination_warehouse_id, created_at, created_by, notes, product:meat_factory_products(name_ar), warehouse:warehouses!meat_production_transfers_destination_warehouse_id_fkey(name)")
        .order("created_at", { ascending: false })
        .limit(2000);

      const mfGroups = new Map<string, ReceiptRow>();
      for (const t of mpts || []) {
        const key = (t as any).transfer_no || (t as any).id;
        if (!mfGroups.has(key)) {
          mfGroups.set(key, {
            id: String((t as any).id),
            kind: "meat_factory",
            batch_no: (t as any).transfer_no || `MF-${String((t as any).id).slice(0, 8)}`,
            date: (t as any).created_at,
            source_label: "مصنع اللحوم",
            destination_label: (t as any).warehouse?.name || "—",
            dest_warehouse_id: (t as any).destination_warehouse_id ?? null,
            items_count: 0,
            total_qty: 0,
            quality: "مقبول",
            status: "received",
            receiver: "—",
            notes: (t as any).notes || undefined,
            lines: [],
          });
        }
        const r = mfGroups.get(key)!;
        r.lines.push({
          name: (t as any).product?.name_ar || "—",
          qty: Number((t as any).quantity || 0),
          unit: "وحدة",
        });
      }
      for (const r of mfGroups.values()) {
        r.items_count = r.lines.length;
        r.total_qty = r.lines.reduce((s, l) => s + (l.qty || 0), 0);
        all.push(r);
      }

      // ---------------- 3) Internal warehouse transfers (received) ----------------
      const { data: trs } = await supabase
        .from("warehouse_transfers")
        .select("id, transfer_no, status, received_at, sent_at, notes, destination_warehouse_id, source:warehouses!warehouse_transfers_source_warehouse_id_fkey(name), destination:warehouses!warehouse_transfers_destination_warehouse_id_fkey(name), items:warehouse_transfer_items(id, item_name, unit, received_qty, sent_qty, receive_notes, line_status)")
        .in("status", ["received", "partial_received", "completed"])
        .order("received_at", { ascending: false })
        .limit(2000);

      for (const tr of trs || []) {
        const notes = (tr as any).notes || "";
        const transferNo = (tr as any).transfer_no || "";
        // Hide backfilled/legacy reconciliation entries from the operational receipts log.
        // They stay in DB for audit but are not part of current operations.
        if (/Backfilled/i.test(notes) || /^TR-BF-/i.test(transferNo)) continue;
        const items: any[] = (tr as any).items || [];
        const row: ReceiptRow = {
          id: String((tr as any).id),
          kind: "internal",
          batch_no: transferNo || `TR-${String((tr as any).id).slice(0, 8)}`,
          date: (tr as any).received_at || (tr as any).sent_at,
          source_label: (tr as any).source?.name || "—",
          destination_label: (tr as any).destination?.name || "—",
          dest_warehouse_id: (tr as any).destination_warehouse_id ?? null,
          items_count: items.length,
          total_qty: items.reduce((s, l) => s + Number(l.received_qty || 0), 0),
          quality: (tr as any).status === "partial_received" ? "مقبول جزئيًا" : "مقبول",
          status: (tr as any).status === "partial_received" ? "partial" : "received",
          receiver: "—",
          notes: notes || undefined,
          lines: items.map((it) => ({
            name: it.item_name || "—",
            qty: Number(it.received_qty || 0),
            unit: it.unit || "",
            quality: it.line_status === "rejected" ? "rejected" : "accepted",
            notes: it.receive_notes,
          })),
        };
        all.push(row);
      }

      // ---------------- 4) Other receipts: manual supply + sales returns ----------------
      // Pulls from inventory_movements (movement_type IN ('in','sales_return')) and groups
      // lines that share the same warehouse + party + timestamp into one operation row.
      const { data: invIn } = await supabase
        .from("inventory_movements")
        .select("id, movement_no, movement_type, party, reference_type, quantity, performed_at, notes, warehouse_id, item_id, warehouse:warehouses(name), item:inventory_items(product:products(name, unit))")
        .in("movement_type", ["in", "sales_return"])
        .order("performed_at", { ascending: false })
        .limit(3000);

      const otherGroups = new Map<string, ReceiptRow>();
      for (const m of (invIn as any[]) || []) {
        const refType = m.reference_type || "";
        // Exclude system corrections, opening balances, and rows already represented
        // by the slaughter/meat-factory/internal-transfer tabs above.
        if (refType === "reverse_pre_start" || refType === "opening_balance") continue;
        if (refType === "transfer" || refType === "internal_transfer") continue;
        const isReturn = m.movement_type === "sales_return";
        const partyRaw = (m.party || "").trim();
        const sourceLabel = isReturn
          ? `مرتجع${partyRaw ? ` — ${partyRaw}` : " عميل"}`
          : (partyRaw || (refType === "customer_supply" ? "توريد عميل" : "توريد مباشر"));
        const ts = m.performed_at || new Date().toISOString();
        const tsBucket = String(ts).slice(0, 19); // group within same second
        const key = `${m.warehouse_id || "-"}|${tsBucket}|${sourceLabel}|${m.movement_type}`;
        const productName = m?.item?.product?.name || "—";
        const unit = m?.item?.product?.unit || "وحدة";
        if (!otherGroups.has(key)) {
          otherGroups.set(key, {
            id: String(m.id),
            kind: "other",
            batch_no: m.movement_no || `MV-${String(m.id).slice(0, 8)}`,
            date: ts,
            source_label: sourceLabel,
            destination_label: m?.warehouse?.name || "—",
            dest_warehouse_id: m.warehouse_id ?? null,
            items_count: 0,
            total_qty: 0,
            quality: "مقبول",
            status: "received",
            receiver: "—",
            notes: m.notes || undefined,
            lines: [],
          });
        }
        const row = otherGroups.get(key)!;
        row.lines.push({
          name: productName,
          qty: Number(m.quantity || 0),
          unit,
          quality: "accepted",
          notes: m.notes || undefined,
          received_at: ts,
        });
      }
      for (const r of otherGroups.values()) {
        r.items_count = r.lines.length;
        r.total_qty = r.lines.reduce((s, l) => s + (l.qty || 0), 0);
        all.push(r);
      }

      all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRows(all);
    } finally {
      setLoading(false);
    }
  }


  const filteredAll = useMemo(() => {
    const startTs = startDate ? new Date(startDate.length <= 10 ? startDate + "T00:00:00" : startDate).getTime() : null;
    return rows.filter((r) => {
      if (warehouseId && r.dest_warehouse_id !== warehouseId) return false;
      if (startTs !== null && new Date(r.date).getTime() < startTs) return false;
      if (fromDate && new Date(r.date) < new Date(fromDate)) return false;
      if (toDate && new Date(r.date) > new Date(toDate + "T23:59:59")) return false;
      if (sourceFilter !== "all" && r.source_label !== sourceFilter) return false;
      if (destFilter !== "all" && r.destination_label !== destFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (batchSearch.trim() && !r.batch_no.toLowerCase().includes(batchSearch.trim().toLowerCase())) return false;
      if (itemSearch.trim()) {
        const q = itemSearch.trim().toLowerCase();
        if (!r.lines.some((l) => (l.name || "").toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [rows, warehouseId, startDate, fromDate, toDate, sourceFilter, destFilter, statusFilter, batchSearch, itemSearch]);

  const filtered = useMemo(() => filteredAll.filter((r) => r.kind === activeSub), [filteredAll, activeSub]);

  const summary = useMemo(() => {
    const ops = filteredAll.length;
    const itemsCnt = filteredAll.reduce((s, r) => s + r.items_count, 0);
    const totalQty = filteredAll.reduce((s, r) => s + r.total_qty, 0);
    const last = filteredAll[0]?.date;
    return { ops, itemsCnt, totalQty, last };
  }, [filteredAll]);

  const sourceOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.source_label).filter(Boolean))).sort(), [rows]);
  const destOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.destination_label).filter(Boolean))).sort(), [rows]);


  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Inbox className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold">{warehouseName ? `استلامات ${warehouseName}` : "سجل الاستلامات"}</h2>
          <p className="text-sm text-muted-foreground">
            {warehouseName ? `عرض مقصور على استلامات ${warehouseName}` : "عرض مجمّع لكل عمليات الاستلام حسب الدفعة"}
            {startDate ? ` — بداية من ${startDate.slice(0, 10)}` : ""}
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid gap-3 md:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>عدد عمليات الاستلام</CardDescription><CardTitle className="text-2xl">{summary.ops}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>إجمالي الأصناف</CardDescription><CardTitle className="text-2xl">{summary.itemsCnt}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>إجمالي الكمية</CardDescription><CardTitle className="text-2xl">{summary.totalQty.toFixed(2)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>آخر عملية</CardDescription><CardTitle className="text-sm font-medium leading-tight">{summary.last ? formatDateTime(summary.last) : "—"}</CardTitle></CardHeader></Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 grid gap-3 md:grid-cols-4">
          <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
          <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          <div>
            <Label className="text-xs">المصدر</Label>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {sourceOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">المخزن المستلم</Label>
            <Select value={destFilter} onValueChange={setDestFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {destOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">الحالة</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="received">مقبول</SelectItem>
                <SelectItem value="partial">مقبول جزئيًا</SelectItem>
                <SelectItem value="rejected">مرفوض</SelectItem>
                <SelectItem value="pending">بانتظار المراجعة</SelectItem>
                <SelectItem value="cancelled">ملغى</SelectItem>
                <SelectItem value="archived">مؤرشف</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">رقم الدفعة</Label><Input value={batchSearch} onChange={(e) => setBatchSearch(e.target.value)} placeholder="SB-..." /></div>
          <div className="md:col-span-2"><Label className="text-xs">بحث باسم الصنف</Label><Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="مثال: لحمه" /></div>
        </CardContent>
      </Card>

      <Tabs value={activeSub} onValueChange={(v) => setActiveSub(v as ReceiptKind)}>
        <TabsList>
          <TabsTrigger value="slaughter" className="gap-1"><Beef className="w-4 h-4" />استلامات المجزر</TabsTrigger>
          <TabsTrigger value="meat_factory" className="gap-1"><Factory className="w-4 h-4" />استلامات مصنع اللحوم</TabsTrigger>
          <TabsTrigger value="internal" className="gap-1"><ArrowLeftRight className="w-4 h-4" />استلامات التحويلات الداخلية</TabsTrigger>
          <TabsTrigger value="other" className="gap-1"><Package className="w-4 h-4" />استلامات أخرى</TabsTrigger>
        </TabsList>

        {(["slaughter", "meat_factory", "internal", "other"] as ReceiptKind[]).map((k) => (
          <TabsContent key={k} value={k} className="space-y-3">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الدفعة</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>المصدر</TableHead>
                      <TableHead>المخزن المستلم</TableHead>
                      <TableHead>عدد الأصناف</TableHead>
                      <TableHead>إجمالي الكمية</TableHead>
                      <TableHead>الجودة</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">{k === "other" ? "لا توجد استلامات أخرى مسجّلة" : "لا توجد عمليات استلام"}</TableCell></TableRow>
                    ) : filtered.map((r) => {
                      const st = STATUS_LABELS[r.status] || STATUS_LABELS.received;
                      const editable = r.kind !== "slaughter";
                      const deletable = r.status !== "received" && r.status !== "partial" && r.kind !== "slaughter";
                      return (
                        <TableRow key={`${r.kind}-${r.id}`}>
                          <TableCell className="font-mono text-xs">{r.batch_no}</TableCell>
                          <TableCell className="text-xs">{formatDateTime(r.date)}</TableCell>
                          <TableCell>{r.source_label}</TableCell>
                          <TableCell>{r.destination_label}</TableCell>
                          <TableCell className="text-center">{r.items_count}</TableCell>
                          <TableCell>{r.total_qty.toFixed(2)}</TableCell>
                          <TableCell><Badge variant="outline">{r.quality}</Badge></TableCell>
                          <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setDetail(r)} title="رؤية">
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => openEdit(r)} title="تعديل" disabled={!editable}>
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(r)} title={deletable ? "حذف" : "محمي — مرتبط بحركة مخزون"} disabled={!deletable}>
                                <Trash2 className={`w-4 h-4 ${deletable ? "text-destructive" : ""}`} />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => printReceipt(r)} title="طباعة">
                                <Printer className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* Details dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              تفاصيل دفعة الاستلام
              {detail && <Badge variant="outline" className="font-mono">{detail.batch_no}</Badge>}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div><div className="text-muted-foreground text-xs">النوع</div><div>{KIND_LABEL[detail.kind]}</div></div>
                <div><div className="text-muted-foreground text-xs">التاريخ</div><div>{formatDateTime(detail.date)}</div></div>
                <div><div className="text-muted-foreground text-xs">المصدر</div><div>{detail.source_label}</div></div>
                <div><div className="text-muted-foreground text-xs">المخزن المستلم</div><div>{detail.destination_label}</div></div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الصنف</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>الوحدة</TableHead>
                    <TableHead>الجودة</TableHead>
                    <TableHead>وقت الاستلام</TableHead>
                    <TableHead>ملاحظات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{l.name}</TableCell>
                      <TableCell>{Number(l.qty).toFixed(2)}</TableCell>
                      <TableCell>{l.unit}</TableCell>
                      <TableCell><Badge variant="outline">{qualityLabel(l.quality)}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{l.received_at ? formatDateTime(l.received_at) : formatDateTime(detail.date)}</TableCell>
                      <TableCell className="text-xs">{l.notes || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {detail.notes && <div className="text-sm border rounded p-2 bg-muted/30"><b>ملاحظات:</b> {detail.notes}</div>}
            </div>
          )}
          <DialogFooter className="gap-2">
            {detail && <Button onClick={() => printReceipt(detail)}><Printer className="w-4 h-4 ml-1" />طباعة</Button>}
            <Button variant="outline" onClick={() => setDetail(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog — notes only */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>تعديل الاستلام {editTarget?.batch_no}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">يُسمح بتعديل الملاحظات فقط. الكميات والأصناف محمية لأنها أثّرت على المخزون.</Label>
            <Textarea rows={5} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="ملاحظات الاستلام..." />
          </div>
          <DialogFooter className="gap-2">
            <Button onClick={saveEdit} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ"}</Button>
            <Button variant="outline" onClick={() => setEditTarget(null)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>تأكيد الحذف</DialogTitle>
          </DialogHeader>
          <div className="text-sm">
            هل أنت متأكد من حذف الاستلام <b className="font-mono">{deleteTarget?.batch_no}</b>؟
            <div className="mt-2 text-xs text-muted-foreground">
              لن يتم عكس أي حركة مخزون. إذا كان الاستلام مؤثرًا على المخزون سيتم منع الحذف تلقائيًا.
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "حذف"}</Button>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
