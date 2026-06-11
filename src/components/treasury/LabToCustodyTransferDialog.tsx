import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Send, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const PM_LBL: Record<string, string> = {
  cash: "نقدي",
  vodafone_cash: "فودافون كاش",
  instapay: "إنستا باي",
  bank_transfer: "تحويل بنكي",
};

const today = () => new Date().toISOString().slice(0, 10);

interface Keeper { id: string; full_name: string }

export default function LabToCustodyTransferDialog({ onCreated }: { onCreated?: () => void }) {
  const { roles, isGeneralManager, isExecutiveManager } = useAuth();
  const canSend = isGeneralManager || isExecutiveManager || (roles || []).includes("lab_treasury_approver");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keepers, setKeepers] = useState<Keeper[]>([]);
  const [form, setForm] = useState({
    amount: "" as any,
    payment_method: "cash",
    transfer_date: today(),
    custody_keeper_id: "",
    notes: "",
  });

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: ur } = await (supabase as any)
        .from("user_roles").select("user_id").eq("role", "slaughterhouse_custody_keeper");
      const ids = (ur || []).map((r: any) => r.user_id);
      if (!ids.length) { setKeepers([]); return; }
      const { data: profs } = await (supabase as any)
        .from("profiles").select("id, full_name").in("id", ids);
      const list = (profs || []) as Keeper[];
      setKeepers(list);
      setForm(f => ({ ...f, custody_keeper_id: f.custody_keeper_id || list[0]?.id || "" }));
    })();
  }, [open]);

  if (!canSend) return null;

  const submit = async () => {
    const amt = Number(form.amount || 0);
    if (amt <= 0) { toast.error("المبلغ مطلوب"); return; }
    if (!form.custody_keeper_id) { toast.error("اختر أمين العهدة"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("create_lab_to_custody_transfer" as any, {
      p_amount: amt,
      p_transfer_date: form.transfer_date,
      p_custody_keeper_id: form.custody_keeper_id,
      p_payment_method: form.payment_method,
      p_notes: form.notes || null,
    });
    setBusy(false);
    if (error) { toast.error("فشل التحويل: " + error.message); return; }
    toast.success("تم خصم المبلغ من خزنة المعمل وإرسال التحويل لخزنة العهدة بانتظار التأكيد");
    setOpen(false);
    setForm({ amount: "", payment_method: "cash", transfer_date: today(), custody_keeper_id: form.custody_keeper_id, notes: "" });
    onCreated?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 border-primary/40">
          <Send className="w-4 h-4" /> تحويل لخزنة عهدة المجزر
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>تحويل من خزنة المعمل إلى خزنة عهدة المجزر</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>المبلغ</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div><Label>طريقة الدفع</Label>
              <Select value={form.payment_method} onValueChange={v => setForm({ ...form, payment_method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PM_LBL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>تاريخ التحويل</Label>
              <Input type="date" value={form.transfer_date} onChange={e => setForm({ ...form, transfer_date: e.target.value })} />
            </div>
            <div><Label>أمين العهدة المستلم</Label>
              <Select value={form.custody_keeper_id} onValueChange={v => setForm({ ...form, custody_keeper_id: v })}>
                <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                <SelectContent>
                  {keepers.map(k => <SelectItem key={k.id} value={k.id}>{k.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>ملاحظات</Label>
            <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="text-xs text-muted-foreground">
            سيتم تسجيل مصروف معتمد في خزنة المعمل فورًا، وسيظهر التحويل لأمين العهدة لتأكيد الاستلام — ولن يُضاف إلى رصيد العهدة إلا بعد التأكيد.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>إلغاء</Button>
          <Button onClick={submit} disabled={busy} className="gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            تنفيذ التحويل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
