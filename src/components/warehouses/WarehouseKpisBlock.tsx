import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Package, AlertTriangle, DollarSign, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/dateFormat";

interface InventoryItem {
  id: string;
  warehouse_id: string;
  name: string;
  sku: string | null;
  unit: string;
  stock: number;
  low_stock_threshold: number;
  unit_cost: number;
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

export default function WarehouseKpisBlock({ warehouseId, warehouseName, items, movements }: Props) {
  const [showLow, setShowLow] = useState(false);

  const whItems = useMemo(
    () => (warehouseId ? items.filter((i) => i.warehouse_id === warehouseId) : []),
    [items, warehouseId]
  );
  const whMovements = useMemo(
    () => (warehouseId ? movements.filter((m) => m.warehouse_id === warehouseId) : []),
    [movements, warehouseId]
  );
  const lowItems = useMemo(() => whItems.filter((i) => i.stock <= i.low_stock_threshold), [whItems]);
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

  if (!warehouseId) {
    return (
      <Card>
        <CardContent className="py-4 text-center text-sm text-muted-foreground">
          المخزن "{warehouseName}" غير معرَّف في قاعدة البيانات بعد — لا يمكن حساب المؤشرات.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><DollarSign className="w-3 h-3" />قيمة المخزون</CardDescription>
            <CardTitle className="text-2xl">{totalValue.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">ج.م</span></CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1"><Package className="w-3 h-3" />عدد الأصناف</CardDescription>
            <CardTitle className="text-2xl">{whItems.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${lowItems.length > 0 ? "border-destructive bg-destructive/5 hover:bg-destructive/10" : "hover:border-primary/40"}`}
          onClick={() => setShowLow(true)}
        >
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <AlertTriangle className={`w-3 h-3 ${lowItems.length > 0 ? "text-destructive" : ""}`} />
              منتجات منخفضة
            </CardDescription>
            <CardTitle className={`text-2xl ${lowItems.length > 0 ? "text-destructive" : ""}`}>
              {lowItems.length}
              {lowItems.length > 0 && <span className="text-xs font-normal text-muted-foreground mr-2">اضغط للعرض</span>}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
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
          </CardHeader>
        </Card>
      </div>

      <Dialog open={showLow} onOpenChange={setShowLow}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              المنتجات المنخفضة — {warehouseName}
              <Badge variant={lowItems.length > 0 ? "destructive" : "outline"}>{lowItems.length}</Badge>
            </DialogTitle>
          </DialogHeader>
          {lowItems.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">لا توجد منتجات منخفضة في هذا المخزن</div>
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
                  {lowItems.map((it) => {
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLow(false)}>رجوع للمخزن</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
