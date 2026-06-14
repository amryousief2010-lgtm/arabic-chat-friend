import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, X, Plus, ShieldAlert, Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  group: any; // grouped operational batch from HatcheryGroupedBatches
  onClose: () => void;
  onSaved?: () => void;
}

const ALLOWED_ROLES = ["general_manager", "executive_manager", "hatchery_manager", "farm_manager"] as const;

const today = () => new Date().toISOString().slice(0, 10);

export default function BatchAddEggsDialog({ group, onClose, onSaved }: Props) {
  const { roles, profile, user } = useAuth();
  const canEdit = useMemo(
    () => roles.some((r) => (ALLOWED_ROLES as readonly string[]).includes(r)),
    [roles]
  );

  // Lock: don't allow adding eggs once any row in the group has hatch results / closed / exit
  const locked = useMemo(() => {
    return (group?.customers || []).some((c: any) => {
      const r = c._raw || {};
      return (
        (r.hatched_chicks || 0) > 0 ||
        r.exit_date ||
        r.status === "closed" ||
        r.status === "completed"
      );
    });
  }, [group]);

  const { data: customers = [] } = useQuery<any[]>({
    queryKey: ["hatch_customers_for_add_eggs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hatch_customers" as any)
        .select("id,name,customer_type")
        .order("name");
      return (data as any[]) || [];
    },
  });

  const [customerId, setCustomerId] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [addDate, setAddDate] = useState<string>(today());
  const [source, setSource] = useState<string>("external");
  const [notes, setNotes] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const totalBefore = group?.total_eggs || 0;
  const existingForCustomer = useMemo(
    () => (group?.customers || []).find((c: any) => c._raw?.customer_id === customerId),
    [group, customerId]
  );

  const save = async () => {
    if (!canEdit) return toast.error("لا تملك صلاحية الإضافة");
    if (locked) return toast.error("الدفعة مقفلة (نتيجة فقس/إغلاق)");
    if (!customerId) return toast.error("اختر العميل");
    const q = Number(qty);
    if (!q || q <= 0) return toast.error("أدخل عدد بيض صحيح");
    if (saving) return;
    setSaving(true);
    try {
      const opNo = group.op_seq;
      const machine = group.machine || null;
      const entryDate = group.entry_date;
      const userId = user?.id || null;
      const refId = `late_egg_addition_${opNo}_${customerId}_${addDate}_${q}`;

      // Duplicate guard: search audit log for same reference_id in last 24h
      const { data: dup } = await supabase
        .from("hatch_batch_edit_audit")
        .select("id")
        .contains("changes", { reference_id: refId } as any)
        .limit(1)
        .maybeSingle();
      if (dup) {
        toast.error("تم تسجيل هذه الإضافة بالفعل (منع التكرار)");
        return;
      }

      // 1) Find/create hatchery_batches header for this op
      let headerId: string | null = null;
      {
        const { data: header } = await supabase
          .from("hatchery_batches" as any)
          .select("id")
          .eq("entry_date", entryDate)
          .eq("incubator_machine_no", machine)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        headerId = (header as any)?.id || null;
        if (!headerId) {
          const { data: created, error: hErr } = await supabase
            .from("hatchery_batches" as any)
            .insert({
              entry_date: entryDate,
              batch_type: "mixed",
              incubator_machine_no: machine,
              notes: `Auto-created for op_seq ${opNo}`,
              created_by: userId,
            })
            .select()
            .single();
          if (hErr) throw hErr;
          headerId = (created as any).id;
        }
      }

      // 2) Insert a new hatchery_batch_lot for the added eggs (audit trail)
      const cust = customers.find((c: any) => c.id === customerId);
      const ownerType = cust?.customer_type === "internal" ? "capital_ostrich" : "external_client";
      const { data: lot, error: lotErr } = await supabase
        .from("hatchery_batch_lots" as any)
        .insert({
          batch_id: headerId,
          owner_type: ownerType,
          source: source || (ownerType === "capital_ostrich" ? "mother_farm" : "external"),
          eggs_in: q,
          client_id: ownerType === "external_client" ? customerId : null,
          client_name_snapshot: cust?.name || null,
        })
        .select()
        .single();
      if (lotErr) throw lotErr;

      // 3) Mirror in hatch_batches: either add to existing customer row, or create new mirror row
      let mirrorId = existingForCustomer?.id || null;
      if (mirrorId) {
        const before = existingForCustomer._raw || {};
        const newReceived = (before.received_eggs || 0) + q;
        const newNet = (before.net_eggs || 0) + q;
        const { error: uErr } = await supabase
          .from("hatch_batches")
          .update({
            received_eggs: newReceived,
            net_eggs: newNet,
            notes: notes
              ? `${before.notes ? before.notes + "\n" : ""}+${q} بيضة متأخرة بتاريخ ${addDate} — ${notes}`
              : before.notes,
          })
          .eq("id", mirrorId);
        if (uErr) throw uErr;
      } else {
        const ts = Date.now();
        const { data: ins, error: iErr } = await supabase
          .from("hatch_batches")
          .insert({
            batch_number: `HB-${String(opNo).padStart(5, "0")}-${ts}`,
            operational_batch_no: opNo,
            receive_date: addDate,
            entry_date: entryDate,
            machine,
            received_eggs: q,
            net_eggs: q,
            customer_id: customerId,
            status: "pending",
            notes: notes || `بيض متأخر مضاف بتاريخ ${addDate}`,
            created_by: userId,
            is_test: false,
          } as any)
          .select("id")
          .single();
        if (iErr) throw iErr;
        mirrorId = (ins as any).id;
      }

      // 4) Audit log + movement
      await supabase.from("hatch_batch_edit_audit").insert({
        batch_id: mirrorId,
        batch_number: existingForCustomer?.batch_number || null,
        operational_batch_no: opNo,
        customer_id: customerId,
        customer_name: cust?.name || null,
        actor_id: userId,
        actor_name: profile?.full_name || user?.email || null,
        changes: {
          action: "late_eggs_added",
          reference_id: refId,
          eggs_added: q,
          total_eggs_before: totalBefore,
          total_eggs_after: totalBefore + q,
          add_date: addDate,
          source,
          lot_id: (lot as any).id,
          header_id: headerId,
          notes,
        },
        reason: reason.trim() || "إضافة بيض متأخر للدفعة",
      });

      await supabase.from("hatchery_batch_movements" as any).insert({
        batch_id: headerId,
        lot_id: (lot as any).id,
        event_type: "created",
        payload: {
          kind: "late_eggs_added",
          operational_batch_no: opNo,
          customer_id: customerId,
          customer_name: cust?.name,
          eggs_added: q,
          add_date: addDate,
          reference_id: refId,
          total_eggs_before: totalBefore,
          total_eggs_after: totalBefore + q,
        },
        created_by: userId,
      });

      toast.success(`تمت إضافة ${q} بيضة للدفعة رقم ${opNo}`);
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <ShieldAlert className="w-5 h-5" /> لا تملك صلاحية الإضافة
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            إضافة البيض المتأخر متاحة فقط للمدير العام، المدير التنفيذي، أو مدير المعمل.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-purple-600" />
            إضافة بيض للدفعة — {group?.op_number}
          </DialogTitle>
        </DialogHeader>

        {locked && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 flex items-start gap-2">
            <Lock className="w-4 h-4 mt-0.5" />
            <div>
              لا يمكن إضافة بيض على هذه الدفعة بعد تسجيل نتيجة الفقس أو إغلاق الدفعة.
              يمكن عمل تسوية معتمدة من المدير العام فقط.
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <Label>العميل *</Label>
            <Select value={customerId} onValueChange={setCustomerId} disabled={locked}>
              <SelectTrigger><SelectValue placeholder="اختر العميل" /></SelectTrigger>
              <SelectContent>
                {customers.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} {c.customer_type === "internal" ? "(عاصمة)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {existingForCustomer && (
              <div className="text-xs text-emerald-700 mt-1">
                العميل موجود بالفعل في الدفعة برصيد {existingForCustomer.total_eggs} بيضة — ستتم زيادة الكمية الحالية.
              </div>
            )}
          </div>

          <div>
            <Label>عدد البيض المضاف *</Label>
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} disabled={locked} />
          </div>
          <div>
            <Label>تاريخ الإضافة</Label>
            <Input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} disabled={locked} />
          </div>
          <div className="md:col-span-2">
            <Label>المصدر</Label>
            <Select value={source} onValueChange={setSource} disabled={locked}>
              <SelectTrigger /><SelectContent>
                <SelectItem value="mother_farm">مزرعة الأمهات</SelectItem>
                <SelectItem value="external">عميل خارجي</SelectItem>
                <SelectItem value="other">أخرى</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>ملاحظات</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={locked} />
          </div>
          <div className="md:col-span-2">
            <Label>سبب الإضافة</Label>
            <Textarea
              rows={2}
              placeholder="مثال: العميل أحضر بيض متأخر بعد بدء التشغيل"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={locked}
            />
          </div>

          <div className="md:col-span-2 text-xs bg-slate-50 border rounded p-2">
            <div>إجمالي البيض الحالي للدفعة: <b>{totalBefore}</b></div>
            <div>بعد الإضافة: <b>{totalBefore + (Number(qty) || 0)}</b></div>
            <div className="text-muted-foreground mt-1">
              سيتم تحديث الجداول: <span className="font-mono">hatchery_batch_lots</span> +{" "}
              <span className="font-mono">hatch_batches</span> +{" "}
              <span className="font-mono">hatchery_batch_movements</span> (سجل تدقيق)
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            <X className="w-4 h-4 ml-1" /> إلغاء
          </Button>
          <Button
            onClick={save}
            disabled={saving || locked || !customerId || !qty}
            className="bg-purple-600 hover:bg-purple-700"
          >
            <Save className="w-4 h-4 ml-1" /> {saving ? "جاري الحفظ..." : "حفظ الإضافة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
