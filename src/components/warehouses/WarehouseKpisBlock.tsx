import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Package, AlertTriangle, DollarSign, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/dateFormat";
import { isMainWarehouseExcludedCategory, isMainWarehouseName } from "@/constants/warehouseCategoryFilters";

interface InventoryItem {
  id: string;
  warehouse_id: string;
  name: string;
  sku: string | null;
  unit: string;
  stock: number;
  low_stock_threshold: number;
  unit_cost: number;
  category?: string | null;
}

interface Movement {
  id: string;
  item_id: string;
  warehouse_id: string;
  movement_type: string;
  quantity: number;
  performed_at: string;
  item?: { name: string; unit: string };
}

interface Props {
  warehouseId?: string;
  warehouseName: string;
  items: InventoryItem[];
  movements: Movement[];
}

const MOVE_LABELS: Record<string, string> = {
  in: "إضافة", out: "صرف", transfer: "تحويل", adjustment: "تسوية",
  purchase_receipt: "استلام شراء", opening_balance: "رصيد افتتاحي",
  sales_return: "مرتجع مبيعات", sales_dispatch: "صرف مبيعات",
};

type DialogKey = null | "value" | "count" | "low" | "moves";

export default function WarehouseKpisBlock({ warehouseId, warehouseName, items, movements }: Props) {
  const [openDialog, setOpenDialog] = useState<DialogKey>(null);
  const [search, setSearch] = useState("");

  const isMain = isMainWarehouseName(warehouseName);

  // STRICT per-warehouse filtering — never mix items/movements from other warehouses.
  // For Main Warehouse: also exclude categories that belong to other warehouses
  // (meat factory raw, feed raw, packaging) even if mis-assigned in DB.
  const whItems = useMemo(
    () => {
      if (!warehouseId) return [] as InventoryItem[];
      const base = items.filter((i) => i.warehouse_id === warehouseId);
      return isMain ? base.filter((i) => !isMainWarehouseExcludedCategory(i.category)) : base;
    },
    [items, warehouseId, isMain]
  );
  const whMovements = useMemo(
    () => {
      if (!warehouseId) return [] as Movement[];
      const base = movements.filter((m) => m.warehouse_id === warehouseId);
      if (!isMain) return base;
      const allowedIds = new Set(whItems.map((i) => i.id));
      return base.filter((m) => allowedIds.has(m.item_id));
    },
    [movements, warehouseId, isMain, whItems]
  );

  const lowItems = useMemo(
    () => whItems.filter((i) => Number(i.stock || 0) < Number(i.low_stock_threshold || 0)),
    [whItems]
  );
  const totalValue = useMemo(
    () => whItems.reduce((s, i) => s + Number(i.stock || 0) * Number(i.unit_cost || 0), 0),
    [whItems]
  );
  const lastMove = whMovements[0];

  const lastMoveByItem = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of whMovements) if (!map.has(m.item_id)) map.set(m.item_id, m.performed_at);
    return map;
  }, [whMovements]);

  const filterFn = (it: InventoryItem) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (it.name || "").toLowerCase().includes(q) || (it.sku || "").toLowerCase().includes(q);
  };

  const close = () => { setOpenDialog(null); setSearch(""); };

  if (!warehouseId) {
    return (
      <Card>
        <CardContent className="py-4 text-center text-sm text-muted-foreground">
          المخزن "{warehouseName}" غير معرَّف في قاعدة البيانات بعد — لا يمكن حساب المؤشرات.
        </CardContent>
      </Card>
    );
  }

  const valueItems = whItems.filter(filterFn).map((it) => ({ ...it, value: Number(it.stock || 0) * Number(it.unit_cost || 0) }));
  const filteredItems = whItems.filter(filterFn);
  const filteredLow = lowItems.filter(filterFn);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-4">
        <Card
          className="cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => setOpenDialog("value")}
        >
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><DollarSign className="w-3 h-3" />قيمة المخزون</CardDescription>
            <CardTitle className="text-2xl">{totalValue.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">ج.م</span></CardTitle>
            <span className="text-[10px] text-muted-foreground">اضغط للتفاصيل</span>
          </CardHeader>
        </Card>
        <Card
          className="cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => setOpenDialog("count")}
        >
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><Package className="w-3 h-3" />عدد الأصناف</CardDescription>
            <CardTitle className="text-2xl">{whItems.length}</CardTitle>
            <span className="text-[10px] text-muted-foreground">اضغط للتفاصيل</span>
          </CardHeader>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${lowItems.length > 0 ? "border-destructive bg-destructive/5 hover:bg-destructive/10" : "hover:border-primary/40"}`}
          onClick={() => setOpenDialog("low")}
        >
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <AlertTriangle className={`w-3 h-3 ${lowItems.length > 0 ? "text-destructive" : ""}`} />
              منتجات منخفضة
            </CardDescription>
            <CardTitle className={`text-2xl ${lowItems.length > 0 ? "text-destructive" : ""}`}>
              {lowItems.length}
            </CardTitle>
            <span className="text-[10px] text-muted-foreground">اضغط للعرض</span>
          </CardHeader>
        </Card>
        <Card
          className="cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => setOpenDialog("moves")}
        >
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><Clock className="w-3 h-3" />آخر حركة</CardDescription>
            <CardTitle className="text-sm font-medium leading-tight">
              {lastMove ? (
                <>
                  <div>{MOVE_LABELS[lastMove.movement_type] || lastMove.movement_type} • {lastMove.item?.name || "—"}</div>
                  <div className="text-xs text-muted-foreground font-normal mt-1">
                    {lastMove.quantity} {lastMove.item?.unit || ""} • {formatDateTime(lastMove.performed_at)}
                  </div>
                </>
              ) : (
                <span className="text-muted-foreground font-normal">لا توجد حركات</span>
              )}
            </CardTitle>
            <span className="text-[10px] text-muted-foreground">اضغط لكل الحركات</span>
          </CardHeader>
        </Card>
      </div>

      {/* LOW STOCK DIALOG */}
      <Dialog open={openDialog === "low"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              المنتجات المنخفضة — {warehouseName}
              <Badge variant={lowItems.length > 0 ? "destructive" : "outline"}>{lowItems.length}</Badge>
            </DialogTitle>
          </DialogHeader>
          <Input placeholder="بحث بالاسم أو الكود..." value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />
          {filteredLow.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              {lowItems.length === 0 ? "لا توجد منتجات منخفضة في هذا المخزن" : "لا نتائج للبحث"}
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الصنف</TableHead>
                    <TableHead>الكود</TableHead>
                    <TableHead>الوحدة</TableHead>
                    <TableHead>الرصيد</TableHead>
                    <TableHead>الحد الأدنى</TableHead>
                    <TableHead>العجز</TableHead>
                    <TableHead>التكلفة</TableHead>
                    <TableHead>قيمة المخزون</TableHead>
                    <TableHead>آخر حركة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLow.map((it) => {
                    const deficit = Math.max(0, Number(it.low_stock_threshold || 0) - Number(it.stock || 0));
                    const value = Number(it.stock || 0) * Number(it.unit_cost || 0);
                    const last = lastMoveByItem.get(it.id);
                    return (
                      <TableRow key={it.id} className="bg-destructive/5">
                        <TableCell className="font-medium">{it.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{it.sku || "—"}</TableCell>
                        <TableCell>{it.unit}</TableCell>
                        <TableCell className="text-destructive font-bold">{it.stock}</TableCell>
                        <TableCell>{it.low_stock_threshold}</TableCell>
                        <TableCell className="text-destructive">{deficit > 0 ? `-${deficit}` : "—"}</TableCell>
                        <TableCell>{Number(it.unit_cost || 0).toFixed(2)}</TableCell>
                        <TableCell>{value.toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{last ? formatDateTime(last) : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={close}>رجوع</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* INVENTORY VALUE DIALOG */}
      <Dialog open={openDialog === "value"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              قيمة المخزون — {warehouseName}
              <Badge variant="outline">{totalValue.toLocaleString()} ج.م</Badge>
            </DialogTitle>
          </DialogHeader>
          <Input placeholder="بحث بالاسم أو الكود..." value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الكود</TableHead>
                  <TableHead>الوحدة</TableHead>
                  <TableHead>الرصيد</TableHead>
                  <TableHead>التكلفة</TableHead>
                  <TableHead>قيمة المخزون</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {valueItems.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد بيانات</TableCell></TableRow>
                ) : valueItems.sort((a, b) => b.value - a.value).map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{it.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{it.sku || "—"}</TableCell>
                    <TableCell>{it.unit}</TableCell>
                    <TableCell>{it.stock}</TableCell>
                    <TableCell>{Number(it.unit_cost || 0).toFixed(2)}</TableCell>
                    <TableCell className="font-semibold">{it.value.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter><Button variant="outline" onClick={close}>رجوع</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ITEMS COUNT DIALOG */}
      <Dialog open={openDialog === "count"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              أصناف المخزن — {warehouseName}
              <Badge variant="outline">{whItems.length}</Badge>
            </DialogTitle>
          </DialogHeader>
          <Input placeholder="بحث بالاسم أو الكود..." value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الكود</TableHead>
                  <TableHead>الوحدة</TableHead>
                  <TableHead>الرصيد</TableHead>
                  <TableHead>الحد الأدنى</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد بيانات</TableCell></TableRow>
                ) : filteredItems.map((it) => {
                  const low = Number(it.stock || 0) < Number(it.low_stock_threshold || 0);
                  return (
                    <TableRow key={it.id} className={low ? "bg-destructive/5" : ""}>
                      <TableCell className="font-medium">{it.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{it.sku || "—"}</TableCell>
                      <TableCell>{it.unit}</TableCell>
                      <TableCell className={low ? "text-destructive font-bold" : ""}>{it.stock}</TableCell>
                      <TableCell>{it.low_stock_threshold}</TableCell>
                      <TableCell>
                        {low ? <Badge variant="destructive">منخفض</Badge> : <Badge variant="outline">طبيعي</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <DialogFooter><Button variant="outline" onClick={close}>رجوع</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MOVEMENTS DIALOG */}
      <Dialog open={openDialog === "moves"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              حركات المخزن — {warehouseName}
              <Badge variant="outline">{whMovements.length}</Badge>
            </DialogTitle>
          </DialogHeader>
          <Input placeholder="بحث باسم الصنف..." value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>الوحدة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {whMovements.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">لا توجد حركات</TableCell></TableRow>
                ) : whMovements
                    .filter((m) => !search.trim() || (m.item?.name || "").toLowerCase().includes(search.trim().toLowerCase()))
                    .map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(m.performed_at)}</TableCell>
                        <TableCell><Badge variant="secondary">{MOVE_LABELS[m.movement_type] || m.movement_type}</Badge></TableCell>
                        <TableCell className="font-medium">{m.item?.name || "—"}</TableCell>
                        <TableCell>{m.quantity}</TableCell>
                        <TableCell>{m.item?.unit || ""}</TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter><Button variant="outline" onClick={close}>رجوع</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
