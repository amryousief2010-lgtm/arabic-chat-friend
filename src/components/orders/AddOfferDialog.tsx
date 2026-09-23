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
      const { data: header, error: headerErr } = await supabase
        .from("orders")
        .select("discount, delivery_fee, extra_charge")
        .eq("id", orderId)
        .single();
      if (headerErr) throw headerErr;
      const savedShipping = Number(header.delivery_fee || 0);

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

      // الشحن حقل على رأس الطلب. لا نُدخل سطر «تكلفة الشحن» ولا نُعيد حسابه
      // من shipping_cost بتاع البوكس. أسعار مكونات العرض تُنسخ كما هي.
      const { error: insErr } = await supabase.from("order_items").insert(toInsert);
      if (insErr) throw insErr;

      // Keep the box identity/count record in sync with the order contents.
      const { data: remainingItems } = await supabase
        .from("order_items")
        .select("offer_name")
        .eq("order_id", orderId);
      const remainingOfferNames = new Set(
        (remainingItems || []).map((r: any) => r.offer_name).filter(Boolean) as string[]
      );
      remainingOfferNames.add(selectedOffer.name);

      const { data: currentInstances } = await supabase
        .from("order_offer_instances")
        .select("id, offer_name, quantity, offer_box_id")
        .eq("order_id", orderId);
      const staleIds = (currentInstances || [])
        .filter((r: any) => !remainingOfferNames.has(r.offer_name))
        .map((r: any) => r.id);
      if (staleIds.length > 0) {
        await supabase.from("order_offer_instances").delete().in("id", staleIds);
      }

      const existing = (currentInstances || []).find(
        (r: any) => r.offer_name === selectedOffer.name || r.offer_box_id === selectedOfferId
      );
      if (existing) {
        await supabase
          .from("order_offer_instances")
          .update({ quantity: Number(existing.quantity || 0) + 1 })
          .eq("id", existing.id);
      } else {
        await supabase.from("order_offer_instances").insert({
          order_id: orderId,
          offer_box_id: selectedOfferId,
          offer_name: selectedOffer.name,
          quantity: 1,
        });
      }

      await writeOrderTotalsPreservingShipping(orderId, {
        discount: Number(header.discount || 0),
        deliveryFee: savedShipping,
        extraCharge: Number(header.extra_charge || 0),
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
                  شحن الطلب الحالي لا يتغير عند إضافة البوكس. لتعديله استخدمي خانة الشحن في تعديل الطلب.
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
