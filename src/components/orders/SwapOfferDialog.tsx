import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  BOX_COPY_OPERATIONS,
  listBoxCopies,
  orderProductSubtotal,
  previewBoxCopyChange,
  type BoxCopyOperation,
  type BoxLine,
  type ListedBoxCopy,
  type OfferInstanceRow,
  type StoredBoxCopy,
} from "@/lib/boxCopies";

interface OfferBox {
  id: string;
  name: string;
  description?: string | null;
  offer_price?: number | null;
  shipping_cost?: number | null;
  is_active?: boolean | null;
  expires_at?: string | null;
  starts_at?: string | null;
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
  currentItems: Array<{
    id: string;
    product_id?: string | null;
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    offer_name?: string | null;
  }>;
  onSaved: () => void;
}

const genKey = () => Math.random().toString(36).slice(2);
const newIdempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

const money = (value: number) => `${Number(value || 0).toLocaleString()} ج.م`;

const SwapOfferDialog = ({
  open,
  onOpenChange,
  orderId,
  currentItems: _currentItems,
  onSaved,
}: Props) => {
  const [offers, setOffers] = useState<OfferBox[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [copies, setCopies] = useState<ListedBoxCopy[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [operation, setOperation] = useState<BoxCopyOperation>("replace_box");
  const [selectedNewOfferId, setSelectedNewOfferId] = useState("");
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [discount, setDiscount] = useState(0);
  const [extraCharge, setExtraCharge] = useState(0);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [subtotal, setSubtotal] = useState(0);
  const [snapshotToken, setSnapshotToken] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());
  const savingRef = useRef(false);

  useEffect(() => {
    idempotencyKey.current = newIdempotencyKey();
  }, [selectedKey, operation, selectedNewOfferId]);

  useEffect(() => {
    if (!open) return;
    setSelectedKey("");
    setOperation("replace_box");
    setSelectedNewOfferId("");
    setPreviewItems([]);
    setProductQuery("");
    setConfirmDelete(false);
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [orderRes, itemsRes, instRes, copiesRes, offersRes, productsRes, tokenRes] = await Promise.all([
        supabase
          .from("orders")
          .select("discount, extra_charge, delivery_fee, total, subtotal")
          .eq("id", orderId)
          .single(),
        supabase
          .from("order_items")
          .select("id, product_id, product_name, quantity, unit_price, total_price, offer_name, offer_copy_id, is_gift, created_at")
          .eq("order_id", orderId),
        supabase
          .from("order_offer_instances")
          .select("id, offer_name, quantity, offer_box_id")
          .eq("order_id", orderId),
        supabase
          .from("order_box_copies")
          .select("id, offer_name, copy_index, offer_box_id, active, legacy_instance_id")
          .eq("order_id", orderId),
        supabase
          .from("offer_boxes")
          .select("id, name, description, offer_price, shipping_cost, is_active, expires_at, starts_at"),
        supabase.from("products").select("id, name, price").eq("is_active", true).order("name"),
        supabase.rpc("order_box_snapshot_token", { p_order_id: orderId }),
      ]);
      if (orderRes.error) throw orderRes.error;
      if (itemsRes.error) throw itemsRes.error;
      if (instRes.error) throw instRes.error;
      if (copiesRes.error) throw copiesRes.error;
      if (offersRes.error) throw offersRes.error;
      if (productsRes.error) throw productsRes.error;
      if (tokenRes.error) throw tokenRes.error;

      const items = (itemsRes.data || []) as BoxLine[];
      const instances = (instRes.data || []) as OfferInstanceRow[];
      const stored = (copiesRes.data || []) as StoredBoxCopy[];
      const listed = listBoxCopies({ instances, copies: stored, items });
      setCopies(listed);
      setSelectedKey(listed[0]?.key || "");
      setSubtotal(orderProductSubtotal(items));
      setDiscount(Number(orderRes.data?.discount || 0));
      setExtraCharge(Number(orderRes.data?.extra_charge || 0));
      setDeliveryFee(Number(orderRes.data?.delivery_fee || 0));
      setSnapshotToken(String(tokenRes.data || ""));
      setOffers((offersRes.data || []) as OfferBox[]);
      setProducts((productsRes.data || []) as Product[]);
    } catch (e: any) {
      toast.error(e.message || "فشل تحميل العروض");
    } finally {
      setLoading(false);
    }
  };

  const shippingByName = useMemo(() => {
    const ranked = [...offers].sort((a, b) => Number(!!b.is_active) - Number(!!a.is_active));
    const map: Record<string, number | null> = {};
    for (const box of ranked) {
      if (!(box.name in map)) map[box.name] = box.shipping_cost ?? null;
    }
    return map;
  }, [offers]);

  const activeOffers = useMemo(() => {
    const now = new Date();
    return offers.filter((offer) => {
      if (offer.is_active === false) return false;
      if (offer.expires_at && new Date(offer.expires_at) <= now) return false;
      if (offer.starts_at && new Date(offer.starts_at) > now) return false;
      return true;
    });
  }, [offers]);

  const selectedCopy = copies.find((copy) => copy.key === selectedKey) || null;
  const selectedNewOffer = offers.find((offer) => offer.id === selectedNewOfferId) || null;

  const replacementLines = previewItems
    .filter((item) => item.product_id && Number(item.quantity) > 0)
    .map((item) => ({
      product_id: item.product_id,
      product_name: item.product?.name || "",
      quantity: Number(item.quantity),
      unit_price: item.is_gift ? 0 : Number(item.custom_price),
    }));

  const preview = useMemo(() => {
    if (!selectedCopy) return null;
    try {
      return previewBoxCopyChange({
        copies,
        targetKey: selectedCopy.key,
        operation,
        replacementLines: operation === "delete" ? [] : replacementLines,
        replacementOfferName: operation === "replace_box" ? selectedNewOffer?.name : null,
        shippingByName,
        subtotal,
        discount,
        extraCharge,
        deliveryFee,
      });
    } catch {
      return null;
    }
    // replacementLines is a new array every render; the values are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    copies,
    selectedCopy,
    operation,
    previewItems,
    selectedNewOffer,
    shippingByName,
    subtotal,
    discount,
    extraCharge,
    deliveryFee,
  ]);

  // Replacement lines start from the offer's saved custom_price. Staff can edit
  // them in this dialog. offer_boxes.offer_price and products.price are not
  // written onto existing copies.
  const loadNewOfferPreview = async (offerId: string) => {
    setSelectedNewOfferId(offerId);
    if (!offerId) {
      setPreviewItems([]);
      return;
    }
    try {
      const { data, error } = await supabase.from("offer_box_items").select("*").eq("offer_box_id", offerId);
      if (error) throw error;
      const items: PreviewItem[] = (data || []).map((it: any) => {
        const product = products.find((row) => row.id === it.product_id) || null;
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
    const product = products.find((row) => row.id === productId);
    if (!product) return;
    const current = previewItems.find((row) => row.key === key);
    updateItem(key, {
      product_id: productId,
      product,
      custom_price: current?.is_gift ? 0 : Number(product.price) || 0,
    });
  };

  const addItem = (product: Product, asGift = false) => {
    setPreviewItems((prev) => [
      ...prev,
      {
        key: genKey(),
        product_id: product.id,
        product,
        quantity: 1,
        custom_price: asGift ? 0 : Number(product.price) || 0,
        is_gift: asGift,
      },
    ]);
  };

  const removeItem = (key: string) => {
    setPreviewItems((prev) => prev.filter((it) => it.key !== key));
  };

  const switchOperation = (next: BoxCopyOperation) => {
    setOperation(next);
    setSelectedNewOfferId("");
    setPreviewItems([]);
    setProductQuery("");
  };

  const copyTitle = (copy: ListedBoxCopy) => {
    if (!copy.offerName) return `المنتجات الحالية (بدون عرض) — ${money(copy.recordedPrice)}`;
    return `${copy.offerName} — بوكس رقم ${copy.copyIndex} — ${money(copy.recordedPrice)}`;
  };

  const canConfirm =
    !!selectedCopy &&
    !!snapshotToken &&
    (operation === "delete" ||
      (operation === "replace_box" && !!selectedNewOffer && replacementLines.length > 0) ||
      (operation === "replace_products" && replacementLines.length > 0));

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!selectedCopy || !canConfirm) {
      toast.error("اختر النسخة ونوع العملية أولاً");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const payload =
        operation === "delete"
          ? {}
          : {
              offer_name: operation === "replace_box" ? selectedNewOffer?.name ?? null : null,
              offer_box_id: operation === "replace_box" ? selectedNewOffer?.id ?? null : null,
              items: previewItems
                .filter((item) => item.product_id && Number(item.quantity) > 0)
                .map((item) => ({
                  product_id: item.product_id,
                  product_name: item.product?.name || "",
                  quantity: Number(item.quantity),
                  unit_price: item.is_gift ? 0 : Number(item.custom_price),
                  is_gift: item.is_gift,
                })),
            };
      const { error } = await supabase.rpc("apply_order_box_copy_change", {
        p_order_id: orderId,
        p_target_key: selectedCopy.key,
        p_operation: operation,
        p_payload: payload,
        p_snapshot_token: snapshotToken,
        p_idempotency_key: idempotencyKey.current,
      });
      if (error) throw error;
      toast.success(operation === "delete" ? "تم حذف النسخة المحددة فقط" : "تم تنفيذ الاستبدال على النسخة المحددة");
      setConfirmDelete(false);
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "حدث خطأ أثناء تعديل النسخة");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const productMatches = products
    .filter((product) => {
      const query = productQuery.trim();
      return !query || product.name.includes(query);
    })
    .slice(0, 8);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="w-5 h-5 text-primary" />
            استبدال أو حذف نسخة بوكس
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="p-6 text-center text-muted-foreground">جاري التحميل...</div>
        ) : copies.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">لا توجد منتجات في هذا الطلب لاستبدالها.</div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <h3 className="text-sm font-medium">ما الذي تريد تعديله؟</h3>
              <div className="flex flex-col gap-2">
                {copies.map((copy) => (
                  <button
                    key={copy.key}
                    type="button"
                    className={`min-h-11 w-full rounded-lg border p-3 text-right ${
                      copy.key === selectedKey ? "border-primary bg-primary/5" : "bg-muted/30"
                    }`}
                    onClick={() => setSelectedKey(copy.key)}
                  >
                    <div className="font-medium">{copyTitle(copy)}</div>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {copy.lines.map((line) => (
                        <li key={`${copy.key}-${line.id}-${line.product_name}`}>
                          {line.product_name} × {line.quantity} — {money(line.unit_price)}
                        </li>
                      ))}
                    </ul>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium">نوع العملية</h3>
              <div className="flex flex-col gap-2">
                {BOX_COPY_OPERATIONS.map((op) => (
                  <Button
                    key={op.id}
                    type="button"
                    variant={operation === op.id ? "default" : "outline"}
                    className="min-h-11 justify-start"
                    onClick={() => switchOperation(op.id)}
                  >
                    {op.label}
                  </Button>
                ))}
              </div>
            </div>

            {operation !== "delete" && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <h3 className="text-sm font-medium">اختيار البديل</h3>
                {operation === "replace_box" ? (
                  <>
                    <Select value={selectedNewOfferId} onValueChange={loadNewOfferPreview}>
                      <SelectTrigger className="min-h-11">
                        <SelectValue placeholder="اختر البوكس البديل" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeOffers.map((offer) => (
                          <SelectItem key={offer.id} value={offer.id}>
                            {offer.name}
                            {offer.offer_price ? ` — ${Number(offer.offer_price).toLocaleString()} ج.م` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedNewOffer?.description && (
                      <p className="text-xs text-muted-foreground">{selectedNewOffer.description}</p>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <Input
                      className="min-h-11"
                      placeholder="بحث عن منتج"
                      value={productQuery}
                      onChange={(event) => setProductQuery(event.target.value)}
                    />
                    <div className="flex flex-col gap-1">
                      {productMatches.map((product) => (
                        <Button
                          key={product.id}
                          type="button"
                          variant="outline"
                          className="min-h-11 justify-between"
                          onClick={() => addItem(product, false)}
                        >
                          <span>{product.name}</span>
                          <span>{money(Number(product.price) || 0)}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {operation === "replace_box" && selectedNewOfferId && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => products[0] && addItem(products[0], false)}
                    >
                      <Plus className="ml-1 h-4 w-4" /> منتج
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => products[0] && addItem(products[0], true)}
                    >
                      <Gift className="ml-1 h-4 w-4" /> هدية
                    </Button>
                  </div>
                )}

                {previewItems.map((item) => (
                  <div key={item.key} className="grid grid-cols-12 items-end gap-2 rounded-lg border bg-background p-3">
                    <div className="col-span-12 md:col-span-5">
                      <label className="text-xs text-muted-foreground">المنتج</label>
                      <Select value={item.product_id} onValueChange={(value) => swapProduct(item.key, value)}>
                        <SelectTrigger className="min-h-11">
                          <SelectValue placeholder="اختر منتج" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((product) => (
                            <SelectItem key={product.id} value={product.id}>
                              {product.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <label className="text-xs text-muted-foreground">الكمية</label>
                      <Input
                        className="min-h-11"
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(event) => updateItem(item.key, { quantity: Number(event.target.value) })}
                      />
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <label className="text-xs text-muted-foreground">سعر الوحدة</label>
                      <Input
                        className="min-h-11"
                        type="number"
                        min={0}
                        disabled={item.is_gift}
                        value={item.custom_price}
                        onChange={(event) => updateItem(item.key, { custom_price: Number(event.target.value) })}
                      />
                    </div>
                    <div className="col-span-3 text-sm font-semibold md:col-span-2">
                      {item.is_gift ? (
                        <Badge variant="secondary" className="gap-1">
                          <Gift className="h-3 w-3" /> هدية
                        </Badge>
                      ) : (
                        money(Number(item.quantity) * Number(item.custom_price))
                      )}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(item.key)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {preview && selectedCopy && (
              <div className="space-y-2 rounded-lg border p-3">
                <h3 className="text-sm font-medium">ملخص العملية</h3>
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">الأصل</span>
                    <span>{copyTitle(selectedCopy)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">نوع العملية</span>
                    <span>{BOX_COPY_OPERATIONS.find((op) => op.id === operation)?.label}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">البديل</span>
                    <span>
                      {operation === "delete"
                        ? "بدون استبدال"
                        : operation === "replace_box"
                          ? selectedNewOffer?.name || "—"
                          : replacementLines.map((line) => line.product_name).join("، ") || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">الفرق</span>
                    <span>{money(preview.priceDelta)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">الشحن بعد العملية</span>
                    <span>{money(preview.deliveryFee)}</span>
                  </div>
                  <div className="flex justify-between gap-3 font-semibold">
                    <span>إجمالي الطلب الجديد</span>
                    <span>{money(preview.newTotal)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          {operation === "delete" ? (
            <Button
              className="min-h-11"
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || !canConfirm}
            >
              تأكيد الحذف
            </Button>
          ) : (
            <Button className="min-h-11" onClick={() => void handleSave()} disabled={saving || !canConfirm}>
              {saving ? "جاري الاستبدال..." : "تأكيد الاستبدال"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف نهائي دون استبدال</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف النسخة المحددة فقط. النسخ الأخرى والمنتجات خارجها تبقى كما هي.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">إلغاء</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => void handleSave()} disabled={saving}>
              تأكيد الحذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};

export default SwapOfferDialog;
