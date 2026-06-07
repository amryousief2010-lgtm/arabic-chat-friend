import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Truck, Trash2, Edit } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePCRoutes } from "@/hooks/usePrivateCourierData";
import { REGIONS, ROUTE_COLORS, ROUTE_STATUS_LABEL, type RouteStatus } from "@/lib/privateCourier/constants";

const STATUS_VALUES: RouteStatus[] = ["draft", "planned", "in_progress", "completed", "cancelled"];

export default function PCRoutesPage() {
  const { user } = useAuth();
  const { data: routes, loading, refetch } = usePCRoutes();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    name: "", region: REGIONS[0] as string, governorates: "", cities: "",
    planned_date: "", start_time: "", expected_end_time: "",
    status: "draft" as RouteStatus, color: ROUTE_COLORS[0], notes: "",
  });
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setEditing(null);
    setForm({
      name: "", region: REGIONS[0], governorates: "", cities: "",
      planned_date: "", start_time: "", expected_end_time: "",
      status: "draft", color: ROUTE_COLORS[0], notes: "",
    });
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      name: r.name, region: r.region || REGIONS[0],
      governorates: (r.governorates || []).join(", "),
      cities: (r.cities || []).join(", "),
      planned_date: r.planned_date || "", start_time: r.start_time || "",
      expected_end_time: r.expected_end_time || "",
      status: r.status, color: r.color || ROUTE_COLORS[0], notes: r.notes || "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("اسم الخط مطلوب"); return; }
    setSaving(true);
    const payload: any = {
      name: form.name.trim(),
      region: form.region,
      governorates: form.governorates.split(",").map(s => s.trim()).filter(Boolean),
      cities: form.cities.split(",").map(s => s.trim()).filter(Boolean),
      planned_date: form.planned_date || null,
      start_time: form.start_time || null,
      expected_end_time: form.expected_end_time || null,
      status: form.status, color: form.color, notes: form.notes || null,
    };
    let err;
    if (editing) {
      ({ error: err } = await (supabase as any).from("pc_routes").update(payload).eq("id", editing.id));
    } else {
      payload.created_by = user?.id;
      ({ error: err } = await (supabase as any).from("pc_routes").insert(payload));
    }
    setSaving(false);
    if (err) { toast.error(err.message); return; }
    toast.success(editing ? "تم تحديث الخط" : "تم إنشاء الخط");
    setOpen(false); reset(); refetch();
  };

  const remove = async (id: string) => {
    if (!confirm("تأكيد الحذف؟ سيتم فك ربط الطلبات.")) return;
    const { error } = await (supabase as any).from("pc_routes").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم الحذف"); refetch();
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">إدارة خطوط السير</h1>
          </div>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
            <DialogTrigger asChild>
              <Button onClick={reset}><Plus className="h-4 w-4 ml-1" />خط جديد</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg" dir="rtl">
              <DialogHeader><DialogTitle>{editing ? "تعديل خط سير" : "إنشاء خط سير جديد"}</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>اسم الخط</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="مثال: خط القاهرة والجيزة" /></div>
                <div>
                  <Label>المنطقة</Label>
                  <Select value={form.region} onValueChange={v => setForm({ ...form, region: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>المحافظات (افصل بفاصلة)</Label><Input value={form.governorates} onChange={e => setForm({ ...form, governorates: e.target.value })} placeholder="القاهرة, الجيزة" /></div>
                <div><Label>المدن/المناطق</Label><Input value={form.cities} onChange={e => setForm({ ...form, cities: e.target.value })} placeholder="مدينة نصر, الدقي" /></div>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label>التاريخ</Label><Input type="date" value={form.planned_date} onChange={e => setForm({ ...form, planned_date: e.target.value })} /></div>
                  <div><Label>وقت البدء</Label><Input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} /></div>
                  <div><Label>الانتهاء المتوقع</Label><Input type="time" value={form.expected_end_time} onChange={e => setForm({ ...form, expected_end_time: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>الحالة</Label>
                    <Select value={form.status} onValueChange={(v: RouteStatus) => setForm({ ...form, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUS_VALUES.map(s => <SelectItem key={s} value={s}>{ROUTE_STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>اللون</Label>
                    <div className="flex gap-1 flex-wrap pt-1">
                      {ROUTE_COLORS.map(c => (
                        <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                          className={`h-7 w-7 rounded-full border-2 ${form.color === c ? "border-foreground" : "border-transparent"}`}
                          style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                </div>
                <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                <Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ…" : "حفظ"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? <div className="text-center py-12 text-muted-foreground">جاري التحميل…</div> :
          routes.length === 0 ? <Card><CardContent className="py-12 text-center text-muted-foreground">لا توجد خطوط بعد</CardContent></Card> :
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {routes.map(r => (
                <Card key={r.id} className="border-r-4" style={{ borderRightColor: r.color || "#8b5cf6" }}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ background: r.color || "#8b5cf6" }} />
                        {r.name}
                      </CardTitle>
                      <Badge variant="outline" className="text-xs">{ROUTE_STATUS_LABEL[r.status as RouteStatus] || r.status}</Badge>
                    </div>
                    {r.region && <p className="text-xs text-muted-foreground">{r.region}</p>}
                  </CardHeader>
                  <CardContent className="text-xs space-y-1">
                    {r.governorates?.length > 0 && <div><span className="text-muted-foreground">المحافظات: </span>{r.governorates.join("، ")}</div>}
                    {r.cities?.length > 0 && <div><span className="text-muted-foreground">المدن: </span>{r.cities.join("، ")}</div>}
                    {r.planned_date && <div><span className="text-muted-foreground">التاريخ: </span>{r.planned_date}</div>}
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(r)}><Edit className="h-3 w-3 ml-1" />تعديل</Button>
                      <Button size="sm" variant="destructive" onClick={() => remove(r.id)}><Trash2 className="h-3 w-3 ml-1" />حذف</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>}
      </div>
    </DashboardLayout>
  );
}
