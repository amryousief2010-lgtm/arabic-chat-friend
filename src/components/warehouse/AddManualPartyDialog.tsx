import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: "supply" | "dispatch";
  onCreated?: (party: { id: string; name: string }) => void;
}

const SUPPLY_TYPES = ["مجزر","مصنع","فرع","هايبر","مندوب","عميل","مرتجع","أخرى"];
const DISPATCH_TYPES = ["فرع","هايبر","مندوب","عميل","تالف / هالك","استخدام داخلي","أخرى"];

const AddManualPartyDialog = ({ open, onOpenChange, kind, onCreated }: Props) => {
  const { user, isGeneralManager, isExecutiveManager, isWarehouseSupervisor } = useAuth() as any;
  const allowed = isGeneralManager || isExecutiveManager || isWarehouseSupervisor;
  const types = kind === "supply" ? SUPPLY_TYPES : DISPATCH_TYPES;

  const [name, setName] = useState("");
  const [partyType, setPartyType] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setName(""); setPartyType(""); setNotes(""); }
  }, [open]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast({ title: "أدخل اسم الجهة", variant: "destructive" }); return; }
    if (!allowed) { toast({ title: "غير مصرح", description: "إضافة الجهات متاحة للمدير العام/التنفيذي ومسؤول المخزن.", variant: "destructive" }); return; }

    setSaving(true);
    try {
      // Check duplicate (same kind, case-insensitive)
      const { data: existing } = await supabase
        .from("warehouse_manual_parties" as any)
        .select("id,name")
        .eq("kind", kind)
        .ilike("name", trimmed);
      if (existing && existing.length > 0) {
        toast({ title: "هذه الجهة موجودة بالفعل", variant: "destructive" });
        setSaving(false);
        return;
      }

      const { data, error } = await supabase
        .from("warehouse_manual_parties" as any)
        .insert({
          kind, name: trimmed, party_type: partyType || null, notes: notes.trim() || null,
          created_by: user?.id ?? null,
        })
        .select("id,name")
        .single();
      if (error) throw error;

      toast({ title: "تمت إضافة الجهة" });
      onCreated?.(data as any);
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "تعذرت الإضافة", description: e?.message || "خطأ غير معروف", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            إضافة {kind === "supply" ? "جهة توريد" : "جهة صرف"} جديدة
          </DialogTitle>
          <DialogDescription className="text-xs">
            الجهة الجديدة ستظهر مع الجهات الأساسية في القائمة.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">اسم الجهة *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="مثال: فرع المعادي" />
          </div>
          <div>
            <Label className="text-xs">نوع الجهة</Label>
            <Select value={partyType} onValueChange={setPartyType}>
              <SelectTrigger><SelectValue placeholder="اختياري" /></SelectTrigger>
              <SelectContent>
                {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">ملاحظات (اختياري)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving || !allowed}>
            {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Plus className="w-4 h-4 ml-1" />}
            حفظ الجهة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddManualPartyDialog;
