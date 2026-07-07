import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeftRight, Loader2, Package } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/dateFormat";

interface Props {
  open: boolean;
  onClose: () => void;
  warehouseId: string;
  warehouseName?: string;
  productId: string;
  productName: string;
  unit: string;
  mainActual: number;
  mainReserved: number;
}

interface SubLoc { id: string; name_ar: string; code: string; sort_order: number; }
interface Move { id: string; qty: number; created_at: string; from_sublocation_id: string; to_sublocation_id: string; created_by: string | null; }

const fmt = (n: number) => {
  if (!isFinite(n)) return "0";
  const r = Math.round(n * 1000) / 1000;
  return Number(r).toString();
};

export default function SubLocationDistributionDialog({
  open, onClose, warehouseId, warehouseName, productId, productName, unit,
  mainActual, mainReserved,
}: Props) {
  const [subs, setSubs] = useState<SubLoc[]>([]);
  const [stockBySub, setStockBySub] = useState<Record<string, number>>({});
  const [moves, setMoves] = useState<Move[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [fromSub, setFromSub] = useState<string>("");
  const [toSub, setToSub] = useState<string>("");
  const [qty, setQty] = useState<string>("");

  const load = async () => {
    setLoading(true);
    try {
      const { data: sRows } = await supabase
        .from("warehouse_sublocations")
        .select("id, name_ar, code, sort_order")
        .eq("warehouse_id", warehouseId)
        .eq("is_active", true)
        .order("sort_order");
      const subList = (sRows || []) as SubLoc[];
      setSubs(subList);
      const subIds = subList.map((s) => s.id);
      if (!subIds.length) { setStockBySub({}); setMoves([]); return; }

      const { data: iRows } = await supabase
        .from("inventory_sublocation_items")
        .select("sublocation_id, stock")
        .eq("product_id", productId)
        .in("sublocation_id", subIds);
      const map: Record<string, number> = {};
      (iRows || []).forEach((r: any) => { map[r.sublocation_id] = Number(r.stock || 0); });
      setStockBySub(map);

      const { data: mRows } = await supabase
        .from("sublocation_movements")
        .select("id, qty, created_at, from_sublocation_id, to_sublocation_id, created_by")
        .eq("product_id", productId)
        .in("from_sublocation_id", subIds)
        .order("created_at", { ascending: false })
        .limit(30);
      const moveList = (mRows || []) as Move[];
      setMoves(moveList);

      const uids = Array.from(new Set(moveList.map((m) => m.created_by).filter(Boolean))) as string[];
      if (uids.length) {
        const { data: profs } = await supabase.from("profile_directory").select("id, full_name").in("id", uids);
        const um: Record<string, string> = {};
        (profs || []).forEach((p: any) => { um[p.id] = p.full_name; });
        setUserNames(um);
      } else {
        setUserNames({});
      }

      if (subList.length >= 2) {
        setFromSub(subList[0].id);
        setToSub(subList[1].id);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) { setQty(""); load(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, warehouseId, productId]);

  const subTotal = useMemo(
    () => subs.reduce((a, s) => a + (stockBySub[s.id] || 0), 0),
    [subs, stockBySub]
  );

  // Reserved shown per sublocation: proportional to sublocation stock over sub total.
  const reservedForSub = (subId: string): number => {
    const st = stockBySub[subId] || 0;
    if (subTotal <= 0 || mainReserved <= 0) return 0;
    return Math.round((mainReserved * st / subTotal) * 100) / 100;
  };

  const canTransfer = fromSub && toSub && fromSub !== toSub && Number(qty) > 0
    && Number(qty) <= (stockBySub[fromSub] || 0);

  const submitTransfer = async () => {
    if (!canTransfer) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("transfer_between_sublocations" as any, {
        p_product_id: productId,
        p_from_sublocation_id: fromSub,
        p_to_sublocation_id: toSub,
        p_qty: Number(qty),
        p_notes: null,
      });
      if (error) throw error;
      toast.success("تم النقل الداخلي بنجاح");
      setQty("");
      await load();
    } catch (e: any) {
      toast.error(e.message || "فشل النقل");
    } finally {
      setBusy(false);
    }
  };

  const subName = (id: string) => subs.find((s) => s.id === id)?.name_ar || "—";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            توزيع الكمية داخل {warehouseName || "المخزن الرئيسي"}
          </DialogTitle>
        </DialogHeader>

        <div className="text-sm mb-2">
          المنتج: <span className="font-bold">{productName}</span>{" "}
          <span className="text-muted-foreground">({unit})</span>
        </div>

        {loading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin ml-2" /> جارٍ التحميل...
          </div>
        ) : subs.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground">لا توجد أماكن فرعية مُعرَّفة لهذا المخزن</div>
        ) : (
          <>
            <div className="rounded-md border overflow-x-auto mb-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المكان</TableHead>
                    <TableHead>الفعلي</TableHead>
                    <TableHead>المحجوز</TableHead>
                    <TableHead>المتاح</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.map((s) => {
                    const st = stockBySub[s.id] || 0;
                    const rv = reservedForSub(s.id);
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name_ar}</TableCell>
                        <TableCell>{fmt(st)} {unit}</TableCell>
                        <TableCell>{fmt(rv)} {unit}</TableCell>
                        <TableCell className={st - rv < 0 ? "text-destructive" : ""}>
                          {fmt(st - rv)} {unit}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell>الإجمالي (المخزن الرئيسي)</TableCell>
                    <TableCell>{fmt(mainActual)} {unit}</TableCell>
                    <TableCell>{fmt(mainReserved)} {unit}</TableCell>
                    <TableCell>{fmt(mainActual - mainReserved)} {unit}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {Math.abs(subTotal - mainActual) > 0.01 && (
              <div className="text-xs text-amber-600 mb-2">
                ملاحظة: إجمالي التوزيع الفرعي ({fmt(subTotal)}) لا يساوي إجمالي المخزن الرئيسي ({fmt(mainActual)}).
                يتم توزيع الأرصدة الجديدة تلقائيًا داخل "الفريزرات" — يمكنك استخدام النقل الداخلي لإعادة التوزيع.
              </div>
            )}

            <div className="border rounded-md p-3 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-sm">
                <ArrowLeftRight className="w-4 h-4" /> نقل داخلي
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">من:</label>
                  <Select value={fromSub} onValueChange={setFromSub}>
                    <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                    <SelectContent>
                      {subs.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name_ar}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">إلى:</label>
                  <Select value={toSub} onValueChange={setToSub}>
                    <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                    <SelectContent>
                      {subs.map((s) => (
                        <SelectItem key={s.id} value={s.id} disabled={s.id === fromSub}>{s.name_ar}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    الكمية {fromSub ? `(المتاح: ${fmt(stockBySub[fromSub] || 0)} ${unit})` : ""}
                  </label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.001"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="flex items-end">
                  <Button className="w-full" disabled={!canTransfer || busy} onClick={submitTransfer}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <ArrowLeftRight className="w-4 h-4 ml-1" />}
                    تنفيذ النقل
                  </Button>
                </div>
              </div>
              {qty && Number(qty) > (stockBySub[fromSub] || 0) && (
                <div className="text-xs text-destructive">الكمية المطلوبة أكبر من المتاح في المكان.</div>
              )}
            </div>

            <div className="mt-4">
              <div className="text-sm font-semibold mb-2">سجل الحركات الداخلية <Badge variant="outline">{moves.length}</Badge></div>
              {moves.length === 0 ? (
                <div className="text-xs text-muted-foreground">لا توجد حركات سابقة.</div>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>التاريخ</TableHead>
                        <TableHead>من</TableHead>
                        <TableHead>إلى</TableHead>
                        <TableHead>الكمية</TableHead>
                        <TableHead>المستخدم</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {moves.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="text-xs whitespace-nowrap">{formatDateTime(m.created_at)}</TableCell>
                          <TableCell>{subName(m.from_sublocation_id)}</TableCell>
                          <TableCell>{subName(m.to_sublocation_id)}</TableCell>
                          <TableCell>{fmt(Number(m.qty))} {unit}</TableCell>
                          <TableCell className="text-xs">{m.created_by ? (userNames[m.created_by] || "—") : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
