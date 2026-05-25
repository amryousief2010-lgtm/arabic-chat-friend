import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import FactoryFilters, { defaultFilterState, FactoryFilterState } from "@/components/factory/FactoryFilters";
import { useFactoryData } from "@/hooks/useFactoryData";
import { exportCSV } from "@/lib/csvExport";
import { Link } from "react-router-dom";

// Accept both short keys ("batches") and full slug keys ("production") in the URL.
const TAB_ALIASES: Record<string, string> = {
  production: "batches",
  "raw-materials": "raw",
  packaging: "packaging",
  "inventory-movements": "movements",
  "cost-analysis": "cost",
  "pending-review": "pending",
};
const TAB_TO_SLUG: Record<string, string> = {
  batches: "production",
  raw: "raw-materials",
  packaging: "packaging",
  movements: "inventory-movements",
  cost: "cost-analysis",
  pending: "pending-review",
};

export default function FactoryReports() {
  const [sp, setSp] = useSearchParams();
  const rawTab = sp.get("tab") || "production";
  const tab = TAB_ALIASES[rawTab] ?? rawTab;
  const [f, setF] = useState<FactoryFilterState>(defaultFilterState());
  const { meat, feed, meatCons, meatPack, feedCons, movs, items } = useFactoryData(f.from, f.to);

  const itemById = useMemo(() => Object.fromEntries(items.map((i: any) => [i.id, i])), [items]);

  // Batches
  const batches = useMemo(() => {
    const rows = [
      ...meat.map((b: any) => ({
        id: b.id, batch_number: b.batch_number, date: (b.production_date || b.created_at?.slice(0, 10)) || "", factory: "Meat",
        product: b.product_name_ar || b.product_code, status: b.status,
        planned_qty: b.planned_qty, actual_qty: b.actual_qty,
        planned_cost: b.planned_total_cost, actual_cost: b.total_cost,
        cost_per_unit: b.cost_per_unit, prepared_by: b.created_by, approved_by: b.approved_by, closed_by: b.closed_by,
      })),
      ...feed.map((b: any) => ({
        id: b.id, batch_number: b.batch_number, date: (b.production_date || b.created_at?.slice(0, 10)) || "", factory: "Feed",
        product: b.feed_product_id?.slice(0, 8), status: b.status,
        planned_qty: b.target_quantity, actual_qty: b.actual_quantity,
        planned_cost: b.planned_total_cost, actual_cost: b.total_cost,
        cost_per_unit: b.cost_per_kg, prepared_by: b.created_by, approved_by: b.approved_by, closed_by: b.closed_by,
      })),
    ];
    return rows.filter((r) => f.status === "all" || r.status === f.status).filter((r) => !f.search || JSON.stringify(r).toLowerCase().includes(f.search.toLowerCase()));
  }, [meat, feed, f.status, f.search]);

  const rawRows = useMemo(() => {
    const meatRows = meatCons.map((c: any) => ({
      item_code: c.material_code || "", item_name: c.material_name_ar || "", factory: "Meat",
      qty: Number(c.actual_qty ?? c.quantity ?? 0), unit_cost: Number(c.unit_cost || 0), total: Number(c.line_total || 0),
      batch: c.meat_factory_batches?.batch_number,
    }));
    const feedRows = feedCons.map((c: any) => ({
      item_code: itemById[c.inventory_item_id]?.item_code || "", item_name: c.material_name || "", factory: "Feed",
      qty: Number(c.actual_qty ?? c.quantity ?? 0), unit_cost: Number(c.unit_cost || 0), total: Number(c.total_cost || 0),
      batch: c.feed_production_batches?.batch_number,
    }));
    return [...meatRows, ...feedRows].filter((r) => !f.search || JSON.stringify(r).toLowerCase().includes(f.search.toLowerCase()));
  }, [meatCons, feedCons, itemById, f.search]);

  const packRows = useMemo(() =>
    meatPack.map((p: any) => ({
      item_name: p.packaging_name_ar, qty: Number(p.actual_qty ?? p.quantity ?? 0), unit: p.unit,
      unit_cost: Number(p.unit_cost || 0), total: Number(p.line_total || 0),
      batch: p.meat_factory_batches?.batch_number,
    })).filter((r) => !f.search || JSON.stringify(r).toLowerCase().includes(f.search.toLowerCase()))
  , [meatPack, f.search]);

  const movRows = useMemo(() =>
    movs.map((m: any) => ({
      movement_no: m.movement_no, date: m.performed_at?.slice(0, 10) || m.created_at?.slice(0, 10),
      item: itemById[m.item_id]?.name || m.item_id?.slice(0, 8), type: m.movement_type,
      quantity: Number(m.quantity || 0), unit_cost: Number(m.unit_cost || 0), total: Number(m.total_cost || 0),
      reference_type: m.reference_type, reference_id: m.reference_id,
    })).filter((r) => !f.search || JSON.stringify(r).toLowerCase().includes(f.search.toLowerCase()))
  , [movs, itemById, f.search]);

  const costRows = useMemo(() => batches.filter((b: any) => b.status === "closed").map((b: any) => {
    const planned = b.planned_cost == null ? null : Number(b.planned_cost);
    const actual = Number(b.actual_cost || 0);
    const variance = planned == null ? null : actual - planned;
    const variancePct = planned == null || planned === 0 ? null : (variance! / planned) * 100;
    return {
      factory: b.factory, batch: b.batch_number,
      planned_qty: b.planned_qty, actual_qty: b.actual_qty,
      planned_cost: planned == null ? "planned snapshot not available" : planned.toFixed(2),
      actual_cost: actual.toFixed(2),
      variance: variance == null ? "—" : variance.toFixed(2),
      variance_pct: variancePct == null ? "—" : variancePct.toFixed(2) + "%",
      cost_per_unit: b.cost_per_unit,
    };
  }), [batches]);

  const pendingRows = useMemo(() => {
    const list: any[] = [];
    items.forEach((i: any) => {
      if (Number(i.unit_cost) === 0 && Number(i.stock) > 0) list.push({ type: "zero_cost", item_code: i.item_code, item_name: i.name, value: `stock=${i.stock}` });
      if (Number(i.stock) < 0) list.push({ type: "negative_stock", item_code: i.item_code, item_name: i.name, value: i.stock });
      if (!i.sku && (i.module === "meat" || i.module === "feed")) list.push({ type: "missing_barcode", item_code: i.item_code, item_name: i.name, value: "—" });
    });
    list.push({ type: "invoice_review", item_code: "—", item_name: "Invoice 164", value: "needs_review (preserved)" });
    return list.filter((r) => !f.search || JSON.stringify(r).toLowerCase().includes(f.search.toLowerCase()));
  }, [items, f.search]);

  const exportMap: Record<string, () => void> = {
    batches: () => exportCSV("production-batches.csv", batches),
    raw: () => exportCSV("raw-material-consumption.csv", rawRows),
    packaging: () => exportCSV("packaging-consumption.csv", packRows),
    movements: () => exportCSV("inventory-movements.csv", movRows),
    cost: () => exportCSV("cost-analysis.csv", costRows),
    pending: () => exportCSV("pending-review.csv", pendingRows),
  };

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-bold">تقارير المصانع</h1>
      <FactoryFilters value={f} onChange={setF} statuses={["draft", "under_review", "approved", "closed", "cancelled"]} onExport={exportMap[tab]} />

      <Tabs value={tab} onValueChange={(v) => setSp({ tab: TAB_TO_SLUG[v] || v })}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="batches">دفعات الإنتاج</TabsTrigger>
          <TabsTrigger value="raw">المواد الخام</TabsTrigger>
          <TabsTrigger value="packaging">التغليف</TabsTrigger>
          <TabsTrigger value="movements">حركات المخزون</TabsTrigger>
          <TabsTrigger value="cost">تحليل التكلفة</TabsTrigger>
          <TabsTrigger value="pending">عناصر للمراجعة</TabsTrigger>
        </TabsList>

        <TabsContent value="batches"><Card><CardHeader><CardTitle className="text-base">دفعات الإنتاج ({batches.length})</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table><TableHeader><TableRow>
              <TableHead>رقم</TableHead><TableHead>تاريخ</TableHead><TableHead>المصنع</TableHead><TableHead>المنتج</TableHead><TableHead>الحالة</TableHead><TableHead>كمية</TableHead><TableHead>تكلفة</TableHead><TableHead>تكلفة/وحدة</TableHead>
            </TableRow></TableHeader>
            <TableBody>{batches.slice(0, 200).map((b: any, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">
                  <Link to={`/${b.factory === "Meat" ? "meat" : "feed"}-factory/batches/${(b.factory === "Meat" ? meat : feed).find((x: any) => x.batch_number === b.batch_number)?.id}`} className="underline">{b.batch_number}</Link>
                </TableCell>
                <TableCell>{b.date}</TableCell><TableCell><Badge variant="outline">{b.factory}</Badge></TableCell><TableCell className="max-w-[200px] truncate">{b.product}</TableCell><TableCell>{b.status}</TableCell><TableCell>{Number(b.actual_qty || 0).toFixed(2)}</TableCell><TableCell>{Number(b.total_cost || 0).toFixed(2)}</TableCell><TableCell>{b.cost_per_unit ? Number(b.cost_per_unit).toFixed(4) : "—"}</TableCell>
              </TableRow>
            ))}</TableBody></Table>
          </CardContent></Card></TabsContent>

        <TabsContent value="raw"><Card><CardHeader><CardTitle className="text-base">استهلاك المواد الخام ({rawRows.length})</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table><TableHeader><TableRow><TableHead>كود</TableHead><TableHead>اسم</TableHead><TableHead>مصنع</TableHead><TableHead>كمية</TableHead><TableHead>تكلفة/وحدة</TableHead><TableHead>إجمالي</TableHead><TableHead>دفعة</TableHead></TableRow></TableHeader>
            <TableBody>{rawRows.slice(0, 300).map((r, i) => (<TableRow key={i}><TableCell className="font-mono text-xs">{r.item_code}</TableCell><TableCell>{r.item_name}</TableCell><TableCell><Badge variant="outline">{r.factory}</Badge></TableCell><TableCell>{r.qty.toFixed(3)}</TableCell><TableCell>{r.unit_cost.toFixed(4)}</TableCell><TableCell>{r.total.toFixed(2)}</TableCell><TableCell className="font-mono text-xs">{r.batch}</TableCell></TableRow>))}</TableBody></Table>
          </CardContent></Card></TabsContent>

        <TabsContent value="packaging"><Card><CardHeader><CardTitle className="text-base">استهلاك التغليف ({packRows.length})</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table><TableHeader><TableRow><TableHead>اسم</TableHead><TableHead>كمية</TableHead><TableHead>تكلفة/وحدة</TableHead><TableHead>إجمالي</TableHead><TableHead>دفعة</TableHead></TableRow></TableHeader>
            <TableBody>{packRows.slice(0, 300).map((r, i) => (<TableRow key={i}><TableCell>{r.item_name}</TableCell><TableCell>{r.qty.toFixed(2)} {r.unit}</TableCell><TableCell>{r.unit_cost.toFixed(4)}</TableCell><TableCell>{r.total.toFixed(2)}</TableCell><TableCell className="font-mono text-xs">{r.batch}</TableCell></TableRow>))}</TableBody></Table>
          </CardContent></Card></TabsContent>

        <TabsContent value="movements"><Card><CardHeader><CardTitle className="text-base">حركات المخزون ({movRows.length})</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>تاريخ</TableHead><TableHead>صنف</TableHead><TableHead>نوع</TableHead><TableHead>كمية</TableHead><TableHead>تكلفة</TableHead><TableHead>إجمالي</TableHead><TableHead>مرجع</TableHead></TableRow></TableHeader>
            <TableBody>{movRows.slice(0, 300).map((r, i) => (<TableRow key={i}><TableCell className="font-mono text-xs">{r.movement_no}</TableCell><TableCell>{r.date}</TableCell><TableCell>{r.item}</TableCell><TableCell><Badge variant="outline">{r.type}</Badge></TableCell><TableCell>{r.quantity.toFixed(3)}</TableCell><TableCell>{r.unit_cost.toFixed(4)}</TableCell><TableCell>{r.total.toFixed(2)}</TableCell><TableCell className="text-xs">{r.reference_type}/{String(r.reference_id).slice(0, 8)}</TableCell></TableRow>))}</TableBody></Table>
          </CardContent></Card></TabsContent>

        <TabsContent value="cost"><Card><CardHeader><CardTitle className="text-base">تحليل التكلفة (مغلقة فقط)</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table><TableHeader><TableRow><TableHead>مصنع</TableHead><TableHead>دفعة</TableHead><TableHead>BOM</TableHead><TableHead>مخططة</TableHead><TableHead>فعلية</TableHead><TableHead>تباين</TableHead><TableHead>تكلفة/وحدة</TableHead></TableRow></TableHeader>
            <TableBody>{costRows.map((r: any, i) => (<TableRow key={i}><TableCell><Badge variant="outline">{r.factory}</Badge></TableCell><TableCell className="font-mono text-xs">{r.batch}</TableCell><TableCell>{r.bom_version}</TableCell><TableCell>{r.planned_cost}</TableCell><TableCell>{Number(r.actual_cost || 0).toFixed(2)}</TableCell><TableCell>{r.variance}</TableCell><TableCell>{r.cost_per_unit ? Number(r.cost_per_unit).toFixed(4) : "—"}</TableCell></TableRow>))}</TableBody></Table>
          </CardContent></Card></TabsContent>

        <TabsContent value="pending"><Card><CardHeader><CardTitle className="text-base">عناصر للمراجعة ({pendingRows.length})</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table><TableHeader><TableRow><TableHead>النوع</TableHead><TableHead>الكود</TableHead><TableHead>الاسم</TableHead><TableHead>القيمة</TableHead></TableRow></TableHeader>
            <TableBody>{pendingRows.slice(0, 300).map((r, i) => (<TableRow key={i}><TableCell><Badge variant={r.type === "invoice_review" ? "outline" : "destructive"}>{r.type}</Badge></TableCell><TableCell className="font-mono text-xs">{r.item_code}</TableCell><TableCell>{r.item_name}</TableCell><TableCell>{r.value}</TableCell></TableRow>))}</TableBody></Table>
          </CardContent></Card></TabsContent>
      </Tabs>
    </div>
  );
}
