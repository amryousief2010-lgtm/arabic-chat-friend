import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  batchId: string | null;
  open: boolean;
  onClose: () => void;
  onCancelled?: () => void;
}

export function CancelFeedBatchDialog({ batchId, open, onClose, onCancelled }: Props) {
  const { roles } = useAuth();
  const isTopManager = roles.includes("general_manager") || roles.includes("executive_manager");

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [reason, setReason] = useState("");
  const [forcePartial, setForcePartial] = useState(false);

  useEffect(() => {
    if (!open || !batchId) return;
    setReason(""); setForcePartial(false); setPreview(null);
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("feed_batch_cancel_preview" as any, { p_batch_id: batchId });
      setLoading(false);
      if (error) { toast.error(error.message); return; }
      setPreview(data);
    })();
  }, [open, batchId]);

  const submit = async () => {
    if (!batchId) return;
    if (reason.trim().length < 3) { toast.error("سبب الإلغاء مطلوب (3 أحرف على الأقل)"); return; }
    const shortage = Number(preview?.shortage || 0);
    if (shortage > 0 && !forcePartial) {
      toast.error("المنتج النهائي غير متوفر بالكامل — يجب موافقة المدير");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("feed_batch_cancel" as any, {
      p_batch_id: batchId, p_reason: reason.trim(), p_force: forcePartial,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const res: any = data;
    toast.success(
      res?.partial
        ? `تم الإلغاء جزئياً: رجعت ${res.raw_lines_reversed} خامة وخصم ${Number(res.finished_deducted).toFixed(2)} من المنتج`
        : `تم إلغاء الفاتورة وعكس ${res?.raw_lines_reversed || 0} خامة وخصم ${Number(res?.finished_deducted || 0).toFixed(2)} من المنتج`
    );
    onCancelled?.(); onClose();
  };

  const shortage = Number(preview?.shortage || 0);
  const posted = !!preview?.posted_to_inventory;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> إلغاء فاتورة تصنيع
          </DialogTitle>
          <DialogDescription>
            مراجعة تأثير الإلغاء على المخزون قبل التأكيد. لا يتم حذف الفاتورة، فقط تتحول إلى ملغاة مع عكس حركات المخزون.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل المعاينة...
          </div>
        ) : preview ? (
          <div className="space-y-4">
            <div className="rounded-md border p-3 bg-muted/30 grid grid-cols-2 gap-2 text-sm">
              <div><b>رقم الفاتورة:</b> {preview.batch_number || "—"}</div>
              <div><b>الحالة الحالية:</b> <Badge variant="outline">{preview.status}</Badge></div>
              <div><b>المنتج النهائي:</b> {preview.product_name || "—"}</div>
              <div><b>الكمية المنتجة:</b> {Number(preview.produced_quantity || 0).toFixed(2)} كجم</div>
              <div><b>الرصيد الحالي:</b> {Number(preview.product_current_stock || 0).toFixed(2)} كجم</div>
              <div>
                <b>ترحيل المخزون:</b>{" "}
                {posted ? <Badge>تم الترحيل — سيتم العكس</Badge> : <Badge variant="secondary">لم يُرحَّل — لن يُلمس المخزون</Badge>}
              </div>
            </div>

            {posted && shortage > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm space-y-2">
                <div className="flex items-center gap-2 text-destructive font-semibold">
                  <AlertTriangle className="h-4 w-4" /> عجز في المنتج النهائي
                </div>
                <div>
                  المنتج النهائي تم صرف/بيع جزء منه. العجز: <b>{shortage.toFixed(2)} كجم</b>.
                </div>
                <div>
                  لا يمكن الإلغاء التلقائي الكامل. {isTopManager
                    ? "بصفتك مدير، يمكنك تنفيذ إلغاء جزئي (خصم المتاح فقط)."
                    : "هذا الإلغاء يحتاج موافقة المدير العام أو المدير التنفيذي."}
                </div>
                {isTopManager && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={forcePartial} onChange={(e) => setForcePartial(e.target.checked)} />
                    <span>تنفيذ إلغاء جزئي (خصم المتاح فقط، الباقي يحتاج تسوية لاحقة)</span>
                  </label>
                )}
              </div>
            )}

            {posted && Array.isArray(preview.raw_materials_to_return) && preview.raw_materials_to_return.length > 0 && (
              <div>
                <div className="text-sm font-semibold mb-2">الخامات التي سترجع للمخزون</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الخامة</TableHead>
                      <TableHead>الكمية الراجعة</TableHead>
                      <TableHead>الرصيد الحالي</TableHead>
                      <TableHead>بعد الإرجاع</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.raw_materials_to_return.map((r: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell>{Number(r.quantity).toFixed(2)} {r.unit}</TableCell>
                        <TableCell>{Number(r.current_stock || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-green-700 font-medium">
                          {(Number(r.current_stock || 0) + Number(r.quantity)).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div>
              <Label htmlFor="cancel-reason" className="text-sm">سبب الإلغاء *</Label>
              <Textarea
                id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="اكتب سبب الإلغاء بوضوح..." rows={3} className="mt-1"
              />
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>تراجع</Button>
          <Button
            variant="destructive" onClick={submit}
            disabled={busy || loading || !preview || reason.trim().length < 3 || (shortage > 0 && !forcePartial)}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
            تأكيد الإلغاء وعكس المخزون
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
