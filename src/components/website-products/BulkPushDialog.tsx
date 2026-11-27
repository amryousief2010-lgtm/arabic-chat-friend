import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";
import {
  BULK_SKIP_LABELS,
  type BulkCandidate,
  type BulkSkipReason,
  bulkPreviewIssue,
  formatEgp,
  formatNum,
  sellingPriceAfter,
  syncErrorMessage,
} from "@/lib/websiteProducts";
import { callSync } from "./sync";
import { BRAND, TypeBadge } from "./shared";

interface PushPreview {
  changes: { field: string; before: string | null; after: string }[];
  warnings: string[];
  token: string;
  keys_configured: boolean;
  woo_product_id?: number | null;
  before?: { regular_price?: string | null; sale_price?: string | null } | null;
  after?: { regular_price?: string | null; sale_price?: string | null } | null;
}

type ItemStatus = "pending" | "ready" | "skipped" | "applying" | "applied" | "failed";

interface BulkItem {
  c: BulkCandidate;
  status: ItemStatus;
  newPrice: number | null;
  token: string | null;
  note: string | null;
}

type Phase = "preparing" | "review" | "applying" | "done";

const PREVIEW_CONCURRENCY = 3;

/**
 * «نشر كل الفروق»: يعاين كل فرق بنفس منطق التحديث الفردي (preview)، ثم يعرض القائمة
 * (المنتج، سعر الموقع الحالي، السعر الجديد)، ولا يكتب على الموقع إلا بعد التأكيد (apply بنفس الرمز).
 * يُستبعد أي بند يغيّر حقولاً غير السعر حتى لا يتغير وصف العرض أو فئة الشحن.
 */
export function BulkPushDialog({ candidates, onClose, onDone }: { candidates: BulkCandidate[]; onClose: () => void; onDone: () => void }) {
  const [items, setItems] = useState<BulkItem[]>(() =>
    candidates.map((c) => ({
      c,
      status: c.skip ? "skipped" : "pending",
      newPrice: c.skip ? null : c.expectedPrice,
      token: null,
      note: c.skip ? BULK_SKIP_LABELS[c.skip] : null,
    })),
  );
  const [phase, setPhase] = useState<Phase>("preparing");
  const [progress, setProgress] = useState(0);
  const started = useRef(false);
  const wroteAny = useRef(false);

  const update = (i: number, patch: Partial<BulkItem>) => setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const queue = candidates.map((c, i) => ({ c, i })).filter(({ c }) => !c.skip);
    let done = 0;
    const worker = async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        const { c, i } = next;
        const { data, error } = await callSync<PushPreview>({
          action: "preview",
          mode: "update",
          target: c.target,
          woo_product_id: c.row.site.woo_product_id,
        });
        if (error || !data) {
          update(i, { status: "skipped", note: `${BULK_SKIP_LABELS.preview_failed}: ${syncErrorMessage(error)}` });
        } else {
          const issue: BulkSkipReason | null = bulkPreviewIssue(data);
          const newPrice = sellingPriceAfter(data.after, data.before) ?? c.expectedPrice;
          if (issue) update(i, { status: "skipped", newPrice, note: BULK_SKIP_LABELS[issue] });
          else update(i, { status: "ready", newPrice, token: data.token, note: null });
        }
        done += 1;
        setProgress(done);
      }
    };
    void Promise.all(Array.from({ length: Math.min(PREVIEW_CONCURRENCY, queue.length) }, worker)).then(() => setPhase("review"));
  }, [candidates]);

  const ready = items.filter((it) => it.status === "ready");
  const toPreview = candidates.filter((c) => !c.skip).length;
  const applied = items.filter((it) => it.status === "applied").length;
  const failed = items.filter((it) => it.status === "failed").length;
  const skipped = items.filter((it) => it.status === "skipped").length;

  const applyAll = async () => {
    setPhase("applying");
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.status !== "ready" || !it.token) continue;
      update(i, { status: "applying" });
      const r = await callSync<{ warning?: string }>({
        action: "apply",
        mode: "update",
        target: it.c.target,
        woo_product_id: it.c.row.site.woo_product_id,
        token: it.token,
      });
      if (r.error) update(i, { status: "failed", note: syncErrorMessage(r.error) });
      else {
        wroteAny.current = true;
        update(i, { status: "applied", note: null });
      }
    }
    setPhase("done");
  };

  const close = () => {
    if (phase === "applying") return;
    if (wroteAny.current) onDone();
    else onClose();
  };

  const statusCell = (it: BulkItem) => {
    switch (it.status) {
      case "pending":
        return <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />جارٍ المعاينة</span>;
      case "ready":
        return <Badge variant="outline" style={{ borderColor: BRAND.deep, color: BRAND.deep }}>جاهز للنشر</Badge>;
      case "applying":
        return <span className="inline-flex items-center gap-1" style={{ color: BRAND.deep }}><Loader2 className="w-3.5 h-3.5 animate-spin" />جارٍ النشر</span>;
      case "applied":
        return <Badge className="border-0 bg-emerald-600 text-white gap-1"><CheckCircle2 className="w-3 h-3" />تم النشر</Badge>;
      case "failed":
        return (
          <div className="space-y-1">
            <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />فشل</Badge>
            {it.note && <p className="text-[11px] text-destructive leading-snug">{it.note}</p>}
          </div>
        );
      default:
        return (
          <div className="space-y-1">
            <Badge variant="outline" className="border-amber-500 text-amber-700">مستبعد</Badge>
            {it.note && <p className="text-[11px] text-muted-foreground leading-snug">{it.note}</p>}
          </div>
        );
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent dir="rtl" className="font-cairo max-w-3xl max-h-[90dvh] overflow-hidden flex flex-col gap-3 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle style={{ color: BRAND.deep }}>نشر كل فروق الأسعار على الموقع</DialogTitle>
          <DialogDescription>
            يُحدَّث سعر كل منتج على الموقع إلى السعر المتوقع من <bdi dir="ltr">COCEG</bdi> (سعر الوحدة × وزن العبوة، وسعر العرض كما هو دون تغيير الشحن). لن يتغير شيء قبل التأكيد.
          </DialogDescription>
        </DialogHeader>

        {phase === "preparing" && (
          <div className="rounded-xl border px-4 py-3 text-sm flex items-center gap-2" style={{ borderColor: BRAND.deep, color: BRAND.deep }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            جارٍ تجهيز المعاينة {formatNum(progress)} من {formatNum(toPreview)}…
          </div>
        )}
        {phase !== "preparing" && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" style={{ borderColor: BRAND.deep, color: BRAND.deep }}>جاهز: {formatNum(ready.length + applied + failed)}</Badge>
            {skipped > 0 && <Badge variant="outline" className="border-amber-500 text-amber-700">مستبعد: {formatNum(skipped)}</Badge>}
            {phase === "done" && <Badge className="border-0 bg-emerald-600 text-white">تم النشر: {formatNum(applied)}</Badge>}
            {phase === "done" && failed > 0 && <Badge variant="destructive">فشل: {formatNum(failed)}</Badge>}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pe-0.5 pb-2">
          <Table dir="rtl">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">المنتج</TableHead>
                <TableHead className="text-right whitespace-nowrap">سعر الموقع الحالي</TableHead>
                <TableHead className="text-right whitespace-nowrap">السعر الجديد</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={`${it.c.target.kind}:${it.c.target.id}:${it.c.row.site.woo_product_id}`}>
                  <TableCell>
                    <div className="font-medium leading-snug">{it.c.label}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <TypeBadge isBox={it.c.target.kind === "offer_box"} />
                      <bdi dir="ltr">#{formatNum(it.c.row.site.woo_product_id)}</bdi>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatEgp(it.c.sitePrice)}</TableCell>
                  <TableCell className="whitespace-nowrap font-bold" style={{ color: BRAND.primary }}>{formatEgp(it.newPrice)}</TableCell>
                  <TableCell className="min-w-40">{statusCell(it)}</TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">لا توجد فروق أسعار</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {phase === "review" && ready.length === 0 && items.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>لا توجد بنود جاهزة للنشر الجماعي. راجع أسباب الاستبعاد ونفّذ التحديث فردياً من بطاقة كل منتج.</span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {phase === "review" && (
            <Button onClick={() => void applyAll()} disabled={!ready.length} style={{ backgroundColor: BRAND.accent }} className="gap-2 rounded-xl text-white hover:opacity-95">
              <Upload className="w-4 h-4" />
              تأكيد النشر على الموقع ({formatNum(ready.length)})
            </Button>
          )}
          <Button variant="outline" className="rounded-xl" onClick={close} disabled={phase === "applying"}>
            {phase === "done" ? "إغلاق" : "إلغاء"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
