import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type LegacyDocType = "meat_manufacturing_invoice" | "warehouse_transfer";

const CAP = 100;

export function useCanCloseLegacyByStocktake() {
  const { isGeneralManager, isExecutiveManager } = useAuth();
  return isGeneralManager || isExecutiveManager;
}

export function LegacyCloseControls({
  docType,
  selectedIds,
  onDone,
}: {
  docType: LegacyDocType;
  selectedIds: string[];
  onDone: () => void;
}) {
  const allowed = useCanCloseLegacyByStocktake();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!allowed) return null;

  const overCap = selectedIds.length > CAP;

  const confirm = async () => {
    const text = reason.trim();
    if (selectedIds.length === 0 || selectedIds.length > CAP || text.length < 3) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc("close_legacy_docs_by_stocktake", {
      p_doc_type: docType,
      p_doc_ids: selectedIds,
      p_reason: text,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "تعذّر الإغلاق");
      return;
    }
    toast.success("أُغلقت المستندات بالجرد دون حركة مخزون");
    setOpen(false);
    setReason("");
    onDone();
  };

  return (
    <>
      <Button
        variant="outline"
        disabled={selectedIds.length === 0 || overCap}
        onClick={() => setOpen(true)}
      >
        إغلاق المحدد بالجرد ({selectedIds.length})
      </Button>
      {overCap && <span className="text-sm text-destructive">الحد 100 مستنداً</span>}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>إغلاق بالجرد بدون حركة مخزون</AlertDialogTitle>
            <AlertDialogDescription>
              سيُغلق {selectedIds.length} مستند بحالة «أُغلق بالجرد». لن تُنشأ حركة مخزون ولن يتغير الرصيد. هذا للمستندات الأقدم من جرد 30 سبتمبر 2026 المعتمد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
            placeholder="سبب الإغلاق (٣ حروف على الأقل)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>تراجع</AlertDialogCancel>
            <Button disabled={busy || reason.trim().length < 3} onClick={confirm}>
              {busy ? "جارٍ الإغلاق" : "تأكيد الإغلاق"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function LegacyCloseCheckbox({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const allowed = useCanCloseLegacyByStocktake();
  if (!allowed) return null;
  return <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} />;
}
