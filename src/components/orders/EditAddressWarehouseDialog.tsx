import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderId: string;
  initialAddress: string | null;
  initialWarehouseId: string | null;
  initialFulfillmentType?: string | null;
  initialShippingCompany?: string | null;
  onSaved?: (next: {
    delivery_address: string | null;
    source_warehouse_id: string | null;
    source_warehouse_name: string | null;
    fulfillment_type: string | null;
    shipping_company: string | null;
  }) => void;
}

type Wh = { id: string; name: string };
type FKey =
  | "pickup_main"
  | "delivery_main"
  | "pickup_agouza"
  | "delivery_agouza"
  | "shipping_company"
  | "";

export default function EditAddressWarehouseDialog({
  open,
  onOpenChange,
  orderId,
  initialAddress,
  initialWarehouseId,
  initialFulfillmentType,
  initialShippingCompany,
  onSaved,
}: Props) {
  const [address, setAddress] = useState(initialAddress || "");
  const [warehouses, setWarehouses] = useState<Wh[]>([]);
  const [fKey, setFKey] = useState<FKey>("");
  const [shippingCompany, setShippingCompany] = useState<string>(initialShippingCompany || "");
  const [saving, setSaving] = useState(false);

  const mainWh = useMemo(
    () => warehouses.find((w) => w.name?.includes("الرئيسي") || w.name?.includes("المقر")),
    [warehouses]
  );
  const agouzaWh = useMemo(
    () => warehouses.find((w) => w.name?.includes("العجوزة")),
    [warehouses]
  );

  // Initialize fKey from initial values once warehouses load
  useEffect(() => {
    if (!open) return;
    setAddress(initialAddress || "");
    setShippingCompany(initialShippingCompany || "");
    (async () => {
      const { data } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      const list = (data || []) as Wh[];
      setWarehouses(list);

      const wh = list.find((w) => w.id === initialWarehouseId);
      const isAgouza = !!wh?.name?.includes("العجوزة");
      const isMain = !!(wh?.name?.includes("الرئيسي") || wh?.name?.includes("المقر"));
      const ft = (initialFulfillmentType || "").toLowerCase();
      if (isAgouza && ft === "pickup") setFKey("pickup_agouza");
      else if (isAgouza) setFKey("delivery_agouza");
      else if (isMain && ft === "pickup") setFKey("pickup_main");
      else if (isMain) setFKey("delivery_main");
      else if (initialShippingCompany) setFKey("shipping_company");
      else setFKey("");
    })();
  }, [open, initialAddress, initialWarehouseId, initialFulfillmentType, initialShippingCompany]);

  const save = async () => {
    if (!fKey) {
      toast.error("اختر طريقة التسليم");
      return;
    }
    setSaving(true);
    try {
      let source_warehouse_id: string | null = null;
      let fulfillment_type: string | null = null;
      let shipping: string | null = null;

      if (fKey === "shipping_company") {
        source_warehouse_id = null;
        fulfillment_type = "delivery";
        shipping = shippingCompany.trim() || null;
        if (!shipping) {
          toast.error("اكتب اسم شركة الشحن");
          setSaving(false);
          return;
        }
      } else {
        const isAgouza = fKey.endsWith("_agouza");
        const wh = isAgouza ? agouzaWh : mainWh;
        if (!wh) {
          toast.error(isAgouza ? "لم يتم العثور على مخزن العجوزة" : "لم يتم العثور على المخزن الرئيسي");
          setSaving(false);
          return;
        }
        source_warehouse_id = wh.id;
        fulfillment_type = fKey.startsWith("pickup") ? "pickup" : "delivery";
        shipping = fKey === "delivery_main" ? "مندوب خاص" : null;
      }

      const patch: any = {
        delivery_address: address.trim() || null,
        source_warehouse_id,
        fulfillment_type,
        shipping_company: shipping,
      };
      const { error } = await supabase.from("orders").update(patch).eq("id", orderId);
      if (error) throw error;

      const whName = warehouses.find((w) => w.id === source_warehouse_id)?.name || null;
      toast.success("تم تحديث طريقة التسليم");
      onSaved?.({
        delivery_address: patch.delivery_address,
        source_warehouse_id,
        source_warehouse_name: whName,
        fulfillment_type,
        shipping_company: shipping,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "تعذّر حفظ التعديلات");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تعديل طريقة التسليم والعنوان</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>طريقة التسليم</Label>
            <Select value={fKey} onValueChange={(v) => setFKey(v as FKey)}>
              <SelectTrigger>
                <SelectValue placeholder="اختر طريقة التسليم" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pickup_main">استلام من المخزن الرئيسي</SelectItem>
                <SelectItem value="delivery_main">توصيل بالمندوب الخاص (كيمو)</SelectItem>
                <SelectItem value="pickup_agouza">استلام من مخزن العجوزة</SelectItem>
                <SelectItem value="delivery_agouza">توصيل من منفذ العجوزة</SelectItem>
                <SelectItem value="shipping_company">شركة شحن</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {fKey === "shipping_company" && (
            <div>
              <Label>اسم شركة الشحن</Label>
              <input
                className="w-full border rounded-md h-9 px-3 text-sm bg-background"
                value={shippingCompany}
                onChange={(e) => setShippingCompany(e.target.value)}
                placeholder="مثل: بوسطة / أرامكس / ..."
              />
            </div>
          )}

          <div>
            <Label>عنوان التوصيل</Label>
            <Textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              placeholder="عنوان التوصيل الكامل"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "جارِ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
