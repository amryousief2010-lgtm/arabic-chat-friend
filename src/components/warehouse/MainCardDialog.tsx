import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PackageCheck, AlertTriangle, Download, Eye } from "lucide-react";
import { formatDateTime } from "@/lib/dateFormat";

interface Product { id: string; name: string; unit: string; }

interface Props {
  mode: null | "withStock" | "overReserved";
  onClose: () => void;
  products: Product[];
  mainStock: Record<string, number>;
  mainPending: Record<string, number>;
  mainCost: Record<string, number>;
  mainSku: Record<string, string>;
  mainLastMove: Record<string, string>;
  search: string;
  onSearch: (s: string) => void;
  onOpenReserved: (productId: string, name: string, total: number) => void;
  warehouseName?: string;
}

export default function MainCardDialog({
  mode, onClose, products, mainStock, mainPending, mainCost, mainSku, mainLastMove,
  search, onSearch, onOpenReserved, warehouseName,
}: Props) {
  const whLabel = warehouseName || "المخزن الرئيسي";

  const rows = useMemo(() => {
    const base = products.map((p) => {
      const actual = Number(mainStock[p.id] || 0);
      const reserved = Number(mainPending[p.id] || 0);
      const cost = Number(mainCost[p.id] || 0);
      return {
        id: p.id,
        name: p.name,
        unit: p.unit,
        sku: mainSku[p.id] || "",
        actual,
        reserved,
        available: actual - reserved,
        deficit: reserved - actual,
        cost,
        value: actual * cost,
        lastMove: mainLastMove[p.id] || "",
      };
    });
    const filtered = mode === "withStock"
      ? base.filter((r) => r.actual > 0)
      : mode === "overReserved"
      ? base.filter((r) => r.reserved > r.actual)
      : [];
    const q = search.trim().toLowerCase();
    return q
      ? filtered.filter((r) => r.name.toLowerCase().includes(q) || (r.sku || "").toLowerCase().includes(q))
      : filtered;
  }, [products, mainStock, mainPending, mainCost, mainSku, mainLastMove, search, mode]);

  const exportCSV = () => {
    const isOver = mode === "overReserved";
    const headers = isOver
      ? ["الصنف", "الكود", "الوحدة", "الفعلي", "المحجوز", "العجز", "آخر حركة"]
      : ["الصنف", "الكود", "الوحدة", "الفعلي", "المحجوز", "المتاح", "التكلفة", "قيمة المخزون", "آخر حركة"];
    const lines = [headers.join(",")];
    rows.forEach((r) => {
      const cols = isOver
        ? [r.name, r.sku, r.unit, r.actual, r.reserved, r.deficit, r.lastMove]
        : [r.name, r.sku, r.unit, r.actual, r.reserved, r.available, r.cost.toFixed(2), r.value.toFixed(2), r.lastMove];
      lines.push(cols.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","));
    });
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${isOver ? "over-reserved" : "items-with-stock"}-${(whLabel || "warehouse").replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isOver = mode === "overReserved";

  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isOver ? <AlertTriangle className="w-5 h-5 text-destructive" /> : <PackageCheck className="w-5 h-5 text-green-600" />}
            {isOver ? `أصناف محجوز أكثر من الفعلي — ${whLabel}` : `أصناف لها رصيد فعلي — ${whLabel}`}
            <Badge variant={isOver ? "destructive" : "outline"}>{rows.length}</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-2 flex-wrap items-center mb-2">
          <Input
            placeholder="بحث باسم الصنف أو الكود..."
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="flex-1 min-w-[200px]"
          />
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={rows.length === 0}>
            <Download className="w-4 h-4 ml-1" /> تصدير Excel
          </Button>
        </div>
        {rows.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">لا توجد أصناف</div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الكود</TableHead>
                  <TableHead>الوحدة</TableHead>
                  <TableHead>الفعلي</TableHead>
                  <TableHead>المحجوز</TableHead>
                  {isOver ? (
                    <>
                      <TableHead>العجز</TableHead>
                      <TableHead>الطلبات</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead>المتاح للبيع</TableHead>
                      <TableHead>التكلفة</TableHead>
                      <TableHead>قيمة المخزون</TableHead>
                    </>
                  )}
                  <TableHead>آخر حركة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className={isOver ? "bg-destructive/5" : ""}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.sku || "—"}</TableCell>
                    <TableCell>{r.unit}</TableCell>
                    <TableCell className={isOver ? "text-destructive font-bold" : ""}>{r.actual}</TableCell>
                    <TableCell>{r.reserved}</TableCell>
                    {isOver ? (
                      <>
                        <TableCell className="text-destructive font-bold">-{r.deficit}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => onOpenReserved(r.id, r.name, r.reserved)}>
                            <Eye className="w-4 h-4 ml-1" /> عرض
                          </Button>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className={r.available < 0 ? "text-destructive" : ""}>{r.available}</TableCell>
                        <TableCell>{r.cost.toFixed(2)}</TableCell>
                        <TableCell className="font-semibold">{r.value.toFixed(2)}</TableCell>
                      </>
                    )}
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {r.lastMove ? formatDateTime(r.lastMove) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>رجوع للمخزن</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
