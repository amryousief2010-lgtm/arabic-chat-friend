import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, RefreshCw, ArrowUpRight, ArrowDownLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Props {
  warehouseName: string; // exact warehouse name in DB
  pageTitle: string;
  pageSubtitle: string;
}

interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  stock: number;
  product_id: string | null;
}

interface Movement {
  id: string;
  performed_at: string;
  movement_type: string;
  quantity: number;
  notes: string | null;
  party: string | null;
  item_id: string;
  item_name?: string;
}

const MAIN_WAREHOUSE_NAME_HINTS = ["الرئيسي", "المقر"];

export default function CustomerWarehouseView({ warehouseName, pageTitle, pageSubtitle }: Props) {
  const { user, isGeneralManager, isExecutiveManager } = useAuth();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [whId, setWhId] = useState<string | null>(null);
  const [mainWhId, setMainWhId] = useState<string | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [mainItems, setMainItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);

  // dialog state
  const [openDialog, setOpenDialog] = useState<null | "supply" | "return">(null);
  const [selectedProductName, setSelectedProductName] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data: whs } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("is_active", true);
      const target = (whs || []).find((w: any) => w.name === warehouseName);
      const main = (whs || []).find((w: any) =>
        MAIN_WAREHOUSE_NAME_HINTS.some((h) => w.name?.includes(h))
      );
      const targetId = target?.id ?? null;
      const mainId = main?.id ?? null;
      setWhId(targetId);
      setMainWhId(mainId);

      if (targetId) {
        const [itemsRes, movRes] = await Promise.all([
          supabase
            .from("inventory_items")
            .select("id, name, unit, stock, product_id")
            .eq("warehouse_id", targetId)
            .eq("is_active", true)
            .order("name"),
          supabase
            .from("inventory_movements")
            .select("id, performed_at, movement_type, quantity, notes, party, item_id")
            .eq("warehouse_id", targetId)
            .order("performed_at", { ascending: false })
            .limit(200),
        ]);
        const its = (itemsRes.data || []) as InventoryItem[];
        setItems(its);
        const movs = (movRes.data || []) as Movement[];
        const nameMap = new Map(its.map((i) => [i.id, i.name]));
        setMovements(movs.map((m) => ({ ...m, item_name: nameMap.get(m.item_id) || "—" })));
      }

      if (mainId) {
        const { data: mItems } = await supabase
          .from("inventory_items")
          .select("id, name, unit, stock, product_id")
          .eq("warehouse_id", mainId)
          .eq("is_active", true)
          .order("name");
        setMainItems((mItems || []) as InventoryItem[]);
      }
    } catch (e: any) {
      toast.error("تعذّر تحميل بيانات المخزن: " + (e?.message || ""));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseName]);

  const filteredItems = useMemo(() => {
    const q = search.trim();
    if (!q) return items;
    return items.filter((i) => i.name.includes(q));
  }, [items, search]);

  // For supply: pick from main items. For return: pick from this warehouse's items.
  const pickList = openDialog === "supply" ? mainItems : items;

  const resetDialog = () => {
    setSelectedProductName("");
    setQty("");
    setNotes("");
  };

  const submit = async () => {
    if (!openDialog) return;
    const qtyNum = Number(qty);
    if (!selectedProductName || !qtyNum || qtyNum <= 0) {
      toast.error("اختر المنتج وادخل كمية صحيحة");
      return;
    }
    if (!whId || !mainWhId) {
      toast.error("لم يتم تحديد المخزن الرئيسي أو مخزن العميل");
      return;
    }
    setSubmitting(true);
    try {
      const sourceWh = openDialog === "supply" ? mainWhId : whId;
      const destWh = openDialog === "supply" ? whId : mainWhId;
      const sourcePool = openDialog === "supply" ? mainItems : items;
      const destPool = openDialog === "supply" ? items : mainItems;
      const sourceItem = sourcePool.find((i) => i.name === selectedProductName);
      if (!sourceItem) {
        toast.error("المنتج غير موجود في مخزن المصدر");
        setSubmitting(false);
        return;
      }
      if (Number(sourceItem.stock) < qtyNum) {
        toast.error(`الكمية المتاحة (${sourceItem.stock}) أقل من المطلوب`);
        setSubmitting(false);
        return;
      }

      // Ensure destination inventory_items row exists
      let destItem = destPool.find((i) => i.name === selectedProductName);
      if (!destItem) {
        const { data: newRow, error: insErr } = await supabase
          .from("inventory_items")
          .insert({
            warehouse_id: destWh,
            name: selectedProductName,
            unit: sourceItem.unit,
            stock: 0,
            product_id: sourceItem.product_id,
          })
          .select("id, name, unit, stock, product_id")
          .single();
        if (insErr || !newRow) throw insErr || new Error("تعذّر إنشاء صنف الوجهة");
        destItem = newRow as InventoryItem;
      }

      // Decrement source
      const { error: decErr } = await supabase
        .from("inventory_items")
        .update({ stock: Number(sourceItem.stock) - qtyNum })
        .eq("id", sourceItem.id);
      if (decErr) throw decErr;

      // Increment destination
      const { error: incErr } = await supabase
        .from("inventory_items")
        .update({ stock: Number(destItem.stock) + qtyNum })
        .eq("id", destItem.id);
      if (incErr) throw incErr;

      // Log two movements (out from source, in to destination)
      const refType = openDialog === "supply" ? "customer_supply" : "customer_return";
      const partyLabel = warehouseName;
      const baseNote = notes || (openDialog === "supply" ? "توريد إلى عميل" : "مرتجع من عميل");
      const movRows = [
        {
          item_id: sourceItem.id,
          warehouse_id: sourceWh,
          destination_warehouse_id: destWh,
          source_warehouse_id: sourceWh,
          movement_type: "out",
          quantity: qtyNum,
          notes: baseNote,
          party: partyLabel,
          reference_type: refType,
          performed_by: user?.id ?? null,
          product_id: sourceItem.product_id,
        },
        {
          item_id: destItem.id,
          warehouse_id: destWh,
          source_warehouse_id: sourceWh,
          destination_warehouse_id: destWh,
          movement_type: "in",
          quantity: qtyNum,
          notes: baseNote,
          party: partyLabel,
          reference_type: refType,
          performed_by: user?.id ?? null,
          product_id: sourceItem.product_id,
        },
      ];
      const { error: movErr } = await supabase.from("inventory_movements").insert(movRows);
      if (movErr) throw movErr;

      toast.success(openDialog === "supply" ? "تم تسجيل التوريد بنجاح" : "تم تسجيل المرتجع بنجاح");
      setOpenDialog(null);
      resetDialog();
      await fetchAll();
    } catch (e: any) {
      toast.error("فشل العملية: " + (e?.message || ""));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <Header title={pageTitle} subtitle={pageSubtitle} />
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="بحث باسم المنتج..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
          <Button variant="outline" onClick={fetchAll} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ml-2 ${loading ? "animate-spin" : ""}`} />
            تحديث
          </Button>
          <Dialog open={openDialog === "supply"} onOpenChange={(o) => { setOpenDialog(o ? "supply" : null); if (!o) resetDialog(); }}>
            <DialogTrigger asChild>
              <Button className="gap-2"><ArrowUpRight className="w-4 h-4" /> توريد جديد</Button>
            </DialogTrigger>
          </Dialog>
          <Dialog open={openDialog === "return"} onOpenChange={(o) => { setOpenDialog(o ? "return" : null); if (!o) resetDialog(); }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2"><ArrowDownLeft className="w-4 h-4" /> تسجيل مرتجع</Button>
            </DialogTrigger>
          </Dialog>
        </div>

        <Tabs defaultValue="stock" className="w-full">
          <TabsList>
            <TabsTrigger value="stock">الرصيد الحالي</TabsTrigger>
            <TabsTrigger value="movements">سجل التوريد والمرتجع</TabsTrigger>
          </TabsList>

          <TabsContent value="stock">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">المنتجات في {warehouseName}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المنتج</TableHead>
                      <TableHead>الوحدة</TableHead>
                      <TableHead className="text-left">الرصيد</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.length === 0 ? (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">
                        {loading ? "جاري التحميل..." : "لا توجد منتجات بعد. ابدأ بتسجيل أول توريد."}
                      </TableCell></TableRow>
                    ) : filteredItems.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>{it.name}</TableCell>
                        <TableCell>{it.unit}</TableCell>
                        <TableCell className="text-left font-semibold">{Number(it.stock).toLocaleString("ar-EG")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="movements">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">آخر 200 حركة</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>المنتج</TableHead>
                      <TableHead className="text-left">الكمية</TableHead>
                      <TableHead>ملاحظات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                    ) : movements.map((m) => {
                      const isIn = m.movement_type === "transfer_in";
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="text-xs">{new Date(m.performed_at).toLocaleString("ar-EG")}</TableCell>
                          <TableCell>
                            <Badge variant={isIn ? "default" : "secondary"}>
                              {isIn ? "توريد (دخول)" : "مرتجع (خروج)"}
                            </Badge>
                          </TableCell>
                          <TableCell>{m.item_name}</TableCell>
                          <TableCell className="text-left font-semibold">{Number(m.quantity).toLocaleString("ar-EG")}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{m.notes || "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Shared dialog content rendered once based on state */}
      <Dialog open={!!openDialog} onOpenChange={(o) => { if (!o) { setOpenDialog(null); resetDialog(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {openDialog === "supply" ? `توريد جديد إلى ${warehouseName}` : `تسجيل مرتجع من ${warehouseName}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">المنتج</label>
              <Select value={selectedProductName} onValueChange={setSelectedProductName}>
                <SelectTrigger><SelectValue placeholder="اختر منتجاً" /></SelectTrigger>
                <SelectContent>
                  {pickList.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      {openDialog === "supply" ? "المخزن الرئيسي فارغ" : "لا توجد منتجات في هذا المخزن"}
                    </div>
                  ) : pickList.map((i) => (
                    <SelectItem key={i.id} value={i.name}>
                      {i.name} — متاح: {Number(i.stock).toLocaleString("ar-EG")} {i.unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">الكمية</label>
              <Input type="number" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">ملاحظات (اختياري)</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpenDialog(null); resetDialog(); }}>إلغاء</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              تأكيد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
