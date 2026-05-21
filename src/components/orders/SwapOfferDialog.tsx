import { useEffect, useMemo, useState } from "react";
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
import { Trash2, Plus, Gift, PackageOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

interface CurrentOfferGroup {
  name: string;
  itemIds: string[];
  total: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  currentItems: Array<{
    id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    offer_name?: string | null;
  }>;
  onSaved: () => void;
}

const genKey = () => Math.random().toString(36).slice(2);

const SwapOfferDialog = ({ open, onOpenChange, orderId, currentItems, onSaved }: Props) => {
  const [offers, setOffers] = useState<OfferBox[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedRemoveOffer, setSelectedRemoveOffer] = useState<string>("");
  const [selectedNewOfferId, setSelectedNewOfferId] = useState<string>("");
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);

  const offerGroups: CurrentOfferGroup[] = useMemo(() => {
    const map = new Map<string, CurrentOfferGroup>();
    currentItems.forEach((it) => {
      if (!it.offer_name) return;
      const g = map.get(it.offer_name) || { name: it.offer_name, itemIds: [], total: 0 };
      g.itemIds.push(it.id);
      g.total += Number(it.total_price);
      map.set(it.offer_name, g);
    });
    return Array.from(map.values());
  }, [currentItems]);

  useEffect(() => {
    if (!open) return;
    setSelectedRemoveOffer(offerGroups[0]?.name || "");
    setSelectedNewOfferId("");
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

  const loadNewOfferPreview = async (offerId: string) => {
    setSelectedNewOfferId(offerId);
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

      // Include the offer's shipping inside the items so the offer total
      // matches offer_price (shipping baked in, delivery_fee=0 on save).
      const offer = offers.find((o) => o.id === offerId);
      const targetTotal = Number(offer?.offer_price || 0);
      const baseSubtotal = items.reduce(
        (s, it) => s + (it.is_gift ? 0 : Number(it.quantity) * Number(it.custom_price)),
        0
      );
      if (targetTotal > 0 && baseSubtotal > 0 && Math.abs(targetTotal - baseSubtotal) > 0.005) {
        const factor = targetTotal / baseSubtotal;
        const nonGiftIdx: number[] = [];
        items.forEach((it, i) => { if (!it.is_gift && it.quantity > 0) nonGiftIdx.push(i); });
        let running = 0;
        nonGiftIdx.forEach((i, k) => {
          const it = items[i];
          if (k < nonGiftIdx.length - 1) {
            const newUnit = +(Number(it.custom_price) * factor).toFixed(2);
            it.custom_price = newUnit;
            running += newUnit * Number(it.quantity);
          } else {
            // last item absorbs rounding remainder
            const remaining = targetTotal - running;
            it.custom_price = +(remaining / Number(it.quantity)).toFixed(2);
          }
        });
      }
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
    // Always refresh unit price from the newly-selected product, so swapping
    // a product multiple times keeps the price in sync with the latest choice.
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

  const selectedNewOffer = offers.find((o) => o.id === selectedNewOfferId) || null;

  const handleSave = async () => {
    if (!selectedRemoveOffer) {
      toast.error("اختر العرض المراد حذفه");
      return;
    }
    if (!selectedNewOfferId || !selectedNewOffer) {
      toast.error("اختر العرض الجديد");
      return;
    }
    if (previewItems.length === 0) {
      toast.error("لا توجد منتجات في العرض الجديد");
      return;
    }
    const group = offerGroups.find((g) => g.name === selectedRemoveOffer);
    if (!group) {
      toast.error("لم يتم العثور على العرض المحدد");
      return;
    }

    setSaving(true);
    try {
      // 1) Delete current offer items
      const { error: delErr } = await supabase
        .from("order_items")
        .delete()
        .in("id", group.itemIds);
      if (delErr) throw delErr;

      // 2) Insert new offer items
      const toInsert = previewItems
        .filter((it) => it.product_id)
        .map((it) => ({
          order_id: orderId,
          product_id: it.product_id,
          product_name: it.product?.name || "",
          quantity: it.quantity,
          unit_price: it.custom_price,
          total_price: Number(it.quantity) * Number(it.custom_price),
          offer_name: selectedNewOffer.name,
        }));
      const { error: insErr } = await supabase.from("order_items").insert(toInsert);
      if (insErr) throw insErr;

      // 3) Shipping is now baked into the offer item prices so the items
      //    subtotal already equals offer_price. Zero out delivery_fee.
      const { error: updErr } = await supabase
        .from("orders")
        .update({ delivery_fee: 0 })
        .eq("id", orderId);
      if (updErr) throw updErr;

      toast.success(`تم استبدال العرض "${selectedRemoveOffer}" بـ "${selectedNewOffer.name}"`);
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "حدث خطأ أثناء استبدال العرض");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="w-5 h-5 text-primary" />
            استبدال عرض بعرض آخر
          </DialogTitle>
        </DialogHeader>

        {offerGroups.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            لا يحتوي هذا الطلب على أي عرض حالياً لاستبداله.
          </div>
        ) : (
          <div className="space-y-5">
            {/* Step 1: pick offer to remove */}
            <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
              <label className="text-sm font-medium">العرض المراد حذفه من الطلب</label>
              <Select value={selectedRemoveOffer} onValueChange={setSelectedRemoveOffer}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر العرض" />
                </SelectTrigger>
                <SelectContent>
                  {offerGroups.map((g) => (
                    <SelectItem key={g.name} value={g.name}>
                      {g.name} — {g.total.toLocaleString()} ج.م ({g.itemIds.length} منتج)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Step 2: pick new offer */}
            <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
              <label className="text-sm font-medium">العرض الجديد</label>
              <Select value={selectedNewOfferId} onValueChange={loadNewOfferPreview} disabled={loading}>
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
              {selectedNewOffer?.description && (
                <p className="text-xs text-muted-foreground">{selectedNewOffer.description}</p>
              )}
            </div>

            {/* Preview / edit new offer items */}
            {selectedNewOfferId && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">منتجات العرض الجديد</h4>
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
                    <span className="text-muted-foreground">إجمالي العرض الجديد (شامل الشحن)</span>
                    <span className="font-bold">{newSubtotal.toLocaleString()} ج.م</span>
                  </div>
                  {Number(selectedNewOffer?.shipping_cost || 0) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      تم تضمين شحن العرض ({Number(selectedNewOffer?.shipping_cost || 0).toLocaleString()} ج.م) داخل أسعار المنتجات.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !selectedNewOfferId || offerGroups.length === 0}
          >
            {saving ? "جاري الاستبدال..." : "تأكيد الاستبدال"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SwapOfferDialog;
