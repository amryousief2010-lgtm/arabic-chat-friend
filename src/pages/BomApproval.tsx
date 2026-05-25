import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";

type MeatRow = { product_code: string; version: number; lines: number; is_active: boolean; status: string };
type FeedRow = { id: string; name: string; feed_type: string; version: number; is_active: boolean; recipe_status: string; source_invoice: string | null };

export default function BomApproval() {
  const [loading, setLoading] = useState(true);
  const [meat, setMeat] = useState<MeatRow[]>([]);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [dialog, setDialog] = useState<{ kind: "meat" | "feed"; payload: any; validation: any } | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: meatRecipes }, { data: meatStatus }, { data: feedRecipes }] = await Promise.all([
      supabase.from("meat_factory_recipes").select("product_code,version,product_name_ar"),
      supabase.from("meat_recipe_version_status").select("product_code,version,is_active,status"),
      supabase.from("feed_recipes").select("id,name,feed_type,version,is_active,recipe_status,source_invoice").order("feed_type"),
    ]);
    const grouped = new Map<string, MeatRow>();
    (meatRecipes || []).forEach((r: any) => {
      const k = `${r.product_code}#${r.version}`;
      if (!grouped.has(k)) grouped.set(k, { product_code: r.product_code, version: r.version, lines: 0, is_active: false, status: "draft" });
      grouped.get(k)!.lines += 1;
    });
    (meatStatus || []).forEach((s: any) => {
      const k = `${s.product_code}#${s.version}`;
      if (grouped.has(k)) { grouped.get(k)!.is_active = s.is_active; grouped.get(k)!.status = s.status; }
    });
    setMeat(Array.from(grouped.values()).sort((a, b) => a.product_code.localeCompare(b.product_code) || a.version - b.version));
    setFeed((feedRecipes as FeedRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openMeat = async (r: MeatRow) => {
    const { data, error } = await supabase.rpc("validate_meat_bom", { p_product_code: r.product_code, p_version: r.version });
    if (error) return toast.error(error.message);
    setNotes("");
    setDialog({ kind: "meat", payload: r, validation: data });
  };
  const openFeed = async (r: FeedRow) => {
    const { data, error } = await supabase.rpc("validate_feed_bom", { p_recipe_id: r.id });
    if (error) return toast.error(error.message);
    setNotes("");
    setDialog({ kind: "feed", payload: r, validation: data });
  };

  const confirmActivate = async () => {
    if (!dialog) return;
    setBusy(true);
    const args = dialog.kind === "meat"
      ? supabase.rpc("activate_meat_bom", { p_product_code: dialog.payload.product_code, p_version: dialog.payload.version, p_notes: notes || null })
      : supabase.rpc("activate_feed_bom", { p_recipe_id: dialog.payload.id, p_notes: notes || null });
    const { error } = await args;
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم تفعيل الإصدار بنجاح");
    setDialog(null);
    load();
  };

  // Group meat by product for side-by-side
  const meatByProduct = new Map<string, MeatRow[]>();
  meat.forEach(r => {
    if (!meatByProduct.has(r.product_code)) meatByProduct.set(r.product_code, []);
    meatByProduct.get(r.product_code)!.push(r);
  });

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">مركز اعتماد وصفات الإنتاج (BOM v2)</h1>
          <p className="text-sm text-muted-foreground">مقارنة v1 و v2 جنبًا إلى جنب — التفعيل يتطلب صلاحيات الإدارة والاكتمال الكامل للفحوصات</p>
        </div>
      </div>

      <Tabs defaultValue="meat">
        <TabsList>
          <TabsTrigger value="meat">مصنع اللحوم</TabsTrigger>
          <TabsTrigger value="feed">مصنع الأعلاف</TabsTrigger>
        </TabsList>

        <TabsContent value="meat">
          <Card>
            <CardHeader><CardTitle>وصفات مصنع اللحوم</CardTitle></CardHeader>
            <CardContent>
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                <div className="space-y-3">
                  {Array.from(meatByProduct.entries()).map(([code, versions]) => (
                    <div key={code} className="border rounded-lg p-3">
                      <div className="font-semibold mb-2">منتج {code}</div>
                      <div className="grid md:grid-cols-2 gap-3">
                        {versions.map(v => (
                          <div key={v.version} className={`border rounded p-3 ${v.is_active ? "bg-green-50 border-green-300" : ""}`}>
                            <div className="flex justify-between items-center">
                              <div>
                                <Badge variant={v.is_active ? "default" : "secondary"}>الإصدار {v.version}</Badge>
                                <span className="ms-2 text-xs text-muted-foreground">{v.lines} بنود</span>
                              </div>
                              <Badge variant="outline">{v.status}</Badge>
                            </div>
                            {!v.is_active && (
                              <Button size="sm" className="mt-2" onClick={() => openMeat(v)}>فحص وتفعيل</Button>
                            )}
                            {v.is_active && <div className="mt-2 text-xs text-green-700 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> مفعل</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feed">
          <Card>
            <CardHeader><CardTitle>وصفات مصنع الأعلاف</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {feed.map(r => (
                  <div key={r.id} className={`flex items-center justify-between border rounded p-3 ${r.is_active ? "bg-green-50 border-green-300" : ""}`}>
                    <div>
                      <div className="font-medium">{r.name} <Badge variant="outline" className="ms-2">v{r.version}</Badge></div>
                      <div className="text-xs text-muted-foreground">{r.feed_type} {r.source_invoice && `• فاتورة ${r.source_invoice}`}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge>{r.recipe_status}</Badge>
                      {!r.is_active && <Button size="sm" onClick={() => openFeed(r)}>فحص وتفعيل</Button>}
                      {r.is_active && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تفعيل إصدار BOM</DialogTitle></DialogHeader>
          {dialog && (
            <div className="space-y-3">
              <div className="text-sm">
                {dialog.kind === "meat"
                  ? `منتج ${dialog.payload.product_code} — الإصدار ${dialog.payload.version}`
                  : `${dialog.payload.name} — v${dialog.payload.version}`}
              </div>
              {dialog.validation?.ok ? (
                <div className="bg-green-50 border border-green-300 rounded p-3 text-sm text-green-800 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> جميع الفحوصات ناجحة — جاهز للتفعيل
                </div>
              ) : (
                <div className="bg-red-50 border border-red-300 rounded p-3 text-sm">
                  <div className="font-medium text-red-800 flex items-center gap-2 mb-2"><AlertTriangle className="h-4 w-4" /> لا يمكن التفعيل — مشاكل:</div>
                  <ul className="list-disc pe-5 space-y-1 text-red-700">
                    {(dialog.validation?.issues || []).map((i: any, idx: number) => (
                      <li key={idx}><b>{i.code}</b> — {i.msg}</li>
                    ))}
                  </ul>
                </div>
              )}
              <Textarea placeholder="ملاحظات (اختياري)" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>إلغاء</Button>
            <Button disabled={!dialog?.validation?.ok || busy} onClick={confirmActivate}>
              {busy && <Loader2 className="h-4 w-4 animate-spin me-2" />}
              تفعيل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
