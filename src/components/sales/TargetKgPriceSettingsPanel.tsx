import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useKgPrices } from "@/hooks/useKgPrices";
import {
  type KgPriceKind,
  arabicMonthLabel,
  formatEffectiveMonth,
  monthStartIso,
  priceKindLabel,
} from "@/lib/kgPrices";
import { currentCairoYearMonth } from "@/lib/cairoDate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const MANAGER_ROLES = new Set([
  "general_manager",
  "executive_manager",
  "sales_manager",
  "marketing_sales_manager",
]);

const KINDS: { kind: KgPriceKind; title: string; field: "processed_price" | "meat_price" | "bone_meat_price" }[] = [
  { kind: "processed", title: "سعر كيلو المصنعات", field: "processed_price" },
  { kind: "meat", title: "سعر كيلو اللحوم", field: "meat_price" },
  { kind: "bone_meat", title: "سعر كيلو اللحوم بالعظم", field: "bone_meat_price" },
];

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function currentPriceForKind(
  versions: { effective_from: string; meat_price: number; bone_meat_price: number; processed_price: number }[],
  kind: KgPriceKind,
  fallback: number,
  fallbackFrom: string,
) {
  const field = kind === "processed" ? "processed_price" : kind === "meat" ? "meat_price" : "bone_meat_price";
  const today = new Date();
  const start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const sorted = [...versions].sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  const match = sorted.find((v) => v.effective_from <= start);
  if (!match) return { value: fallback, from: fallbackFrom };
  return { value: Number(match[field]), from: match.effective_from };
}

export default function TargetKgPriceSettingsPanel() {
  const { role } = useAuth();
  if (!role || !MANAGER_ROLES.has(role)) return null;
  return <PanelBody />;
}

function PanelBody() {
  const cur = currentCairoYearMonth();
  const { prices, effectiveFrom, versions, savePriceVersion, isSaving } = useKgPrices({
    year: cur.year,
    month: cur.monthIndex0 + 1,
  });
  const [drafts, setDrafts] = useState<Record<KgPriceKind, { price: string; year: number; month: number }>>({
    processed: { price: "", year: cur.year, month: cur.monthIndex0 + 1 },
    meat: { price: "", year: cur.year, month: cur.monthIndex0 + 1 },
    bone_meat: { price: "", year: cur.year, month: cur.monthIndex0 + 1 },
  });
  const [historyFor, setHistoryFor] = useState<KgPriceKind | null>(null);
  const [pending, setPending] = useState<{
    kind: KgPriceKind;
    price: number;
    effectiveFrom: string;
    replaceSameDate: boolean;
  } | null>(null);

  const historyRows = useMemo(() => {
    if (!historyFor) return [];
    const field =
      historyFor === "processed" ? "processed_price" : historyFor === "meat" ? "meat_price" : "bone_meat_price";
    return [...versions]
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))
      .map((v) => ({
        from: v.effective_from,
        to: v.effective_to,
        value: Number(v[field]),
      }));
  }, [historyFor, versions]);

  const askSave = (kind: KgPriceKind) => {
    const draft = drafts[kind];
    const price = Number(draft.price);
    if (!draft.price || Number.isNaN(price) || price < 0) {
      toast.error("أدخل سعرًا صحيحًا");
      return;
    }
    if (!draft.year || !draft.month) {
      toast.error("حدد شهر بداية السريان");
      return;
    }
    const effective = monthStartIso(draft.year, draft.month);
    const exists = versions.some((v) => String(v.effective_from).slice(0, 10) === effective);
    setPending({ kind, price, effectiveFrom: effective, replaceSameDate: exists });
  };

  const confirmSave = async () => {
    if (!pending) return;
    try {
      await savePriceVersion({
        kind: pending.kind,
        price: pending.price,
        effectiveFrom: pending.effectiveFrom,
        replaceSameDate: pending.replaceSameDate,
      });
      toast.success("تم حفظ السعر وتحديث حسابات التارجت");
      setDrafts((d) => ({ ...d, [pending.kind]: { ...d[pending.kind], price: "" } }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "تعذر حفظ السعر";
      toast.error(msg);
    } finally {
      setPending(null);
    }
  };

  return (
    <Card dir="rtl" className="border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">إعدادات أسعار التارجت</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {KINDS.map(({ kind, title, field }) => {
          const current = currentPriceForKind(versions, kind, Number(prices[field]), effectiveFrom);
          const draft = drafts[kind];
          return (
            <div key={kind} className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-muted-foreground">
                  السعر الحالي: <span className="font-medium text-foreground">{current.value.toLocaleString()} ج.م</span>
                  {" · "}بداية السريان: {formatEffectiveMonth(current.from)}
                </p>
              </div>
              <div className="space-y-1">
                <Label>السعر الجديد (ج.م)</Label>
                <Input
                  type="number"
                  min="0"
                  value={draft.price}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [kind]: { ...d[kind], price: e.target.value } }))
                  }
                  placeholder="أدخل السعر الجديد"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>شهر السريان</Label>
                  <Select
                    value={String(draft.month)}
                    onValueChange={(v) =>
                      setDrafts((d) => ({ ...d, [kind]: { ...d[kind], month: Number(v) } }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {arabicMonthLabel(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>السنة</Label>
                  <Select
                    value={String(draft.year)}
                    onValueChange={(v) =>
                      setDrafts((d) => ({ ...d, [kind]: { ...d[kind], year: Number(v) } }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[cur.year - 1, cur.year, cur.year + 1, cur.year + 2].map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" disabled={isSaving} onClick={() => askSave(kind)}>
                  حفظ السعر
                </Button>
                <Button type="button" variant="outline" onClick={() => setHistoryFor(kind)}>
                  سجل الأسعار
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد سعر التارجت</AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? pending.replaceSameDate
                  ? `يوجد سجل لنفس تاريخ السريان. سيتم استبدال سجل ${priceKindLabel(pending.kind)} بقيمة ${pending.price} جنيهًا بدايةً من ${formatEffectiveMonth(pending.effectiveFrom)} على هذا الشهر والشهور التالية، ولن تتغير حسابات الشهور السابقة.`
                  : `سيتم تطبيق سعر ${priceKindLabel(pending.kind)} بقيمة ${pending.price} جنيهًا بدايةً من ${formatEffectiveMonth(pending.effectiveFrom)} على هذا الشهر والشهور التالية، ولن تتغير حسابات الشهور السابقة.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSave}>تأكيد الحفظ</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!historyFor} onOpenChange={(open) => !open && setHistoryFor(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              سجل أسعار {historyFor ? priceKindLabel(historyFor) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                {historyRows.length === 0 && <p>لا توجد سجلات.</p>}
                {historyRows.map((r) => (
                  <p key={r.from}>
                    من {formatEffectiveMonth(r.from)}
                    {r.to ? ` حتى ${formatEffectiveMonth(r.to)}` : " وما بعده"}: {r.value.toLocaleString()} ج.م
                  </p>
                ))}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>إغلاق</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
