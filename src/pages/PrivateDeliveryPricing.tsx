import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Save, Trash2, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface PriceRow {
  id: string;
  location: string;
  governorate: string | null;
  price: number;
  notes: string | null;
}

const PrivateDeliveryPricing = () => {
  const { isPrivateDeliveryRep, isGeneralManager, isExecutiveManager, isSalesManager } = useAuth();
  const canEdit = isPrivateDeliveryRep || isGeneralManager || isExecutiveManager || isSalesManager;
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ location: "", governorate: "", price: "", notes: "" });

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("private_delivery_pricing")
      .select("*")
      .order("governorate", { ascending: true })
      .order("location", { ascending: true });
    if (error) toast.error("تعذّر تحميل الأسعار");
    setRows((data || []) as PriceRow[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const updateField = async (id: string, patch: Partial<PriceRow>) => {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("private_delivery_pricing").update(patch).eq("id", id);
    if (error) toast.error("تعذّر الحفظ"); else toast.success("تم الحفظ");
  };

  const addRow = async () => {
    if (!draft.location.trim()) return toast.error("اسم المنطقة مطلوب");
    const { error } = await supabase.from("private_delivery_pricing").insert({
      location: draft.location.trim(),
      governorate: draft.governorate.trim() || null,
      price: Number(draft.price) || 0,
      notes: draft.notes.trim() || null,
    });
    if (error) return toast.error(error.message);
    toast.success("تمت إضافة المنطقة");
    setDraft({ location: "", governorate: "", price: "", notes: "" });
    setOpen(false);
    load();
  };

  const removeRow = async (id: string) => {
    if (!confirm("هل تريد حذف هذه المنطقة؟")) return;
    const { error } = await supabase.from("private_delivery_pricing").delete().eq("id", id);
    if (error) return toast.error("تعذّر الحذف");
    setRows((r) => r.filter((x) => x.id !== id));
    toast.success("تم الحذف");
  };

  const filtered = rows.filter((r) =>
    !search ||
    r.location.includes(search) ||
    (r.governorate || "").includes(search)
  );

  return (
    <DashboardLayout>
      <Header title="أسعار شحن المندوب الخاص" subtitle="قائمة المناطق والأسعار — قابلة للتعديل" />
      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            المناطق ({filtered.length})
          </CardTitle>
          <div className="flex gap-2">
            <Input
              placeholder="بحث بالمنطقة أو المحافظة..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
            />
            {canEdit && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2"><Plus className="w-4 h-4" /> إضافة منطقة</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>إضافة منطقة جديدة</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium">المنطقة *</label>
                      <Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-sm font-medium">المحافظة</label>
                      <Input value={draft.governorate} onChange={(e) => setDraft({ ...draft, governorate: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-sm font-medium">السعر (ج.م)</label>
                      <Input type="number" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-sm font-medium">ملاحظات</label>
                      <Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                    </div>
                    <Button onClick={addRow} className="w-full gap-2"><Save className="w-4 h-4" /> حفظ</Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary"></div>
            </div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {filtered.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">لا توجد بيانات</div>
                ) : filtered.map((r) => (
                  <Card key={r.id} className="p-3 space-y-2 border border-border/50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-muted-foreground mb-1">المحافظة</div>
                        {canEdit ? (
                          <Input
                            defaultValue={r.governorate || ""}
                            onBlur={(e) => e.target.value !== (r.governorate || "") && updateField(r.id, { governorate: e.target.value || null })}
                            className="h-8 text-sm"
                          />
                        ) : <div className="text-sm font-medium">{r.governorate || "-"}</div>}
                      </div>
                      {canEdit && (
                        <Button variant="ghost" size="icon" onClick={() => removeRow(r.id)} className="text-destructive h-8 w-8 shrink-0 mt-4">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">المنطقة</div>
                      {canEdit ? (
                        <Input
                          defaultValue={r.location}
                          onBlur={(e) => e.target.value && e.target.value !== r.location && updateField(r.id, { location: e.target.value })}
                          className="h-8 text-sm"
                        />
                      ) : <div className="text-sm font-medium">{r.location}</div>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">السعر (ج.م)</div>
                        {canEdit ? (
                          <Input
                            type="number"
                            defaultValue={r.price}
                            onBlur={(e) => Number(e.target.value) !== r.price && updateField(r.id, { price: Number(e.target.value) })}
                            className="h-8 text-sm font-bold"
                          />
                        ) : <div className="text-sm font-bold">{r.price}</div>}
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">ملاحظات</div>
                        {canEdit ? (
                          <Input
                            defaultValue={r.notes || ""}
                            onBlur={(e) => e.target.value !== (r.notes || "") && updateField(r.id, { notes: e.target.value || null })}
                            className="h-8 text-sm"
                          />
                        ) : <div className="text-sm">{r.notes || "-"}</div>}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-right">المحافظة</TableHead>
                      <TableHead className="text-right">المنطقة</TableHead>
                      <TableHead className="text-right">السعر (ج.م)</TableHead>
                      <TableHead className="text-right">ملاحظات</TableHead>
                      {canEdit && <TableHead className="text-right">إجراءات</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
                    ) : filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          {canEdit ? (
                            <Input
                              defaultValue={r.governorate || ""}
                              onBlur={(e) => e.target.value !== (r.governorate || "") && updateField(r.id, { governorate: e.target.value || null })}
                              className="w-32"
                            />
                          ) : (r.governorate || "-")}
                        </TableCell>
                        <TableCell>
                          {canEdit ? (
                            <Input
                              defaultValue={r.location}
                              onBlur={(e) => e.target.value && e.target.value !== r.location && updateField(r.id, { location: e.target.value })}
                              className="w-40"
                            />
                          ) : r.location}
                        </TableCell>
                        <TableCell>
                          {canEdit ? (
                            <Input
                              type="number"
                              defaultValue={r.price}
                              onBlur={(e) => Number(e.target.value) !== r.price && updateField(r.id, { price: Number(e.target.value) })}
                              className="w-24 font-bold"
                            />
                          ) : <span className="font-bold">{r.price}</span>}
                        </TableCell>
                        <TableCell>
                          {canEdit ? (
                            <Input
                              defaultValue={r.notes || ""}
                              onBlur={(e) => e.target.value !== (r.notes || "") && updateField(r.id, { notes: e.target.value || null })}
                              className="w-64"
                            />
                          ) : (r.notes || "-")}
                        </TableCell>
                        {canEdit && (
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => removeRow(r.id)} className="text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default PrivateDeliveryPricing;
