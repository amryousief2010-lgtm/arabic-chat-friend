import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { paginateUntilDone } from "@/lib/paginateQuery";
import { cairoWallClockToUTC, toCairoDateString } from "@/lib/cairoDate";
import {
  AGOUZA_NAME_MARK,
  MAIN_NAME_MARK,
  PENDING_RECEIPT_STATUSES,
  buildAgouzaStockReport,
  inboundKind,
  type AgouzaItem,
  type AgouzaOrderLine,
  type InboundMovement,
  type PendingTransferAlert,
  type StockCountLine,
} from "@/lib/agouzaStockReport";
import { Download, RefreshCw, TriangleAlert, Warehouse } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

const MIN_KEY = "coceg.agouza-min-levels";

const TRANSFER_STATUS_AR: Record<string, string> = {
  pending_receipt: "بانتظار الاستلام",
  partially_received: "استلام جزئي",
  sent: "أُرسل ولم يُستلم",
  needs_manager_review: "بانتظار مراجعة المدير",
};

const STOCK_STATUS_AR: Record<string, string> = {
  not_dispatched: "لم يُخصم",
  skipped_period_lock: "قفل الفترة",
  dispatched: "مخصوم",
  returned: "مُرتجع",
};

function cairoRangeUtc(fromDate: string, toDate: string) {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const start = cairoWallClockToUTC(fy, fm - 1, fd, 0, 0, 0);
  const next = new Date(Date.UTC(ty, tm - 1, td));
  next.setUTCDate(next.getUTCDate() + 1);
  const end = cairoWallClockToUTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

function fmt(value: number, digits = 1) {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function loadMinLevels(): Record<string, number> {
  try {
    const raw = localStorage.getItem(MIN_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function fetchOrderLines(orderIds: string[], failureIds: Set<string>, ordersById: Map<string, { order_number: string; status: string; stock_status: string | null; created_at: string; shipping_bill_no: string | null }>) {
  const lines: AgouzaOrderLine[] = [];
  for (let i = 0; i < orderIds.length; i += 80) {
    const slice = orderIds.slice(i, i + 80);
    const { data, error } = await supabase
      .from("order_items")
      .select("order_id, product_id, product_name, quantity")
      .in("order_id", slice);
    if (error) throw error;
    for (const row of data || []) {
      const order = ordersById.get(row.order_id);
      if (!order) continue;
      lines.push({
        orderId: row.order_id,
        orderNumber: order.order_number,
        status: order.status,
        stockStatus: order.stock_status,
        createdAt: order.created_at,
        shippingBillNo: order.shipping_bill_no,
        productId: row.product_id,
        productName: row.product_name,
        quantity: Number(row.quantity) || 0,
        unresolvedFailure: failureIds.has(row.order_id),
      });
    }
  }
  return lines;
}

export default function AgouzaStockSupplyReport() {
  const today = toCairoDateString(new Date());
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [minLevels, setMinLevels] = useState<Record<string, number>>(loadMinLevels);
  const [bulkMin, setBulkMin] = useState("");
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<AgouzaOrderLine[]>([]);
  const [reference, setReference] = useState<{
    items: AgouzaItem[];
    counts: StockCountLine[];
    movements: InboundMovement[];
    pendingTransfers: PendingTransferAlert[];
    agouzaId: string;
    latest: string | null;
  } | null>(null);

  const persistMin = (next: Record<string, number>) => {
    setMinLevels(next);
    localStorage.setItem(MIN_KEY, JSON.stringify(next));
  };

  const loadReference = useCallback(async () => {
    const { data: warehouses, error: whError } = await supabase.from("warehouses").select("id, name");
    if (whError) throw whError;
    const agouza = (warehouses || []).find((w) => w.name.includes(AGOUZA_NAME_MARK));
    const main = (warehouses || []).find((w) => w.name.includes(MAIN_NAME_MARK));
    if (!agouza) throw new Error("لم يُعثر على مخزن العجوزة");

    const { data: itemRows, error: itemError } = await supabase
      .from("inventory_items")
      .select("id, name, unit, stock, low_stock_threshold, product_id, products(barcode)")
      .eq("warehouse_id", agouza.id)
      .eq("is_active", true);
    if (itemError) throw itemError;
    const items: AgouzaItem[] = (itemRows || []).map((row) => {
      const product = row.products as { barcode: string | null } | { barcode: string | null }[] | null;
      const barcode = Array.isArray(product) ? product[0]?.barcode : product?.barcode;
      return {
        id: row.id,
        name: row.name,
        unit: row.unit,
        productId: row.product_id,
        barcode: barcode ?? null,
        systemStock: Number(row.stock) || 0,
        lowStockThreshold: Number(row.low_stock_threshold) || 0,
      };
    });

    const { data: sessions, error: sessionError } = await supabase
      .from("stocktaking_sessions")
      .select("id, count_date, session_no, status, stocktaking_lines(item_id, actual_qty)")
      .eq("warehouse_id", agouza.id)
      .eq("status", "approved");
    if (sessionError) throw sessionError;
    const counts: StockCountLine[] = [];
    for (const session of sessions || []) {
      for (const line of session.stocktaking_lines || []) {
        counts.push({
          itemId: line.item_id,
          countDate: String(session.count_date).slice(0, 10),
          actualQty: Number(line.actual_qty) || 0,
          sessionNo: session.session_no,
        });
      }
    }

    const since = counts.reduce((min, line) => (line.countDate < min ? line.countDate : min), today);
    const { start } = cairoRangeUtc(since, today);

    const movementRows = await paginateUntilDone<{
      id: string;
      item_id: string;
      quantity: number;
      quantity_kg: number | null;
      performed_at: string;
      reference: string | null;
      reference_type: string | null;
      movement_type: string;
      notes: string | null;
    }>({
      pageSize: 1000,
      maxPages: 20,
      idOf: (row) => row.id,
      fetchPage: async (from, to) => {
        const { data, error } = await supabase
          .from("inventory_movements")
          .select("id, item_id, quantity, quantity_kg, performed_at, reference, reference_type, movement_type, notes")
          .eq("warehouse_id", agouza.id)
          .in("reference_type", ["store_zodex_main_to_agouza", "store_document", "store_document_kg_fix"])
          .gte("performed_at", start)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw error;
        return data || [];
      },
    });

    const returnRows = await paginateUntilDone<{
      id: string;
      item_id: string;
      quantity: number;
      quantity_kg: number | null;
      performed_at: string;
      reference: string | null;
      reference_id: string | null;
      reference_type: string | null;
    }>({
      pageSize: 1000,
      maxPages: 10,
      idOf: (row) => row.id,
      fetchPage: async (from, to) => {
        const { data, error } = await supabase
          .from("inventory_movements")
          .select("id, item_id, quantity, quantity_kg, performed_at, reference, reference_id, reference_type")
          .eq("warehouse_id", agouza.id)
          .eq("movement_type", "sales_return")
          .gte("performed_at", start)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw error;
        return data || [];
      },
    });

    const movements: InboundMovement[] = [
      ...movementRows.flatMap((row) => {
        const kind = inboundKind({
          referenceType: row.reference_type,
          movementType: row.movement_type,
          notes: row.notes,
        });
        if (!kind) return [];
        return [{
          itemId: row.item_id,
          itemName: "",
          quantity: Number(row.quantity_kg ?? row.quantity) || 0,
          performedAt: row.performed_at,
          reference: row.reference,
          kind,
          sourceIsMain: true,
        }];
      }),
      ...returnRows.map((row) => ({
        itemId: row.item_id,
        itemName: "",
        quantity: Number(row.quantity_kg ?? row.quantity) || 0,
        performedAt: row.performed_at,
        reference: row.reference,
        kind: "sales_return" as const,
        sourceIsMain: false,
        orderId: row.reference_type && row.reference_type.includes("order") ? row.reference_id : null,
      })),
    ];

    const { data: transfers, error: transferError } = await supabase
      .from("warehouse_transfers")
      .select("id, transfer_no, status, sent_at, received_at, created_at, source_warehouse_id, destination_warehouse_id, warehouse_transfer_items(item_name, destination_item_id, received_qty, sent_qty)")
      .eq("destination_warehouse_id", agouza.id);
    if (transferError) throw transferError;

    const pendingTransfers: PendingTransferAlert[] = [];
    for (const transfer of transfers || []) {
      const fromMain = transfer.source_warehouse_id === main?.id;
      const sourceName = fromMain ? "المخزن الرئيسي" : "مخزن آخر";
      for (const line of transfer.warehouse_transfer_items || []) {
        const qty = Number(line.received_qty ?? line.sent_qty) || 0;
        if (PENDING_RECEIPT_STATUSES.has(transfer.status)) {
          pendingTransfers.push({
            transferNo: transfer.transfer_no,
            status: transfer.status,
            itemName: line.item_name,
            quantity: Number(line.sent_qty) || qty,
            sentAt: transfer.sent_at || transfer.created_at,
            sourceName,
          });
        } else if (fromMain && (transfer.status === "received" || transfer.status === "partially_received")) {
          movements.push({
            itemId: line.destination_item_id,
            itemName: line.item_name,
            quantity: qty,
            performedAt: transfer.received_at || transfer.created_at,
            reference: transfer.transfer_no,
            kind: "transfer",
            transferStatus: transfer.status,
            sourceIsMain: true,
          });
        }
      }
    }

    const latest = counts.reduce<string | null>((max, line) => (!max || line.countDate > max ? line.countDate : max), null);
    return { items, counts, movements, pendingTransfers, agouzaId: agouza.id, latest };
  }, [today]);

  const loadOrders = useCallback(async (
    agouzaId: string,
    from: string,
    to: string,
  ) => {
    const { start, end } = cairoRangeUtc(from, to);
    const orders = await paginateUntilDone<{
      id: string;
      order_number: string;
      status: string;
      stock_status: string | null;
      created_at: string;
      shipping_bill_no: string | null;
    }>({
      pageSize: 1000,
      maxPages: 30,
      idOf: (row) => row.id,
      fetchPage: async (pageFrom, pageTo) => {
        const { data, error } = await supabase
          .from("orders")
          .select("id, order_number, status, stock_status, created_at, shipping_bill_no")
          .eq("source_warehouse_id", agouzaId)
          .gte("created_at", start)
          .lt("created_at", end)
          .order("id", { ascending: true })
          .range(pageFrom, pageTo);
        if (error) throw error;
        return data || [];
      },
    });
    const failureRows = await paginateUntilDone<{ id: string; order_id: string | null }>({
      pageSize: 1000,
      maxPages: 10,
      idOf: (row) => row.id,
      fetchPage: async (pageFrom, pageTo) => {
        const { data, error } = await supabase
          .from("order_stock_dispatch_failures")
          .select("id, order_id")
          .eq("warehouse_id", agouzaId)
          .is("resolved_at", null)
          .order("id", { ascending: true })
          .range(pageFrom, pageTo);
        if (error) throw error;
        return data || [];
      },
    });
    const failureIds = new Set(failureRows.map((row) => row.order_id).filter((id): id is string => !!id));
    const ordersById = new Map(orders.map((order) => [order.id, order]));
    return fetchOrderLines(orders.map((order) => order.id), failureIds, ordersById);
  }, []);

  const refresh = useCallback(async (from: string, to: string) => {
    setLoading(true);
    try {
      const ref = reference ?? await loadReference();
      if (!reference) setReference(ref);
      const effectiveFrom = from || ref.latest || to;
      if (!from && ref.latest) setFromDate(ref.latest);
      const orderFrom = ref.latest && ref.latest < effectiveFrom ? ref.latest : effectiveFrom;
      setOrders(await loadOrders(ref.agouzaId, orderFrom, to));
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذّر تحميل التقرير";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [loadOrders, loadReference, reference]);

  useEffect(() => {
    void refresh("", toDate);
    // Initial load only. Date changes go through the button so typing does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const display = useMemo(() => {
    if (!reference) return null;
    return buildAgouzaStockReport({
      items: reference.items,
      counts: reference.counts,
      orders,
      movements: reference.movements,
      pendingTransfers: reference.pendingTransfers,
      fromDate,
      toDate,
      minLevels,
    });
  }, [fromDate, minLevels, orders, reference, toDate]);

  const exportExcel = () => {
    if (!display) return;
    const sheet = display.rows.map((row) => ({
      "الصنف": row.name,
      "الوحدة": row.unit,
      "تاريخ الجرد": row.countDate || "",
      "جرد الأساس": row.baseline,
      "وارد من الرئيسي": row.inbound,
      "مرتجع مُفرّغ": row.returned,
      "مُسلّم": row.delivered,
      "قيد التوصيل": row.inDelivery,
      "الرصيد": row.balance,
      "رصيد النظام": row.systemStock,
      "الحد الأدنى": row.minLevel,
      "التوريد المقترح": row.replenishment,
      "بلا باركود": row.missingBarcode ? "نعم" : "",
    }));
    const alerts = [
      ...display.alerts.deductionFailures.map((row) => ({
        "النوع": "خصم ناقص",
        "المستند": row.orderNumber,
        "البوليصة": row.shippingBillNo || "",
        "التفاصيل": row.reason,
      })),
      ...display.alerts.pendingTransfers.map((row) => ({
        "النوع": "تحويل بانتظار الاستلام",
        "المستند": row.transferNo || "",
        "البوليصة": row.sourceName,
        "التفاصيل": `${row.itemName} — ${TRANSFER_STATUS_AR[row.status] || row.status}`,
      })),
      ...display.alerts.missingBarcodes.map((row) => ({
        "النوع": "بلا باركود",
        "المستند": row.name,
        "البوليصة": "",
        "التفاصيل": "الصنف بلا باركود",
      })),
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(sheet), "الرصيد");
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(alerts.length ? alerts : [{ "النوع": "لا تنبيهات" }]), "التنبيهات");
    XLSX.writeFile(book, `رصيد-العجوزة-${fromDate}-${toDate}.xlsx`);
  };

  const totals = display?.rows.reduce(
    (sum, row) => {
      if (!row.inKg) return sum;
      sum.replenishment += row.replenishment;
      sum.balance += row.balance;
      return sum;
    },
    { replenishment: 0, balance: 0 },
  );

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-orange-500 text-white">
              <Warehouse className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">رصيد العجوزة والتوريد</h1>
              <p className="text-sm text-muted-foreground">
                قراءة فقط. الرصيد = جرد الأساس + الوارد من الرئيسي + المرتجع المُفرّغ − المُسلّم − قيد التوصيل.
                كل أوردر يُحتسب مرة واحدة بحالته الحالية، وما قبل تاريخ الجرد يُستبعد.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">من</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs">إلى</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
            </div>
            <Button variant="outline" onClick={() => void refresh(fromDate, toDate)} disabled={loading}>
              <RefreshCw className="ml-1 h-4 w-4" /> {loading ? "جارٍ التحميل" : "تحديث"}
            </Button>
            <Button onClick={exportExcel} disabled={!display} className="bg-gradient-to-l from-purple-600 to-orange-500 text-white">
              <Download className="ml-1 h-4 w-4" /> تصدير Excel
            </Button>
          </div>
        </div>

        {display?.baselineDate && (
          <p className="text-sm text-muted-foreground">
            آخر جرد معتمد لمخزن العجوزة: <span className="font-semibold text-foreground">{display.baselineDate}</span>
            {display.excludedBeforeCount > 0 && ` — استُبعد ${display.excludedBeforeCount} أوردر بتاريخ أقدم من الجرد حتى لا يُخصم مرتين.`}
            {display.gapAfterCount && " الفترة تبدأ بعد الجرد، فالحركة بين الجرد وبداية الفترة غير داخلة في الرصيد."}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">توريد مقترح (كجم)</div><div className="text-2xl font-bold text-orange-600">{fmt(totals?.replenishment || 0)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">رصيد محسوب (كجم)</div><div className="text-2xl font-bold text-purple-700">{fmt(totals?.balance || 0)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">خصم مُسلّم ناقص</div><div className="text-2xl font-bold">{display?.alerts.deductionFailures.length ?? "—"}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">بلا باركود / بانتظار الاستلام</div><div className="text-2xl font-bold">{(display?.alerts.missingBarcodes.length || 0) + (display?.alerts.pendingTransfers.length || 0)}</div></CardContent></Card>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">حد أدنى لكل الأصناف</Label>
            <Input value={bulkMin} onChange={(e) => setBulkMin(e.target.value)} inputMode="decimal" className="w-36" placeholder="كجم" />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              const value = Number(bulkMin);
              if (!Number.isFinite(value) || !display) return;
              const next = { ...minLevels };
              for (const row of display.rows) next[row.itemId] = value;
              persistMin(next);
            }}
          >
            تطبيق
          </Button>
          <p className="text-xs text-muted-foreground">الحد الأدنى يُحفظ على هذا الجهاز فقط، بلا كتابة في قاعدة البيانات. التوريد المقترح = الأكبر بين صفر و(الحد الأدنى − الرصيد).</p>
        </div>

        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الوحدة</TableHead>
                  <TableHead>تاريخ الجرد</TableHead>
                  <TableHead>جرد الأساس</TableHead>
                  <TableHead>وارد من الرئيسي</TableHead>
                  <TableHead>مرتجع مُفرّغ</TableHead>
                  <TableHead>مُسلّم</TableHead>
                  <TableHead>قيد التوصيل</TableHead>
                  <TableHead>الرصيد</TableHead>
                  <TableHead>رصيد النظام</TableHead>
                  <TableHead>الحد الأدنى</TableHead>
                  <TableHead>التوريد المقترح</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(display?.rows || []).map((row) => (
                  <TableRow key={row.itemId} className={row.replenishment > 0 ? "bg-orange-50/60" : undefined}>
                    <TableCell className="font-medium">
                      {row.name}
                      {row.missingBarcode && <Badge variant="outline" className="mr-2 border-orange-300 text-orange-700">بلا باركود</Badge>}
                    </TableCell>
                    <TableCell>{row.inKg ? "كجم" : row.unit}</TableCell>
                    <TableCell>{row.countDate || "—"}</TableCell>
                    <TableCell>{fmt(row.baseline)}</TableCell>
                    <TableCell>{fmt(row.inbound)}</TableCell>
                    <TableCell>{fmt(row.returned)}</TableCell>
                    <TableCell>{fmt(row.delivered)}</TableCell>
                    <TableCell>{fmt(row.inDelivery)}</TableCell>
                    <TableCell className="font-semibold">{fmt(row.balance)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmt(row.systemStock)}</TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-20"
                        inputMode="decimal"
                        value={String(row.minLevel)}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          if (!Number.isFinite(value)) return;
                          persistMin({ ...minLevels, [row.itemId]: value });
                        }}
                      />
                    </TableCell>
                    <TableCell className={row.replenishment > 0 ? "font-bold text-orange-700" : ""}>{fmt(row.replenishment)}</TableCell>
                  </TableRow>
                ))}
                {!loading && !display?.rows.length && (
                  <TableRow><TableCell colSpan={12}>لا أصناف في مخزن العجوزة.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">الكميات بالكيلوجرام للأصناف الموزونة. البطاطس بالعبوة والبيض بالقطعة يبقيان بوحدتهما. رصيد النظام هو الرقم المسجّل في coceg وقد يختلف عن الرصيد المحسوب إذا فشل خصم الأوردرات المُسلّمة.</p>

        <div className="grid gap-4 lg:grid-cols-3">
          <AlertCard title="أوردرات مُسلّمة بلا خصم" count={display?.alerts.deductionFailures.length || 0}>
            {(display?.alerts.deductionFailures || []).slice(0, 40).map((row) => (
              <li key={row.orderId} className="border-b py-2 text-sm last:border-0">
                <div className="font-medium">{row.orderNumber}</div>
                <div className="text-muted-foreground">{row.reason}{row.shippingBillNo ? ` — بوليصة ${row.shippingBillNo}` : ""} — {STOCK_STATUS_AR[row.stockStatus || ""] || row.stockStatus || "بدون حالة"}</div>
              </li>
            ))}
          </AlertCard>
          <AlertCard title="تحويلات بانتظار الاستلام" count={display?.alerts.pendingTransfers.length || 0}>
            {(display?.alerts.pendingTransfers || []).slice(0, 40).map((row, index) => (
              <li key={`${row.transferNo}-${row.itemName}-${index}`} className="border-b py-2 text-sm last:border-0">
                <div className="font-medium">{row.transferNo || "بدون رقم"} — {row.itemName}</div>
                <div className="text-muted-foreground">{row.sourceName} — {TRANSFER_STATUS_AR[row.status] || row.status} — {fmt(row.quantity)}</div>
              </li>
            ))}
          </AlertCard>
          <AlertCard title="أصناف بلا باركود" count={display?.alerts.missingBarcodes.length || 0}>
            {(display?.alerts.missingBarcodes || []).map((row) => (
              <li key={row.itemId} className="border-b py-2 text-sm last:border-0">{row.name}</li>
            ))}
            {(display?.alerts.unmatchedLines.length || 0) > 0 && (
              <li className="pt-2 text-sm text-orange-700">سطور أوردر بلا بطاقة في العجوزة: {display?.alerts.unmatchedLines.length}</li>
            )}
          </AlertCard>
        </div>
      </div>
    </DashboardLayout>
  );
}

function AlertCard({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <TriangleAlert className="h-4 w-4 text-orange-600" />
          {title}
          <Badge variant={count ? "destructive" : "secondary"}>{count}</Badge>
        </div>
        <ul className="max-h-72 overflow-auto">{count ? children : <li className="text-sm text-muted-foreground">لا شيء</li>}</ul>
      </CardContent>
    </Card>
  );
}
