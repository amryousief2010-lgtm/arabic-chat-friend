import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

type Diff = {
  item_id: string;
  product_name: string;
  quantity: number;
  current_unit_price: number;
  current_total_price: number;
  expected_unit_price: number;
  expected_total_price: number;
  is_gift: boolean;
};

type Affected = {
  order_id: string;
  order_number: string;
  offer_name: string;
  offer_price: number;
  order_total: number;
  customer_name: string;
  customer_phone: string;
  diffs: Diff[];
  unmatched: { id: string; product_name: string; unit_price: number }[];
};

type PreviewResult = {
  totalOrders: number;
  affected: Affected[];
  summary: {
    affectedCount: number;
    applied?: number;
    byOffer: Record<string, { orders: number; itemsCorrected: number; unmatched: number }>;
    updateErrors?: { item_id: string; message: string }[];
    updateErrorsCount?: number;
  };
};

export default function OfferBoxPricingAudit() {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const correctable = result?.affected.filter((a) => a.diffs.length > 0) ?? [];
  const onlyMislabeled = result?.affected.filter((a) => a.diffs.length === 0 && a.unmatched.length > 0) ?? [];

  const run = async (mode: "preview" | "apply") => {
    if (mode === "apply") setApplying(true); else setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("audit-offer-box-pricing", {
        body: { mode },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResult(data as PreviewResult);
      const corr = (data.affected as Affected[]).filter((a) => a.diffs.length > 0).length;
      const mis = (data.affected as Affected[]).filter((a) => a.diffs.length === 0 && a.unmatched.length > 0).length;
      if (mode === "apply") {
        toast.success(`تم تصحيح ${data.summary.applied} عنصر — ${mis} طلب اسمه بوكس لكن منتجاته مش من البوكس (لم يتم المساس بها)`);
      } else {
        toast.success(`فحص ${data.totalOrders} طلب: ${corr} للتصحيح فعلياً، ${mis} اسم بوكس فقط (منتجات مختلفة)`);
      }
    } catch (e: any) {
      toast.error(e.message || "فشل التشغيل");
    } finally {
      setLoading(false);
      setApplying(false);
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">تدقيق أسعار البوكسات (الاستيراد)</h1>
          <p className="text-muted-foreground text-sm mt-1">
            يقارن الطلبات المُستوردة من Excel التي تحتوي عرضًا (بوكس) مع أسعار البوكس المعتمدة، ويعرض الفروق قبل التطبيق.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => run("preview")} disabled={loading || applying}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin ms-1" /> : null}
            معاينة الفروق
          </Button>
          <Button
            variant="destructive"
            disabled={!result || correctable.length === 0 || applying || loading}
            onClick={() => {
              if (confirm("سيتم تصحيح أسعار عناصر الطلبات المعروضة فقط. لن يتم تعديل أي بيانات أخرى (الكميات، الإجمالي، العميل، الحالة). متابعة؟")) {
                run("apply");
              }
            }}
          >
            {applying ? <Loader2 className="w-4 h-4 animate-spin ms-1" /> : null}
            تطبيق التصحيح
          </Button>
        </div>
      </div>

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>حماية البيانات</AlertTitle>
        <AlertDescription>
          هذه الأداة تُعدّل فقط <strong>سعر الوحدة وإجمالي العنصر</strong> داخل عناصر الطلبات التي يتطابق اسم العرض فيها مع اسم بوكس مُسجّل. لا تُغيّر الكميات، ولا الإجماليات، ولا الهدايا (تبقى بسعر 0)، ولا أي طلب عادي لا يحتوي بوكس.
        </AlertDescription>
      </Alert>

      {result && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>ملخّص</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="إجمالي الطلبات المفحوصة" value={result.totalOrders} />
                <Stat label="طلبات للتصحيح فعلياً" value={correctable.length} />
                <Stat label="اسم بوكس فقط (منتجات مختلفة)" value={onlyMislabeled.length} />
                {typeof result.summary.applied === "number" && (
                  <Stat label="عناصر تم تصحيحها" value={result.summary.applied} />
                )}
              </div>
              {Object.keys(result.summary.byOffer).length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>اسم العرض</TableHead>
                      <TableHead>عدد الطلبات</TableHead>
                      <TableHead>عناصر للتصحيح</TableHead>
                      <TableHead>منتجات غير مطابقة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(result.summary.byOffer).map(([n, s]) => (
                      <TableRow key={n}>
                        <TableCell className="font-semibold">{n}</TableCell>
                        <TableCell>{s.orders}</TableCell>
                        <TableCell>{s.itemsCorrected}</TableCell>
                        <TableCell>
                          {s.unmatched > 0 ? (
                            <Badge variant="destructive">{s.unmatched}</Badge>
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>الطلبات ({result.affected.length}) — منها {correctable.length} للتصحيح فعلياً</CardTitle>
              {onlyMislabeled.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {onlyMislabeled.length} طلب اسم العرض فيه "بوكس" لكن المنتجات داخله لا تنتمي لتكوين البوكس (مثلاً منتجات نعام كاملة). لن يتم المساس بأسعارها — يلزم مراجعة يدوية لتصحيح اسم العرض في الاستيراد.
                </p>
              )}
            </CardHeader>
            <CardContent>
              {result.affected.length === 0 ? (
                <p className="text-muted-foreground text-sm">لا توجد فروق — جميع أسعار البوكسات صحيحة.</p>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-auto">
                  {result.affected.slice(0, 200).map((a) => {
                    const open = !!expanded[a.order_id];
                    return (
                      <div key={a.order_id} className="border rounded-md">
                        <button
                          type="button"
                          className="w-full flex flex-wrap items-center justify-between gap-2 p-3 text-start hover:bg-muted/40"
                          onClick={() => setExpanded({ ...expanded, [a.order_id]: !open })}
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-xs">{a.order_number}</span>
                            <Badge>{a.offer_name}</Badge>
                            <span className="text-sm">{a.customer_name}</span>
                            <span className="text-xs text-muted-foreground">{a.customer_phone}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span>الإجمالي: {a.order_total.toLocaleString()}</span>
                            <span className="text-muted-foreground">/ سعر العرض: {a.offer_price.toLocaleString()}</span>
                            <Badge variant="secondary">{a.diffs.length} عنصر للتصحيح</Badge>
                            {a.unmatched.length > 0 && (
                              <Badge variant="destructive">{a.unmatched.length} غير مطابق</Badge>
                            )}
                          </div>
                        </button>
                        {open && (
                          <div className="border-t p-3">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>المنتج</TableHead>
                                  <TableHead>الكمية</TableHead>
                                  <TableHead>سعر الوحدة الحالي</TableHead>
                                  <TableHead>السعر المتوقع</TableHead>
                                  <TableHead>الإجمالي الحالي</TableHead>
                                  <TableHead>الإجمالي المتوقع</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {a.diffs.map((d) => (
                                  <TableRow key={d.item_id}>
                                    <TableCell>
                                      {d.product_name}
                                      {d.is_gift && <Badge variant="outline" className="ms-2">هدية</Badge>}
                                    </TableCell>
                                    <TableCell>{d.quantity}</TableCell>
                                    <TableCell className="text-destructive">{d.current_unit_price.toLocaleString()}</TableCell>
                                    <TableCell className="text-green-700 font-semibold">{d.expected_unit_price.toLocaleString()}</TableCell>
                                    <TableCell className="text-destructive">{d.current_total_price.toLocaleString()}</TableCell>
                                    <TableCell className="text-green-700 font-semibold">{d.expected_total_price.toLocaleString()}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                            {a.unmatched.length > 0 && (
                              <Alert variant="destructive" className="mt-3">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle>منتجات غير موجودة في تكوين البوكس</AlertTitle>
                                <AlertDescription>
                                  {a.unmatched.map((u) => u.product_name).join("، ")} — ستبقى دون تعديل.
                                </AlertDescription>
                              </Alert>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {result.affected.length > 200 && (
                    <p className="text-xs text-muted-foreground">يتم عرض أول 200 طلب فقط — التطبيق سيشمل كل الطلبات.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
    </div>
  );
}
