import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, X, Plus, Trash2, ShieldAlert, Lock, UserPlus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import QuickAddHatchCustomerDialog from "./QuickAddHatchCustomerDialog";

interface Props {
  group: any;
  onClose: () => void;
  onSaved?: () => void;
}

const ALLOWED_ROLES = ["general_manager", "executive_manager", "hatchery_manager", "farm_manager"] as const;
const today = () => new Date().toISOString().slice(0, 10);

type AddRow = {
  customer_id: string;
  qty: string;
  add_date: string;
  source: string;
  notes: string;
  reason: string;
};

const blankRow = (): AddRow => ({
  customer_id: "",
  qty: "",
  add_date: today(),
  source: "external",
  notes: "",
  reason: "",
});

export default function BatchAddEggsDialog({ group, onClose, onSaved }: Props) {
  const { roles, profile, user } = useAuth();
  const canEdit = useMemo(
    () => roles.some((r) => (ALLOWED_ROLES as readonly string[]).includes(r)),
    [roles]
  );

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

  const qc = useQueryClient();
  const { data: customers = [] } = useQuery<any[]>({
    queryKey: ["hatch_customers_for_add_eggs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hatch_customers" as any)
        .select("id,name,customer_type,phone")
        .order("name");
      return (data as any[]) || [];
    },
  });

  const [rows, setRows] = useState<AddRow[]>([blankRow()]);
  const [saving, setSaving] = useState(false);
  const [quickAddForRow, setQuickAddForRow] = useState<number | null>(null);

  const totalBefore = group?.total_eggs || 0;
  const addedTotal = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  const setRow = (i: number, patch: Partial<AddRow>) =>
    setRows((p) => p.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  const addRow = () => setRows((p) => [...p, blankRow()]);
  const removeRow = (i: number) => setRows((p) => p.filter((_, j) => j !== i));

  const findExisting = (customerId: string) =>
    (group?.customers || []).find((c: any) => c._raw?.customer_id === customerId);

  const validate = (): string | null => {
    if (!rows.length) return "أضف صفًا واحدًا على الأقل";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.customer_id) return `الصف ${i + 1}: اختر العميل`;
      const q = Number(r.qty);
      if (!q || q <= 0) return `الصف ${i + 1}: كمية البيض يجب أن تكون أكبر من صفر`;
    }
    // Internal duplicate check (same customer + date + qty)
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const key = `${r.customer_id}|${r.add_date}|${Number(r.qty)}`;
      if (seen.has(key)) return `الصف ${i + 1}: نفس العميل بنفس التاريخ والكمية مكرر داخل الفورم`;
      seen.add(key);
    }
    return null;
  };

  const save = async () => {
    if (!canEdit) return toast.error("لا تملك صلاحية الإضافة");
    if (locked) return toast.error("لا يمكن إضافة بيض على دفعة مقفلة أو تم تسجيل نتيجة فقس لها");
    const err = validate();
    if (err) return toast.error(err);
    if (saving) return;
    setSaving(true);

    const batchOperationId = (crypto as any).randomUUID?.() || `op-${Date.now()}`;
    const opNo = group.op_seq;
    const machine = group.machine || null;
    const entryDate = group.entry_date;
    const userId = user?.id || null;

    const report = { ok: 0, skipped: 0, failed: 0, details: [] as string[] };

    try {
      // Find/create hatchery_batches header once
      let headerId: string | null = null;
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

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const q = Number(r.qty);
        const cust = customers.find((c: any) => c.id === r.customer_id);
        const refId = `late_egg_addition_${opNo}_${r.customer_id}_${r.add_date}_${q}`;

        // Duplicate guard against audit log
        const { data: dup } = await supabase
          .from("hatch_batch_edit_audit")
          .select("id")
          .contains("changes", { reference_id: refId } as any)
          .limit(1)
          .maybeSingle();
        if (dup) {
          report.skipped += 1;
          report.details.push(`تم تسجيل هذه الإضافة لـ ${cust?.name} من قبل`);
          continue;
        }

        try {
          const ownerType = cust?.customer_type === "internal" ? "capital_ostrich" : "external_client";
          const { data: lot, error: lotErr } = await supabase
            .from("hatchery_batch_lots" as any)
            .insert({
              batch_id: headerId,
              owner_type: ownerType,
              source: r.source || (ownerType === "capital_ostrich" ? "mother_farm" : "external"),
              eggs_in: q,
              client_id: ownerType === "external_client" ? r.customer_id : null,
              client_name_snapshot: cust?.name || null,
            })
            .select()
            .single();
          if (lotErr) throw lotErr;

          const existing = findExisting(r.customer_id);
          let mirrorId = existing?.id || null;
          let beforeQty = 0;
          if (mirrorId) {
            const before = existing._raw || {};
            beforeQty = before.received_eggs || 0;
            const newReceived = (before.received_eggs || 0) + q;
            const newNet = (before.net_eggs || 0) + q;
            const { error: uErr } = await supabase
              .from("hatch_batches")
              .update({
                received_eggs: newReceived,
                net_eggs: newNet,
                notes: r.notes
                  ? `${before.notes ? before.notes + "\n" : ""}+${q} بيضة متأخرة بتاريخ ${r.add_date} — ${r.notes}`
                  : before.notes,
              })
              .eq("id", mirrorId);
            if (uErr) throw uErr;
          } else {
            const ts = Date.now() + i;
            const { data: ins, error: iErr } = await supabase
              .from("hatch_batches")
              .insert({
                batch_number: `HB-${String(opNo).padStart(5, "0")}-${ts}`,
                operational_batch_no: opNo,
                receive_date: r.add_date,
                entry_date: entryDate,
                machine,
                received_eggs: q,
                net_eggs: q,
                customer_id: r.customer_id,
                status: "pending",
                notes: r.notes || `بيض متأخر مضاف بتاريخ ${r.add_date}`,
                created_by: userId,
                is_test: false,
              } as any)
              .select("id")
              .single();
            if (iErr) throw iErr;
            mirrorId = (ins as any).id;
          }

          await supabase.from("hatch_batch_edit_audit").insert({
            batch_id: mirrorId,
            batch_number: existing?.batch_number || null,
            operational_batch_no: opNo,
            customer_id: r.customer_id,
            customer_name: cust?.name || null,
            actor_id: userId,
            actor_name: profile?.full_name || user?.email || null,
            changes: {
              action: "late_eggs_added",
              reference_id: refId,
              batch_operation_id: batchOperationId,
              eggs_added: q,
              eggs_before: beforeQty,
              eggs_after: beforeQty + q,
              add_date: r.add_date,
              source: r.source,
              lot_id: (lot as any).id,
              header_id: headerId,
              notes: r.notes,
            },
            reason: r.reason?.trim() || "إضافة بيض متأخر للدفعة",
          });

          await supabase.from("hatchery_batch_movements" as any).insert({
            batch_id: headerId,
            lot_id: (lot as any).id,
            event_type: "created",
            payload: {
              kind: "late_eggs_added",
              operational_batch_no: opNo,
              batch_operation_id: batchOperationId,
              customer_id: r.customer_id,
              customer_name: cust?.name,
              eggs_added: q,
              eggs_before: beforeQty,
              eggs_after: beforeQty + q,
              add_date: r.add_date,
              reference_id: refId,
            },
            created_by: userId,
          });

          report.ok += 1;
        } catch (e: any) {
          report.failed += 1;
          report.details.push(`فشل ${cust?.name}: ${e?.message || "خطأ"}`);
        }
      }

      if (report.ok > 0) {
        toast.success(`تمت إضافة ${report.ok} عميل بإجمالي ${addedTotal} بيضة`);
      }
      if (report.skipped > 0) toast.warning(`تم تخطي ${report.skipped} (مكرر سابقًا)`);
      if (report.failed > 0) toast.error(`فشل ${report.failed} صف`);
      if (report.ok > 0) {
        onSaved?.();
        onClose();
      }
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
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Plus className="w-5 h-5 text-purple-600" />
            إضافة بيض للدفعة — {group?.op_number}
            <span className="text-xs text-muted-foreground mr-2">
              إجمالي الدفعة الحالي: <b>{totalBefore}</b>
            </span>
          </DialogTitle>
        </DialogHeader>

        {locked && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 flex items-start gap-2">
            <Lock className="w-4 h-4 mt-0.5" />
            <div>لا يمكن إضافة بيض على دفعة مقفلة أو تم تسجيل نتيجة فقس لها.</div>
          </div>
        )}

        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead className="min-w-[180px]">العميل *</TableHead>
                <TableHead className="w-24">الكمية *</TableHead>
                <TableHead className="w-36">تاريخ الإضافة</TableHead>
                <TableHead className="w-32">المصدر</TableHead>
                <TableHead>ملاحظات</TableHead>
                <TableHead>سبب الإضافة</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const existing = r.customer_id ? findExisting(r.customer_id) : null;
                return (
                  <TableRow key={i}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Select
                          value={r.customer_id}
                          onValueChange={(v) => setRow(i, { customer_id: v })}
                          disabled={locked}
                        >
                          <SelectTrigger><SelectValue placeholder="اختر العميل" /></SelectTrigger>
                          <SelectContent>
                            {customers.map((c: any) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name} {c.customer_type === "internal" ? "(عاصمة)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="icon"
                          variant="outline"
                          type="button"
                          onClick={() => setQuickAddForRow(i)}
                          disabled={locked}
                          title="إضافة عميل جديد"
                          className="shrink-0 h-9 w-9 text-purple-700 hover:bg-purple-50"
                        >
                          <UserPlus className="w-4 h-4" />
                        </Button>
                      </div>
                      {existing && (
                        <div className="text-[10px] text-emerald-700 mt-0.5">
                          موجود: {existing.total_eggs} بيضة (سيُزاد)
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        value={r.qty}
                        onChange={(e) => setRow(i, { qty: e.target.value })}
                        disabled={locked}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="date"
                        value={r.add_date}
                        onChange={(e) => setRow(i, { add_date: e.target.value })}
                        disabled={locked}
                      />
                    </TableCell>
                    <TableCell>
                      <Select value={r.source} onValueChange={(v) => setRow(i, { source: v })} disabled={locked}>
                        <SelectTrigger /><SelectContent>
                          <SelectItem value="mother_farm">مزرعة الأمهات</SelectItem>
                          <SelectItem value="external">عميل خارجي</SelectItem>
                          <SelectItem value="other">أخرى</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Textarea
                        rows={1}
                        value={r.notes}
                        onChange={(e) => setRow(i, { notes: e.target.value })}
                        disabled={locked}
                        className="min-h-[36px]"
                      />
                    </TableCell>
                    <TableCell>
                      <Textarea
                        rows={1}
                        value={r.reason}
                        onChange={(e) => setRow(i, { reason: e.target.value })}
                        disabled={locked}
                        className="min-h-[36px]"
                        placeholder="سبب الإضافة"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeRow(i)}
                        disabled={rows.length === 1 || locked}
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={addRow} disabled={locked}>
            <Plus className="w-4 h-4 ml-1" /> إضافة عميل آخر
          </Button>
          <div className="text-sm bg-slate-50 border rounded px-3 py-1.5">
            عدد العملاء المضافين: <b>{rows.length}</b> &nbsp;|&nbsp;
            إجمالي البيض المضاف: <b className="text-purple-700">{addedTotal}</b> &nbsp;|&nbsp;
            إجمالي الدفعة بعد الحفظ: <b className="text-emerald-700">{totalBefore + addedTotal}</b>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            <X className="w-4 h-4 ml-1" /> إلغاء
          </Button>
          <Button
            onClick={save}
            disabled={saving || locked || addedTotal === 0}
            className="bg-purple-600 hover:bg-purple-700"
          >
            <Save className="w-4 h-4 ml-1" /> {saving ? "جاري الحفظ..." : `حفظ (${rows.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
