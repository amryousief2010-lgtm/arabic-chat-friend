import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { computeOrderTotals, isOfferShippingLine } from "@/lib/orderTotals";
import { getOfferUnitPriceForReplacement, getOfferPriceGroup, type OfferPriceGroup } from "@/lib/offerPriceGroups";

interface Product {
  id: string;
  name: string;
  price: number;
  unit: string;
}

interface EditableItem {
  id?: string; // undefined = new item
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  offer_name?: string | null;
  is_half_kg?: boolean;
  is_gift?: boolean;
  _deleted?: boolean;
  _original?: { product_id: string | null; quantity: number; unit_price: number };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  initialItems: Array<{
    id: string;
    product_id?: string | null;
    product_name: string;
    quantity: number;
    unit_price: number;
    offer_name?: string | null;
    is_half_kg?: boolean;
  }>;
  initialDiscount?: number;
  initialDeliveryFee?: number;
  onSaved: () => void;
}

const EditOrderItemsDialog = ({ open, onOpenChange, orderId, initialItems, initialDiscount = 0, initialDeliveryFee = 0, onSaved }: Props) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [discount, setDiscount] = useState<number>(0);
  const [originalDiscount, setOriginalDiscount] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  // offer_name -> (group -> unit price) derived from offer_boxes
  const [offerGroupPrices, setOfferGroupPrices] = useState<
    Record<string, Partial<Record<OfferPriceGroup, number>>>
  >({});

  useEffect(() => {
    if (!open) return;
    setItems(
      initialItems.map((it) => ({
        id: it.id,
        product_id: it.product_id ?? null,
        product_name: it.product_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
        offer_name: it.offer_name ?? null,
        is_half_kg: !!it.is_half_kg,
        _original: {
          product_id: it.product_id ?? null,
          quantity: it.quantity,
          unit_price: it.unit_price,
        },
      }))
    );
    setDiscount(Number(initialDiscount) || 0);
    setOriginalDiscount(Number(initialDiscount) || 0);
    fetchProducts();
    fetchOfferGroupPrices(initialItems);
    // Only reset on dialog open transition — don't overwrite user edits
    // when parent re-renders due to tab switch / background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fetchProducts = async () => {
    const { data, error } = await supabase
      .from("products")
      .select("id, name, price, unit")
      .eq("is_active", true)
      .order("name");
    if (!error && data) setProducts(data as Product[]);
  };

  // For every offer referenced by the order, fetch its box items and build a
  // map of price-group → unit price. Used as a fallback when the user swaps
  // a product into a DIFFERENT price group than the original.
  const fetchOfferGroupPrices = async (
    src: Props["initialItems"]
  ) => {
    const offerNames = Array.from(
      new Set((src || []).map((it) => it.offer_name).filter((x): x is string => !!x))
    );
    if (offerNames.length === 0) {
      setOfferGroupPrices({});
      return;
    }
    const { data, error } = await supabase
      .from("offer_boxes")
      .select("name, offer_box_items(custom_price, is_gift, products(name))")
      .in("name", offerNames);
    if (error || !data) return;
    const map: Record<string, Partial<Record<OfferPriceGroup, number>>> = {};
    for (const box of data as any[]) {
      const groupMap: Partial<Record<OfferPriceGroup, number>> = {};
      for (const it of box.offer_box_items || []) {
        if (it.is_gift) continue;
        const g = getOfferPriceGroup(it.products?.name);
        const price = Number(it.custom_price);
        if (g && price > 0 && groupMap[g] == null) groupMap[g] = price;
      }
      map[box.name] = groupMap;
    }
    setOfferGroupPrices(map);
  };

  const updateItem = (idx: number, patch: Partial<EditableItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handleProductChange = (idx: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    const oldItem = items[idx];
    // For offer items, swapping within the same offer price group must keep
    // the offer unit price. When swapping into a DIFFERENT group, use that
    // group's offer price (sibling line first, then offer-box fallback).
    // For normal items, use the catalog price as before.
    const siblings = items.filter(
      (it, i) => i !== idx && !it._deleted && !isOfferShippingLine(it)
    );
    const newGroup = getOfferPriceGroup(p.name);
    const offerName = oldItem.offer_name || "";
    const fallback =
      offerName && newGroup ? offerGroupPrices[offerName]?.[newGroup] ?? null : null;
    const newUnit = getOfferUnitPriceForReplacement(oldItem, p, siblings, fallback);
    updateItem(idx, {
      product_id: p.id,
      product_name: p.name,
      unit_price: oldItem.is_gift ? 0 : Number(newUnit),
    });
  };

  const handleDelete = (idx: number) => {
    const it = items[idx];
    if (!it.id) {
      // New item: just remove from list
      setItems((prev) => prev.filter((_, i) => i !== idx));
    } else {
      updateItem(idx, { _deleted: true });
    }
  };

  const handleAdd = () => {
    setItems((prev) => [
      ...prev,
      { product_id: null, product_name: "", quantity: 1, unit_price: 0 },
    ]);
  };

  const handleAddGift = () => {
    setItems((prev) => [
      ...prev,
      {
        product_id: null,
        product_name: "",
        quantity: 1,
        unit_price: 0,
        is_gift: true,
      },
    ]);
  };

  const handleSave = async () => {
    // Validate (skip synthetic shipping lines — they have no product_id by design)
    for (const it of items) {
      if (it._deleted) continue;
      if (isOfferShippingLine(it)) continue;
      if (!it.product_id) {
        toast.error("اختر المنتج لكل صف");
        return;
      }
      if (!it.quantity || it.quantity <= 0) {
        toast.error("الكمية يجب أن تكون أكبر من صفر");
        return;
      }
      if (it.unit_price < 0) {
        toast.error("السعر غير صالح");
        return;
      }
    }

    setSaving(true);
    try {
      // Compute final totals from the SAME state the UI shows (preview === save).
      const finalTotals = computeOrderTotals(items, {
        discount,
        extraDeliveryFee: initialDeliveryFee,
      });

      // If no real offer item remains, also drop the bundled shipping line.
      let itemsForWrite = items;
      if (!finalTotals.hasOfferItems) {
        itemsForWrite = items.map((it) =>
          isOfferShippingLine(it) && it.id ? { ...it, _deleted: true } : it
        );
      }

      // Deletes
      const toDelete = itemsForWrite
        .filter((it) => it.id && it._deleted)
        .map((it) => it.id!);
      if (toDelete.length) {
        const { error } = await supabase.from("order_items").delete().in("id", toDelete);
        if (error) throw error;
      }

      // Updates (existing not deleted, with changes)
      const toUpdate = itemsForWrite.filter(
        (it) =>
          it.id &&
          !it._deleted &&
          it._original &&
          (it._original.product_id !== it.product_id ||
            Number(it._original.quantity) !== Number(it.quantity) ||
            Number(it._original.unit_price) !== Number(it.unit_price))
      );
      for (const it of toUpdate) {
        const total = Number(it.quantity) * Number(it.unit_price);
        const { error } = await supabase
          .from("order_items")
          .update({
            product_id: it.product_id,
            product_name: it.product_name,
            quantity: it.quantity,
            unit_price: it.unit_price,
            total_price: total,
          })
          .eq("id", it.id!);
        if (error) throw error;
      }

      // Inserts
      const toInsert = itemsForWrite
        .filter((it) => !it.id && !it._deleted)
        .map((it) => ({
          order_id: orderId,
          product_id: it.product_id,
          product_name: it.product_name,
          quantity: it.quantity,
          unit_price: it.unit_price,
          total_price: Number(it.quantity) * Number(it.unit_price),
        }));
      if (toInsert.length) {
        const { error } = await supabase.from("order_items").insert(toInsert);
        if (error) throw error;
      }

      // Always persist totals — UI preview and DB row must agree.
      // For offer orders, the bundled shipping lives inside order_items, so
      // delivery_fee on the order row stays 0 (and is forced to 0 if the
      // last offer item was removed).
      const update: {
        subtotal: number;
        discount: number;
        total: number;
        delivery_fee?: number;
      } = {
        subtotal: finalTotals.subtotal,
        discount: Number(discount) || 0,
        total: finalTotals.total,
      };
      if (finalTotals.hasOfferItems) {
        update.delivery_fee = 0;
      } else if (initialItems.some((it) => it.offer_name)) {
        // We just removed the last offer line → clear any residual delivery fee.
        update.delivery_fee = 0;
      }
      const { error: uerr } = await supabase
        .from("orders")
        .update(update)
        .eq("id", orderId);
      if (uerr) throw uerr;


      toast.success("تم تحديث منتجات الطلب وإعادة حساب المجموع");
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "حدث خطأ أثناء الحفظ");
    } finally {
      setSaving(false);
    }
  };

  // Hide the synthetic offer shipping line from the editable list —
  // it's preserved automatically and shown in the totals breakdown.
  const visibleItems = items.filter(
    (it) => !it._deleted && !isOfferShippingLine(it)
  );
  const previewTotals = computeOrderTotals(items, {
    discount,
    extraDeliveryFee: initialDeliveryFee,
  });
  const newSubtotal = previewTotals.subtotal;
  const hasOfferItems = previewTotals.hasOfferItems;
  const includedShipping = previewTotals.includedShippingCost;
  const newTotalPreview = previewTotals.total;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تعديل منتجات الطلب</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {visibleItems.map((it) => {
            const realIdx = items.indexOf(it);
            return (
              <div
                key={realIdx}
                className="grid grid-cols-12 gap-2 items-end p-3 rounded-lg border bg-muted/30"
              >
                <div className="col-span-12 md:col-span-5">
                  <label className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>المنتج</span>
                    {it.is_half_kg && (
                      <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
                        نصف كيلو (الكمية بالكجم)
                      </span>
                    )}
                    {it.is_gift && (
                      <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-300">
                        🎁 هدية مجانية
                      </span>
                    )}
                  </label>
                  <Select
                    value={it.product_id || ""}
                    onValueChange={(v) => handleProductChange(realIdx, v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر منتج" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-4 md:col-span-2">
                  <label className="text-xs text-muted-foreground">
                    {it.is_half_kg ? "الكمية بالكجم" : "الكمية"}
                  </label>
                  <Input
                    type="number"
                    min={0}
                    step={it.is_half_kg ? 0.5 : "any"}
                    value={it.quantity}
                    onChange={(e) => {
                      updateItem(realIdx, { quantity: Number(e.target.value) });
                    }}
                  />
                  {it.is_half_kg && (
                    <div className="text-[10px] text-primary font-medium mt-1">
                      = {(Number(it.quantity) * 2).toLocaleString()} عبوة نص كيلو
                    </div>
                  )}
                </div>
                <div className="col-span-4 md:col-span-2">
                  <label className="text-xs text-muted-foreground">سعر الوحدة</label>
                  <Input
                    type="number"
                    min={0}
                    value={it.unit_price}
                    onChange={(e) => updateItem(realIdx, { unit_price: Number(e.target.value) })}
                  />
                </div>
                <div className="col-span-3 md:col-span-2 text-sm font-semibold">
                  {(Number(it.quantity) * Number(it.unit_price)).toLocaleString()} ج.م
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(realIdx)}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}

          <Button type="button" variant="outline" onClick={handleAdd} className="w-full">
            <Plus className="w-4 h-4 ml-1" />
            إضافة منتج
          </Button>

          <div className="pt-2 border-t space-y-3">
            {hasOfferItems && (
              <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs p-2">
                هذا الطلب يحتوي على عرض. تكلفة الشحن المضمنة داخل العرض ({includedShipping.toLocaleString()} ج.م) محفوظة تلقائيًا. تعديل أو استبدال أصناف العرض سيُعيد حساب الإجمالي على أساس الأسعار الجديدة.
              </div>
            )}

            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">المجموع الفرعي للأصناف</span>
              <span className="text-lg font-bold">
                {newSubtotal.toLocaleString()} ج.م
              </span>
            </div>

            {hasOfferItems && includedShipping > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">تكلفة الشحن المضمنة بالعرض</span>
                <span>{includedShipping.toLocaleString()} ج.م</span>
              </div>
            )}

            <div className="flex justify-between items-center gap-3">
              <label className="text-muted-foreground whitespace-nowrap">
                الخصم (يُخصم من الإجمالي)
              </label>
              <Input
                type="number"
                min={0}
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value))}
                className="max-w-[160px] text-end"
                placeholder="0"
              />
            </div>

            {!hasOfferItems && Number(initialDeliveryFee) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">رسوم التوصيل</span>
                <span>{Number(initialDeliveryFee).toLocaleString()} ج.م</span>
              </div>
            )}

            {Number(discount) > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>الخصم</span>
                <span>- {Number(discount).toLocaleString()} ج.م</span>
              </div>
            )}

            <div className="flex justify-between items-center pt-2 border-t">
              <span className="font-semibold">الإجمالي بعد الخصم</span>
              <span className="text-xl font-bold text-primary">
                {newTotalPreview.toLocaleString()} ج.م
              </span>
            </div>
          </div>
        </div>


        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "جاري الحفظ..." : "حفظ التغييرات"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditOrderItemsDialog;
