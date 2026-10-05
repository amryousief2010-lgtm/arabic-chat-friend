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
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Gift, PackagePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { writeOrderTotalsPreservingShipping } from "@/lib/preserveOrderShipping";
import { isOfferShippingLine } from "@/lib/orderTotals";
import { includedShippingForInstances, instancesAfterAddingBox } from "@/lib/offerBoxOrder";

interface OfferBox {
  id: string;
  name: string;
  description?: string | null;
  offer_price?: number | null;
  shipping_cost?: number | null;
}

interface Product {
  id: string;
  name: string;
  price: number;
}

interface PreviewItem {
  key: string;
  product_id: string;
  product: Product | null;
  quantity: number;
  custom_price: number;
  is_gift: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  onSaved: () => void;
}

const genKey = () => Math.random().toString(36).slice(2);

const AddOfferDialog = ({ open, onOpenChange, orderId, onSaved }: Props) => {
  const [offers, setOffers] = useState<OfferBox[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<string>("");
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);

  useEffect(() => {
    if (!open) return;
    setSelectedOfferId("");
    setPreviewItems([]);
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [offersRes, productsRes] = await Promise.all([
        supabase.from("offer_boxes").select("*").eq("is_active", true),
        supabase.from("products").select("id, name, price").eq("is_active", true).order("name"),
      ]);
      if (offersRes.error) throw offersRes.error;
      if (productsRes.error) throw productsRes.error;

      const now = new Date();
      const active = (offersRes.data || []).filter((o: any) => {
        if (o.expires_at && new Date(o.expires_at) <= now) return false;
        if (o.starts_at && new Date(o.starts_at) > now) return false;
        return true;
      });
      setOffers(active as OfferBox[]);
      setProducts((productsRes.data || []) as Product[]);
    } catch (e: any) {
      toast.error(e.message || "فشل تحميل العروض");
    } finally {
      setLoading(false);
    }
  };

  const loadOfferPreview = async (offerId: string) => {
    setSelectedOfferId(offerId);
    if (!offerId) {
      setPreviewItems([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("offer_box_items")
        .select("*")
        .eq("offer_box_id", offerId);
      if (error) throw error;
      const items: PreviewItem[] = (data || []).map((it: any) => {
        const product = products.find((p) => p.id === it.product_id) || null;
        return {
          key: genKey(),
          product_id: it.product_id,
          product,
          quantity: Number(it.quantity) || 1,
          custom_price: it.is_gift ? 0 : Number(it.custom_price) || 0,
          is_gift: !!it.is_gift,
        };
      });
      setPreviewItems(items);
    } catch (e: any) {
      toast.error(e.message || "فشل تحميل تفاصيل العرض");
    }
  };

  const updateItem = (key: string, patch: Partial<PreviewItem>) => {
    setPreviewItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  };

  const swapProduct = (key: string, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const cur = previewItems.find((i) => i.key === key);
    updateItem(key, {
      product_id: productId,
      product,
      custom_price: cur?.is_gift ? 0 : (Number(product.price) || 0),
    });
  };

  const addItem = (asGift = false) => {
    const first = products[0];
    if (!first) {
      toast.error("لا توجد منتجات متاحة");
      return;
    }
    setPreviewItems((prev) => [
      ...prev,
      {
        key: genKey(),
        product_id: first.id,
        product: first,
        quantity: 1,
        custom_price: asGift ? 0 : Number(first.price) || 0,
        is_gift: asGift,
      },
    ]);
  };

  const removeItem = (key: string) => {
    setPreviewItems((prev) => prev.filter((it) => it.key !== key));
  };

  const newSubtotal = previewItems.reduce(
    (s, it) => s + Number(it.quantity) * Number(it.custom_price),
    0
  );

  const selectedOffer = offers.find((o) => o.id === selectedOfferId) || null;

  const handleSave = async () => {
    if (!selectedOfferId || !selectedOffer) {
      toast.error("اختر العرض");
      return;
    }
    if (previewItems.length === 0) {
      toast.error("لا توجد منتجات في العرض");
      return;
    }

    setSaving(true);
    try {
      const [
        { data: header, error: headerErr },
        { data: currentInstances, error: instErr },
        { data: existingItems, error: itemsReadErr },
      ] = await Promise.all([
        supabase.from("orders").select("discount, delivery_fee, extra_charge").eq("id", orderId).single(),
        supabase.from("order_offer_instances").select("offer_name, quantity, offer_box_id").eq("order_id", orderId),
        supabase
          .from("order_items")
          .select("offer_name, product_id, product_name, quantity, unit_price")
          .eq("order_id", orderId),
      ]);
      if (headerErr) throw headerErr;
      if (instErr) throw instErr;
      if (itemsReadErr) throw itemsReadErr;

      const hadLines = (existingItems || []).some((it) => {
        if (it.offer_name !== selectedOffer.name) return false;
        return !isOfferShippingLine({
          product_id: it.product_id,
          product_name: it.product_name,
          offer_name: it.offer_name,
          quantity: Number(it.quantity || 0),
          unit_price: Number(it.unit_price || 0),
        });
      });
      const nextInstances = instancesAfterAddingBox(
        (currentInstances || []).map((row) => ({
          offer_name: row.offer_name,
          quantity: Number(row.quantity || 0),
          offer_box_id: row.offer_box_id,
        })),
        { offer_name: selectedOffer.name, offer_box_id: selectedOfferId },
        { priorProductLines: hadLines },
      );

      const toInsert: any[] = previewItems
        .filter((it) => it.product_id)
        .map((it) => ({
          order_id: orderId,
          product_id: it.product_id,
          product_name: it.product?.name || "",
          quantity: it.quantity,
          unit_price: it.custom_price,
          total_price: Number(it.quantity) * Number(it.custom_price),
          offer_name: selectedOffer.name,
        }));

      const { error: insErr } = await supabase.from("order_items").insert(toInsert);
      if (insErr) throw insErr;

      const names = [...new Set(nextInstances.map((row) => row.offer_name))];
      const { data: boxRows, error: boxErr } = await supabase
        .from("offer_boxes")
        .select("name, shipping_cost")
        .in("name", names);
      if (boxErr) throw boxErr;
      const shippingByName: Record<string, number | null> = {};
      for (const box of boxRows || []) shippingByName[box.name] = box.shipping_cost;
      shippingByName[selectedOffer.name] = selectedOffer.shipping_cost ?? null;
      const includedFee = includedShippingForInstances(nextInstances, shippingByName);

      const { error: setErr } = await supabase.rpc("set_order_offer_instances", {
        p_order_id: orderId,
        p_instances: nextInstances.map((row) => ({
          offer_name: row.offer_name,
          quantity: row.quantity,
          offer_box_id: row.offer_box_id,
        })),
      });
      if (setErr) throw setErr;

      await writeOrderTotalsPreservingShipping(orderId, {
        discount: Number(header.discount || 0),
        deliveryFee: includedFee,
        extraCharge: Number(header.extra_charge || 0),
        shippingEdited: true,
      });

      toast.success(`تم إضافة العرض "${selectedOffer.name}" إلى الطلب`);
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "حدث خطأ أثناء إضافة العرض");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="w-5 h-5 text-primary" />
            إضافة بوكس / عرض إلى الطلب
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
            <label className="text-sm font-medium">اختر البوكس / العرض</label>
            <Select value={selectedOfferId} onValueChange={loadOfferPreview} disabled={loading}>
              <SelectTrigger>
                <SelectValue placeholder={loading ? "جاري التحميل..." : "اختر عرض"} />
              </SelectTrigger>
              <SelectContent>
                {offers.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                    {o.offer_price ? ` — ${Number(o.offer_price).toLocaleString()} ج.م` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedOffer?.description && (
              <p className="text-xs text-muted-foreground">{selectedOffer.description}</p>
            )}
          </div>

          {selectedOfferId && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">منتجات العرض</h4>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => addItem(false)}>
                    <Plus className="w-4 h-4 ml-1" /> منتج
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => addItem(true)}>
                    <Gift className="w-4 h-4 ml-1" /> هدية
                  </Button>
                </div>
              </div>

              {previewItems.map((it) => (
                <div
                  key={it.key}
                  className="grid grid-cols-12 gap-2 items-end p-3 rounded-lg border bg-muted/30"
                >
                  <div className="col-span-12 md:col-span-5">
                    <label className="text-xs text-muted-foreground">المنتج</label>
                    <Select value={it.product_id} onValueChange={(v) => swapProduct(it.key, v)}>
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
                      onChange={(e) => updateItem(it.key, { quantity: Number(e.target.value) })}
                    />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <label className="text-xs text-muted-foreground">سعر الوحدة</label>
                    <Input
                      type="number"
                      min={0}
                      disabled={it.is_gift}
                      value={it.custom_price}
                      onChange={(e) =>
                        updateItem(it.key, { custom_price: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="col-span-3 md:col-span-2 text-sm font-semibold">
                    {it.is_gift ? (
                      <Badge variant="secondary" className="gap-1">
                        <Gift className="w-3 h-3" /> هدية
                      </Badge>
                    ) : (
                      `${(Number(it.quantity) * Number(it.custom_price)).toLocaleString()} ج.م`
                    )}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeItem(it.key)}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}

              <div className="pt-2 border-t space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">إجمالي منتجات العرض</span>
                  <span className="font-bold">{newSubtotal.toLocaleString()} ج.م</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  شحن البوكس داخل سعره. بعد الإضافة يُعاد حساب الشحن من البوكسات الموجودة ولا يُضاف فوق سعر البوكس.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving || !selectedOfferId}>
            {saving ? "جاري الإضافة..." : "إضافة العرض"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddOfferDialog;
