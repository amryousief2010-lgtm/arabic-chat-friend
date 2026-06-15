import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CalendarClock, Save, PackagePlus, Archive, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Row {
  id: string;
  name: string;
  operational_start_date: string | null;
  hasOpening: boolean;
  preOpsCount: number;
}

const TARGET_NAMES = ["المخزن الرئيسي", "مخزن العجوزة"];

export default function WarehouseOperationalDates() {
  const { isGeneralManager, isExecutiveManager } = useAuth();
  const canEdit = isGeneralManager || isExecutiveManager;
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: whs } = await supabase
      .from("warehouses")
      .select("id, name, operational_start_date")
      .or("name.ilike.%رئيسي%,name.ilike.%عجوزة%");
    const list = (whs || []) as any[];

    const built: Row[] = [];
    for (const w of list) {
      const [{ count: opCount }, { count: preCount }] = await Promise.all([
        supabase.from("warehouse_opening_balances").select("id", { count: "exact", head: true }).eq("warehouse_id", w.id),
        w.operational_start_date
          ? supabase
              .from("inventory_movements")
              .select("id", { count: "exact", head: true })
              .eq("warehouse_id", w.id)
              .lt("performed_at", w.operational_start_date)
          : Promise.resolve({ count: 0 } as any),
      ]);
      built.push({
        id: w.id,
        name: w.name,
        operational_start_date: w.operational_start_date,
        hasOpening: (opCount || 0) > 0,
        preOpsCount: preCount || 0,
      });
    }
    setRows(built);
    setDrafts(Object.fromEntries(built.map((r) => [r.id, r.operational_start_date || ""])));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async (r: Row) => {
    const d = drafts[r.id];
    if (!d) { toast.error("اختر تاريخ بداية التشغيل"); return; }
    setSaving(r.id);
    try {
      const { error } = await supabase
        .from("warehouses")
        .update({ operational_start_date: d })
        .eq("id", r.id);
      if (error) throw error;
      toast.success(`تم حفظ تاريخ بداية تشغيل ${r.name}`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "فشل الحفظ");
    } finally {
      setSaving(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <CalendarClock className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">تاريخ بداية التشغيل الفعلي للمخزون</h1>
            <p className="text-sm text-muted-foreground">يحدد من أي تاريخ يبدأ النظام في خصم/زيادة الرصيد. أي حركة خصم قبل هذا التاريخ سيتم رفضها تلقائيًا.</p>
          </div>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            بعد تحديد التاريخ: أي حركة <b>صادر / تحويل / تسوية بالنقص</b> بتاريخ أقدم من تاريخ بداية التشغيل ستُرفض على مستوى قاعدة البيانات.
            احرص على إدخال <b>الرصيد الافتتاحي</b> لكل صنف قبل أو في نفس تاريخ بداية التشغيل.
          </AlertDescription>
        </Alert>

        {loading ? (
          <div className="text-center py-10 text-muted-foreground">جاري التحميل...</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">لم يتم العثور على المخازن المستهدفة.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rows.map((r) => (
              <Card key={r.id} className="border-2">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    <span>{r.name}</span>
                    {r.operational_start_date ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700">مُفعّل</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">غير محدد</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    تاريخ بداية التشغيل الحالي: <b>{r.operational_start_date || "—"}</b>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>تاريخ بداية التشغيل</Label>
                    <Input
                      type="date"
                      value={drafts[r.id] || ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                      disabled={!canEdit}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="p-2 rounded bg-muted/40">
                      <div className="text-xs text-muted-foreground">رصيد افتتاحي</div>
                      <div className="font-bold">{r.hasOpening ? "موجود ✅" : "غير مسجل ❌"}</div>
                    </div>
                    <div className="p-2 rounded bg-muted/40">
                      <div className="text-xs text-muted-foreground">حركات قبل التشغيل (تاريخية)</div>
                      <div className="font-bold">{r.preOpsCount.toLocaleString("ar-EG")}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2 border-t">
                    <Button onClick={() => save(r)} disabled={!canEdit || saving === r.id}>
                      <Save className="w-4 h-4 ml-1" />
                      {saving === r.id ? "جاري الحفظ..." : "حفظ التاريخ"}
                    </Button>
                    <Button asChild variant="outline">
                      <Link to={`/modules/warehouses/${r.id}`}>
                        <PackagePlus className="w-4 h-4 ml-1" />
                        إدخال رصيد افتتاحي
                      </Link>
                    </Button>
                    <Button asChild variant="ghost">
                      <Link to="/main-warehouse-activity">
                        <Archive className="w-4 h-4 ml-1" />
                        سجل الحركات
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
