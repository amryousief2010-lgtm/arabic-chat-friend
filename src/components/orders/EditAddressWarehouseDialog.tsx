import { useEffect, useState } from "react";
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
  onSaved?: (next: { delivery_address: string | null; source_warehouse_id: string | null; source_warehouse_name: string | null }) => void;
}

type Wh = { id: string; name: string };

export default function EditAddressWarehouseDialog({
  open,
  onOpenChange,
  orderId,
  initialAddress,
  initialWarehouseId,
  onSaved,
}: Props) {
  const [address, setAddress] = useState(initialAddress || "");
  const [whId, setWhId] = useState<string>(initialWarehouseId || "");
  const [warehouses, setWarehouses] = useState<Wh[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAddress(initialAddress || "");
    setWhId(initialWarehouseId || "");
    (async () => {
      const { data } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      setWarehouses((data || []) as Wh[]);
    })();
  }, [open, initialAddress, initialWarehouseId]);

  const save = async () => {
    setSaving(true);
    try {
      const patch: any = {
        delivery_address: address.trim() || null,
        source_warehouse_id: whId || null,
      };
      const { error } = await supabase.from("orders").update(patch).eq("id", orderId);
      if (error) throw error;
      const whName = warehouses.find((w) => w.id === whId)?.name || null;
      toast.success("تم تحديث العنوان ومخزن الاستلام");
      onSaved?.({
        delivery_address: patch.delivery_address,
        source_warehouse_id: patch.source_warehouse_id,
        source_warehouse_name: whName,
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
          <DialogTitle>تعديل العنوان ومخزن الاستلام</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>عنوان التوصيل</Label>
            <Textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              placeholder="عنوان التوصيل الكامل"
            />
          </div>
          <div>
            <Label>مخزن الاستلام / التوصيل</Label>
            <Select value={whId} onValueChange={setWhId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر المخزن" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
