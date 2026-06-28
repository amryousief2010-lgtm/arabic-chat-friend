import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus } from "lucide-react";

const CATEGORIES = ["لحوم", "علف", "كتاكيت", "مستلزمات", "تغليف", "منتجات أخرى"];
const UNITS = ["كجم", "جرام", "قطعة", "كرتونة", "شيكارة", "وحدة", "لتر", "علبة"];

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mainWarehouseId: string;
  mainWarehouseName: string;
  onCreated?: () => void;
};

type FormState = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  unit: string;
  opening_qty: number;
  unit_cost: number;
  sale_price: number;
  low_stock_threshold: number;
  notes: string;
};

const initial: FormState = {
  name: "",
  sku: "",
  barcode: "",
  category: "",
  unit: "كجم",
  opening_qty: 0,
  unit_cost: 0,
  sale_price: 0,
  low_stock_threshold: 0,
  notes: "",
};

const genSku = () => `MAIN-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 999).toString(36).toUpperCase()}`;

export default function AddMainWarehouseItemDialog({ open, onOpenChange, mainWarehouseId, mainWarehouseName, onCreated }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));
  const reset = () => setForm(initial);

  const validate = (): string | null => {
    if (!form.name.trim()) return "اسم الصنف مطلوب";
    if (!form.category) return "التصنيف مطلوب";
    if (!form.unit) return "وحدة القياس مطلوبة";
    if (Number(form.opening_qty) < 0) return "الرصيد الافتتاحي لا يمكن أن يكون بالسالب";
    if (Number(form.unit_cost) < 0) return "تكلفة الوحدة لا يمكن أن تكون بالسالب";
    if (Number(form.sale_price) < 0) return "سعر البيع لا يمكن أن يكون بالسالب";
    if (Number(form.low_stock_threshold) < 0) return "حد إعادة الطلب لا يمكن أن يكون بالسالب";
    if (Number(form.opening_qty) > 0 && Number(form.unit_cost) <= 0) {
      return "أدخل تكلفة الوحدة عند وجود رصيد افتتاحي";
    }
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      toast({ title: "بيانات غير مكتملة", description: err, variant: "destructive" });
      return;
    }
    setSaving(true);
    let createdProductId: string | null = null;
    let createdItemId: string | null = null;
    try {
      const name = form.name.trim();
      const sku = (form.sku.trim() || genSku()).toUpperCase();
      const category = form.category;
      const unit = form.unit;
      const barcode = form.barcode.trim() || null;
      const openQty = Number(form.opening_qty) || 0;
      const unitCost = Number(form.unit_cost) || 0;
      const salePrice = Number(form.sale_price) || 0;
      const lowStock = Number(form.low_stock_threshold) || 0;

      // 1) Duplicate check: same name+unit+category inside main warehouse
      const dup = await supabase
        .from("inventory_items")
        .select("id,category")
        .eq("warehouse_id", mainWarehouseId)
        .eq("name", name)
        .eq("unit", unit)
        .limit(20);
      if (dup.error) throw dup.error;
      if ((dup.data || []).some((r: any) => (r.category || "") === category)) {
        toast({
          title: "الصنف موجود بالفعل",
          description: "الصنف موجود بالفعل في المخزن الرئيسي. لإضافة كمية استخدم حركة توريد أو رصيد افتتاحي.",
          variant: "destructive",
        });
        setSaving(false);
        return;
      }

      // 2) SKU unique in inventory_items.item_code (per identity index uses warehouse+module+category+item_code; we enforce global uniqueness for clarity)
      const skuCheck = await supabase.from("inventory_items").select("id").eq("item_code", sku).limit(1);
      if (skuCheck.error) throw skuCheck.error;
      if ((skuCheck.data || []).length > 0) {
        toast({ title: "SKU مكرر", description: "كود الصنف مستخدم بالفعل", variant: "destructive" });
        setSaving(false);
        return;
      }

      // 3) Barcode unique in products
      if (barcode) {
        const bc = await supabase.from("products").select("id").eq("barcode", barcode).limit(1);
        if (bc.error) throw bc.error;
        if ((bc.data || []).length > 0) {
          toast({ title: "الباركود مكرر", description: "الباركود مستخدم لصنف آخر", variant: "destructive" });
          setSaving(false);
          return;
        }
      }

      // 4) Create product (master record)
      const prod = await supabase
        .from("products")
        .insert({
          name,
          description: form.notes.trim() || null,
          price: salePrice,
          unit,
          stock: 0,
          category,
          cost_price: unitCost,
          low_stock_threshold: Math.round(lowStock) || 10,
          barcode,
          is_active: true,
        })
        .select("id")
        .single();
      if (prod.error) throw prod.error;
      createdProductId = prod.data!.id;

      // 5) Create inventory_item in main warehouse linked to product
      const insertItem = await supabase
        .from("inventory_items")
        .insert({
          warehouse_id: mainWarehouseId,
          product_id: createdProductId,
          name,
          category,
          sku,
          item_code: sku,
          unit,
          stock: 0,
          unit_cost: unitCost,
          low_stock_threshold: lowStock,
          notes: form.notes.trim() || null,
          is_active: true,
        })
        .select("id")
        .single();
      if (insertItem.error) throw insertItem.error;
      createdItemId = insertItem.data!.id;

      // 6) Opening balance movement (only if > 0). Trigger will update stock.
      if (openQty > 0) {
        const mv = await supabase.from("inventory_movements").insert({
          item_id: createdItemId,
          warehouse_id: mainWarehouseId,
          movement_type: "opening_balance",
          quantity: openQty,
          unit_cost: unitCost,
          total_cost: openQty * unitCost,
          reference: "OPENING-BALANCE",
          reference_type: "opening_balance",
          party: "رصيد افتتاحي",
          notes: `رصيد افتتاحي للصنف ${name} — ${mainWarehouseName}`,
          performed_by: user?.id ?? null,
          approval_status: "posted",
        });
        if (mv.error) throw mv.error;
      }

      toast({ title: "تمت الإضافة", description: "تم إضافة الصنف للمخزن الرئيسي بنجاح" });
      reset();
      onOpenChange(false);
      onCreated?.();
    } catch (e: any) {
      // Manual rollback in order: item then product
      try {
        if (createdItemId) await supabase.from("inventory_items").delete().eq("id", createdItemId);
        if (createdProductId) await supabase.from("products").delete().eq("id", createdProductId);
      } catch {
        /* ignore rollback errors */
      }
      toast({ title: "خطأ", description: e?.message || "تعذّر حفظ الصنف", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" />
            إضافة صنف جديد للمخزن الرئيسي
          </DialogTitle>
          <DialogDescription>
            سيتم إنشاء الصنف في كتالوج المنتجات وربطه بالمخزن الرئيسي. الرصيد الافتتاحي (إن وُجد) يُسجَّل كحركة <b>رصيد افتتاحي</b>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <Label>اسم الصنف *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="مثال: لحم نعام، موزة، رقاب، علف تسمين" />
          </div>

          <div>
            <Label>كود الصنف / SKU</Label>
            <Input value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="اتركه فارغًا للتوليد التلقائي" />
          </div>

          <div>
            <Label>الباركود (اختياري)</Label>
            <Input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} placeholder="—" />
          </div>

          <div>
            <Label>التصنيف *</Label>
            <Select value={form.category} onValueChange={(v) => set("category", v)}>
              <SelectTrigger><SelectValue placeholder="اختر التصنيف" /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>وحدة القياس *</Label>
            <Select value={form.unit} onValueChange={(v) => set("unit", v)}>
              <SelectTrigger><SelectValue placeholder="اختر الوحدة" /></SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>المخزن</Label>
            <Input value={mainWarehouseName} disabled readOnly />
          </div>

          <div>
            <Label>الرصيد الافتتاحي</Label>
            <Input
              type="number"
              min={0}
              step="0.001"
              value={form.opening_qty}
              onChange={(e) => set("opening_qty", Math.max(0, Number(e.target.value) || 0))}
            />
          </div>

          <div>
            <Label>تكلفة الوحدة</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.unit_cost}
              onChange={(e) => set("unit_cost", Math.max(0, Number(e.target.value) || 0))}
            />
          </div>

          <div>
            <Label>سعر البيع (اختياري)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.sale_price}
              onChange={(e) => set("sale_price", Math.max(0, Number(e.target.value) || 0))}
            />
          </div>

          <div>
            <Label>حد إعادة الطلب</Label>
            <Input
              type="number"
              min={0}
              step="0.001"
              value={form.low_stock_threshold}
              onChange={(e) => set("low_stock_threshold", Math.max(0, Number(e.target.value) || 0))}
            />
          </div>

          <div className="md:col-span-2">
            <Label>ملاحظات</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { if (!saving) { onOpenChange(false); reset(); } }} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Plus className="w-4 h-4 ml-2" />}
            حفظ الصنف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
