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

  useEffect(() => {
    if (!open) return;
    setItems(
      initialItems.map((it) => ({
        id: it.id,
        product_id: it.product_id ?? null,
        product_name: it.product_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
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

  const updateItem = (idx: number, patch: Partial<EditableItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handleProductChange = (idx: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    updateItem(idx, {
      product_id: p.id,
      product_name: p.name,
      unit_price: items[idx].unit_price || Number(p.price),
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

  const handleSave = async () => {
    // Validate
    for (const it of items) {
      if (it._deleted) continue;
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
      // Deletes
      const toDelete = items.filter((it) => it.id && it._deleted).map((it) => it.id!);
      if (toDelete.length) {
        const { error } = await supabase.from("order_items").delete().in("id", toDelete);
        if (error) throw error;
      }

      // Updates (existing not deleted, with changes)
      const toUpdate = items.filter(
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
      const toInsert = items
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

      // Always recompute subtotal & total from the final items list,
      // so changes to quantities/prices/items reflect on the order header.
      const { data: ord, error: oerr } = await supabase
        .from("orders")
        .select("delivery_fee")
        .eq("id", orderId)
        .single();
      if (oerr) throw oerr;
      const hasOffer = initialItems.some((it) => it.offer_name);
      const finalSubtotal = items
        .filter((it) => !it._deleted)
        .reduce((s, it) => s + Number(it.quantity) * Number(it.unit_price), 0);
      const newTotal =
        finalSubtotal -
        Number(discount || 0) +
        (hasOffer ? Number(ord.delivery_fee || 0) : 0);
      const { error: uerr } = await supabase
        .from("orders")
        .update({
          subtotal: finalSubtotal,
          discount: Number(discount) || 0,
          total: newTotal,
        })
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

  const visibleItems = items.filter((it) => !it._deleted);
  const newSubtotal = visibleItems.reduce(
    (sum, it) => sum + Number(it.quantity) * Number(it.unit_price),
    0
  );
  const newTotalPreview = newSubtotal - Number(discount || 0);

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
                  <label className="text-xs text-muted-foreground">المنتج</label>
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
                  <label className="text-xs text-muted-foreground">الكمية</label>
                  <Input
                    type="number"
                    min={1}
                    value={it.quantity}
                    onChange={(e) => updateItem(realIdx, { quantity: Number(e.target.value) })}
                  />
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
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">المجموع الفرعي الجديد</span>
              <span className="text-lg font-bold">
                {newSubtotal.toLocaleString()} ج.م
              </span>
            </div>

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

            {Number(initialDeliveryFee) > 0 && (
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
