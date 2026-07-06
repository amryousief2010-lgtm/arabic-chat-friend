import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  buildProductLookup,
  parseProductText,
  consolidateItems,
  normalizePhone,
  type CatalogProduct,
  type ParsedItem,
} from "@/lib/bosttaDeliveryParser";

interface ParsedShipment {
  bill_no: string;
  shipment_date: string;
  customer_name: string;
  phone: string;
  cod: number;
  raw_products: string;
  items: ParsedItem[];
  unknown_tokens: string[];
}

export function BulkDeliveryUploadButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filename, setFilename] = useState("");
  const [shipments, setShipments] = useState<ParsedShipment[]>([]);
  const [knownPhones, setKnownPhones] = useState<Set<string>>(new Set());
  const [phoneToModerator, setPhoneToModerator] = useState<Map<string, string>>(new Map());
  const [result, setResult] = useState<any>(null);

  const unregistered = shipments.filter((s) => s.phone && !knownPhones.has(s.phone));
  const registered = shipments.filter((s) => s.phone && knownPhones.has(s.phone));
  const readyItems = registered.filter((s) => s.items.length > 0 && s.unknown_tokens.length === 0);
  const withWarnings = registered.filter((s) => s.unknown_tokens.length > 0 && s.items.length > 0);
  // "noItems" = the sheet's products aren't in our catalog. We still deliver
  // the order as-is (customer received and paid) without changing its items.
  const noItems = registered.filter((s) => s.items.length === 0);

  const handleFile = async (file: File) => {
    setLoading(true);
    setFilename(file.name);
    setResult(null);
    try {
      // Fetch catalog
      const { data: productsRaw, error: pErr } = await supabase
        .from("products").select("id, name, unit, price").eq("is_active", true);
      if (pErr) throw pErr;
      const catalog: CatalogProduct[] = (productsRaw || []).map((p: any) => ({
        id: p.id, name: p.name, unit: p.unit || "كيلو", price: Number(p.price || 0),
      }));
      const lookup = buildProductLookup(catalog);

      // Read xlsx
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: null });

      // Detect column names (support both Bostta formats)
      const parsed: ParsedShipment[] = [];
      for (const r of rows) {
        const bill = String(r["رقم البوليصة"] || r["رقم البوليصه"] || "");
        if (!bill.startsWith("ZX")) continue; // skip summary rows

        const phone = normalizePhone(
          r["رقم الموبايل"] ?? r["موبايل 1"] ?? r["رقم الهاتف المرسل اليه"] ?? "",
        );
        const cod = Number(r["COD"] ?? r["مبلغ التحصيل"] ?? 0);
        const name = String(r["المرسل اليه"] || "");
        const dateVal = r["تاريخ انشاء الشحنة"] ?? r["التاريخ"] ?? "";
        const dateStr = dateVal instanceof Date ? dateVal.toISOString() : String(dateVal || "");
        const productText = String(r["اسم المنتج"] || "");

        const parsedProducts = parseProductText(productText, lookup);
        parsed.push({
          bill_no: bill,
          shipment_date: dateStr.slice(0, 10),
          customer_name: name,
          phone,
          cod,
          raw_products: productText,
          items: consolidateItems(parsedProducts.items),
          unknown_tokens: parsedProducts.unknown_tokens,
        });
      }
      setShipments(parsed);

      // Fetch known customer phones + moderator for each phone (from latest order)
      const phones = Array.from(new Set(parsed.map((p) => p.phone).filter(Boolean)));
      const known = new Set<string>();
      const phoneMod = new Map<string, string>();
      if (phones.length > 0) {
        const chunkSize = 500;
        // Map custId -> array of phones (phone + phone2)
        const custIdToPhones = new Map<string, string[]>();
        for (let i = 0; i < phones.length; i += chunkSize) {
          const chunk = phones.slice(i, i + chunkSize);
          const orExpr = `phone.in.(${chunk.join(",")}),phone2.in.(${chunk.join(",")})`;
          const { data: custs } = await supabase
            .from("customers").select("id, phone, phone2").or(orExpr);
          (custs || []).forEach((c: any) => {
            const list: string[] = [];
            if (c.phone) {
              const p = normalizePhone(c.phone);
              known.add(p);
              list.push(p);
            }
            if (c.phone2) {
              const p2 = normalizePhone(c.phone2);
              known.add(p2);
              list.push(p2);
            }
            if (list.length > 0) custIdToPhones.set(c.id, list);
          });
        }
        // Fetch latest moderator per customer
        const custIds: string[] = Array.from(custIdToPhones.keys());
        for (let i = 0; i < custIds.length; i += chunkSize) {
          const chunk = custIds.slice(i, i + chunkSize);
          const { data: ords } = await supabase
            .from("orders")
            .select("customer_id, moderator, created_at")
            .in("customer_id", chunk)
            .not("moderator", "is", null)
            .order("created_at", { ascending: false });
          (ords || []).forEach((o: any) => {
            const list = custIdToPhones.get(o.customer_id) || [];
            list.forEach((p) => {
              if (!phoneMod.has(p)) phoneMod.set(p, o.moderator);
            });
          });
        }
      }
      setKnownPhones(known);
      setPhoneToModerator(phoneMod);

      setOpen(true);
      const missing = parsed.filter((p) => p.phone && !known.has(p.phone)).length;
      toast.success(
        `تم تحليل ${parsed.length} شحنة${missing > 0 ? ` — ${missing} محتاجة تسجيل` : ""}`,
      );
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "فشل قراءة الملف");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      // Send all shipments (with items OR without) — server queues no-item ones too
      const send = shipments.map((s) => ({
        phone: s.phone,
        cod: s.cod,
        bill_no: s.bill_no,
        shipment_date: s.shipment_date,
        customer_name: s.customer_name,
        raw_products: s.raw_products,
        unknown_tokens: s.unknown_tokens,
        items: s.items.map((i) => ({
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          is_gift: i.is_gift,
        })),
      }));

      const { data, error } = await supabase.functions.invoke("process-bostta-delivery", {
        body: { filename, shipments: send },
      });
      if (error) throw error;
      setResult(data?.results ?? null);
      toast.success(`تم تحديث ${data?.results?.updated?.length ?? 0} أوردر بنجاح`);
    } catch (e: any) {
      toast.error(e?.message || "فشل التحديث");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setShipments([]);
    setKnownPhones(new Set());
    setPhoneToModerator(new Map());
    setResult(null);
    setFilename("");
    setOpen(false);
  };

  const copyUnregisteredToClipboard = async () => {
    const lines = unregistered.map((s) => {
      const mod = phoneToModerator.get(s.phone) || "غير معروف";
      return `${s.phone} — ${s.customer_name} — ${s.cod} ج — ${s.raw_products} — البنت: ${mod}`;
    });
    const text = `شحنات محتاجة تسجيل (${unregistered.length}):\n\n${lines.join("\n\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("تم نسخ القائمة — ابعتها للبنات يسجّلوا الأوردرات");
    } catch {
      toast.error("مقدرش أنسخ — اعمل تحديد يدوي");
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      <Button
        variant="outline"
        className="border-blue-500 text-blue-700 hover:bg-blue-50"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
      >
        {loading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Upload className="w-4 h-4 ml-2" />}
        رفع شيت تسليمات شركة الشحن
      </Button>

      <Dialog open={open} onOpenChange={(v) => !v && reset()}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-blue-600" />
              مراجعة شيت تسليمات شركة الشحن — {filename}
            </DialogTitle>
            <DialogDescription>
              راجع الأوردرات قبل التأكيد. المنتجات في الشيت هتحلّ محل منتجات النظام (لو مختلفة) وهيتخصم المخزون من العجوزة.
            </DialogDescription>
          </DialogHeader>

          {!result ? (
            <>
              <div className="grid grid-cols-5 gap-3 mb-4">
                <StatBox label="إجمالي الشحنات" value={shipments.length} color="slate" />
                <StatBox label="محتاجة تسجيل" value={unregistered.length} color="blue" />
                <StatBox label="جاهز للتحديث" value={readyItems.length} color="emerald" />
                <StatBox label="تحذيرات" value={withWarnings.length} color="amber" />
                <StatBox label="متجاهَل" value={skipped.length} color="red" />
              </div>

              <Tabs defaultValue={unregistered.length > 0 ? "unregistered" : "ready"} className="w-full">
                <TabsList>
                  <TabsTrigger value="unregistered" className="data-[state=active]:bg-blue-100">
                    محتاجة تسجيل ({unregistered.length})
                  </TabsTrigger>
                  <TabsTrigger value="ready">جاهز ({readyItems.length})</TabsTrigger>
                  <TabsTrigger value="warnings">تحذيرات ({withWarnings.length})</TabsTrigger>
                  <TabsTrigger value="skipped">متجاهَل ({skipped.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="unregistered">
                  {unregistered.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      كل الشحنات موبايلاتها موجودة في العملاء — مفيش حاجة محتاجة تسجيل
                    </p>
                  ) : (
                    <>
                      <Alert className="mb-3 bg-blue-50 border-blue-300">
                        <AlertTriangle className="w-4 h-4 text-blue-700" />
                        <AlertTitle>الشحنات دي موبايلاتها مش موجودة في العملاء</AlertTitle>
                        <AlertDescription className="space-y-2">
                          <div>
                            البنات لازم يسجّلوا الأوردرات دي الأول على السيستم. ابعتلهم القائمة
                            وبعدين ارفع الشيت تاني — أو كمّل واعتمد الباقي دلوقتي والشحنات دي هتتحط
                            في قائمة <b>"شحنات محتاجة تسجيل"</b> ويسجّلوها من هناك.
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-blue-500 text-blue-700 hover:bg-blue-100"
                            onClick={copyUnregisteredToClipboard}
                          >
                            📋 نسخ القائمة للبنات
                          </Button>
                        </AlertDescription>
                      </Alert>
                      <ShipmentTable shipments={unregistered} phoneToModerator={phoneToModerator} />
                    </>
                  )}
                </TabsContent>

                <TabsContent value="ready">
                  <ShipmentTable shipments={readyItems} phoneToModerator={phoneToModerator} />
                </TabsContent>
                <TabsContent value="warnings">
                  {withWarnings.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">لا توجد تحذيرات</p>
                  ) : (
                    <>
                      <Alert className="mb-3 bg-amber-50 border-amber-300">
                        <AlertTriangle className="w-4 h-4" />
                        <AlertDescription>
                          الشحنات دي فيها منتجات مش اتعرفت — اتحطّت في الأوردر بدونها. راجعهم قبل الاعتماد.
                        </AlertDescription>
                      </Alert>
                      <ShipmentTable shipments={withWarnings} showUnknown phoneToModerator={phoneToModerator} />
                    </>
                  )}
                </TabsContent>
                <TabsContent value="skipped">
                  {skipped.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">لا يوجد متجاهَل</p>
                  ) : (
                    <>
                      <Alert variant="destructive" className="mb-3">
                        <X className="w-4 h-4" />
                        <AlertDescription>
                          الشحنات دي مش هتتحدّث لأن كل منتجاتها مش موجودة في الكاتالوج.
                        </AlertDescription>
                      </Alert>
                      <ShipmentTable shipments={skipped} showUnknown phoneToModerator={phoneToModerator} />
                    </>
                  )}
                </TabsContent>
              </Tabs>

              <DialogFooter className="mt-4">
                <Button variant="ghost" onClick={reset}>إلغاء</Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={submitting || readyItems.length + withWarnings.length === 0}
                  onClick={handleConfirm}
                >
                  {submitting ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 ml-2" />}
                  تأكيد وتحديث {readyItems.length + withWarnings.length} أوردر
                </Button>
              </DialogFooter>
            </>
          ) : (
            <ResultView result={result} onClose={reset} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  const cls: Record<string, string> = {
    slate: "bg-slate-50 border-slate-200 text-slate-800",
    blue: "bg-blue-50 border-blue-200 text-blue-800",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    red: "bg-red-50 border-red-200 text-red-800",
  };
  return (
    <div className={`border rounded p-3 text-center ${cls[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function ShipmentTable({
  shipments,
  showUnknown,
  phoneToModerator,
}: {
  shipments: ParsedShipment[];
  showUnknown?: boolean;
  phoneToModerator?: Map<string, string>;
}) {
  if (shipments.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">لا توجد شحنات</p>;
  }
  // Group by moderator for summary
  const modCounts = new Map<string, number>();
  shipments.forEach((s) => {
    const m = phoneToModerator?.get(s.phone) || "— غير معروف —";
    modCounts.set(m, (modCounts.get(m) || 0) + 1);
  });
  const modSummary = Array.from(modCounts.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 text-xs">
        {modSummary.map(([mod, count]) => (
          <Badge key={mod} variant="outline" className="border-purple-400 text-purple-800 bg-purple-50">
            👩 {mod}: {count} شحنة
          </Badge>
        ))}
      </div>
      <div className="border rounded overflow-x-auto max-h-[50vh]">
        <table className="w-full text-xs text-right">
          <thead className="bg-muted/60 sticky top-0">
            <tr>
              <th className="p-2">البوليصة</th>
              <th className="p-2">التاريخ</th>
              <th className="p-2">البنت</th>
              <th className="p-2">العميل</th>
              <th className="p-2">الموبايل</th>
              <th className="p-2">COD</th>
              <th className="p-2">المنتجات المُعرَّفة</th>
              {showUnknown && <th className="p-2 text-amber-700">غير معرَّف</th>}
            </tr>
          </thead>
          <tbody>
            {shipments.map((s, i) => {
              const mod = phoneToModerator?.get(s.phone);
              return (
                <tr key={s.bill_no + i} className="border-t hover:bg-muted/30">
                  <td className="p-2 font-mono">{s.bill_no}</td>
                  <td className="p-2 whitespace-nowrap">{s.shipment_date}</td>
                  <td className="p-2">
                    {mod ? (
                      <Badge variant="outline" className="border-purple-400 text-purple-800 bg-purple-50">
                        {mod}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-2">{s.customer_name}</td>
                  <td className="p-2 font-mono">{s.phone}</td>
                  <td className="p-2 font-bold">{s.cod}</td>
                  <td className="p-2">
                    {s.items.length === 0 ? (
                      <span className="text-red-600">لا شيء</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {s.items.map((it, j) => (
                          <Badge key={j} variant="outline" className={it.is_gift ? "border-purple-400 text-purple-700" : "border-emerald-400 text-emerald-700"}>
                            {it.quantity} × {it.product_name}{it.is_gift ? " 🎁" : ""}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  {showUnknown && (
                    <td className="p-2 text-amber-700 text-xs max-w-xs">
                      {s.unknown_tokens.length === 0 ? "—" : s.unknown_tokens.join("، ")}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultView({ result, onClose }: { result: any; onClose: () => void }) {
  return (
    <div className="space-y-3">
      <Alert className="bg-emerald-50 border-emerald-300">
        <CheckCircle2 className="w-4 h-4 text-emerald-700" />
        <AlertTitle>تمت العملية بنجاح</AlertTitle>
        <AlertDescription>
          تم تحديث <b>{result.updated?.length ?? 0}</b> أوردر إلى تسليم ناجح وخصم المخزون من العجوزة.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center text-xs">
        <div className="bg-emerald-50 border border-emerald-200 rounded p-2">
          <div className="text-lg font-bold text-emerald-700">{result.updated?.length ?? 0}</div>
          <div>تم التحديث</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded p-2">
          <div className="text-lg font-bold text-blue-700">{result.product_diffs?.length ?? 0}</div>
          <div>فيها فروقات منتجات</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded p-2">
          <div className="text-lg font-bold text-amber-700">{result.already_delivered?.length ?? 0}</div>
          <div>مسلَّم مسبقاً</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded p-2">
          <div className="text-lg font-bold text-red-700">
            {(result.unmatched?.length ?? 0) + (result.errors?.length ?? 0)}
          </div>
          <div>مش لاقيالها / أخطاء</div>
        </div>
      </div>

      {result.unregistered_queued?.length > 0 && (
        <Alert className="bg-blue-50 border-blue-300">
          <AlertTriangle className="w-4 h-4 text-blue-700" />
          <AlertTitle>
            {result.unregistered_queued.length} شحنة اتحطّت في قائمة "شحنات محتاجة تسجيل"
          </AlertTitle>
          <AlertDescription>
            الموبايلات دي مش موجودة في العملاء — البنات لازم يسجّلوا الأوردرات دي من صفحة
            <b className="mx-1">"شحنات محتاجة تسجيل"</b>. بعدها هيتحسبوا تسليم ناجح تلقائي.
          </AlertDescription>
        </Alert>
      )}

      {result.unmatched?.length > 0 && (
        <details className="border rounded p-2 text-xs">
          <summary className="cursor-pointer font-bold text-red-700">
            شحنات مش لاقيالها أوردر ({result.unmatched.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {result.unmatched.map((u: any, i: number) => (
              <li key={i}>
                • {u.shipment.customer_name} — {u.shipment.phone} — {u.shipment.cod} ج ({u.reason})
              </li>
            ))}
          </ul>
        </details>
      )}


      {result.errors?.length > 0 && (
        <details className="border rounded p-2 text-xs" open>
          <summary className="cursor-pointer font-bold text-red-700">
            أخطاء ({result.errors.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {result.errors.map((e: any, i: number) => (
              <li key={i}>
                • {e.shipment?.customer_name || "—"} ({e.shipment?.phone}) → {e.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <DialogFooter>
        <Button onClick={onClose}>تم</Button>
      </DialogFooter>
    </div>
  );
}
