import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  addCustomAdjustmentReason,
  type AdjustmentReasonKind,
} from "@/lib/warehouseAdjustmentReasons";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: AdjustmentReasonKind;
  onCreated: (reason: string) => void;
}

const AddAdjustmentReasonDialog = ({ open, onOpenChange, kind, onCreated }: Props) => {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const handleSave = () => {
    const res = addCustomAdjustmentReason(kind, name);
    if (!res.ok) {
      toast({ title: res.error || "تعذر الحفظ", variant: "destructive" });
      return;
    }
    toast({ title: "تمت إضافة السبب" });
    onCreated(res.reason!);
    setName("");
    setDesc("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>إضافة سبب جديد</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">اسم السبب *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: صرف فرع"
              maxLength={80}
            />
          </div>
          <div>
            <Label className="text-xs">وصف (اختياري)</Label>
            <Textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              maxLength={200}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={name.trim().length < 3}>حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddAdjustmentReasonDialog;
