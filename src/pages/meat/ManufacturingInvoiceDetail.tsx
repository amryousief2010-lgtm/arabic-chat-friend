import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowRight, Factory, Package } from "lucide-react";
import { parseServiceCostsFromNotes, userNotesFromInvoice } from "@/lib/meatServiceCosts";

const n = (v: unknown) => Number(v ?? 0);
const money = (v: unknown) => n(v).toLocaleString("ar-EG", { maximumFractionDigits: 2 }) + " ج";
const qty = (v: unknown) => n(v).toLocaleString("ar-EG", { maximumFractionDigits: 3 });

const KIND_AR: Record<string, string> = { raw: "خامات", spice: "توابل", packaging: "تغليف", extra: "مصاريف" };
const STATUS_AR: Record<string, string> = {
  draft: "مسودة", pending: "قيد الاعتماد", approved: "معتمدة", transferred: "محوّلة", cancelled: "ملغاة",
};

export default function ManufacturingInvoiceDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["mf-invoice-detail", id],
    enabled: !!id,
    queryFn: async () => {
      const [inv, lines] = await Promise.all([
        (supabase as any).from("meat_manufacturing_invoices").select("*").eq("id", id).maybeSingle(),
        (supabase as any).from("meat_manufacturing_invoice_lines").select("*").eq("invoice_id", id).order("kind"),
      ]);
      if (inv.error) throw inv.error;
      return { invoice: inv.data as any, lines: (lines.data ?? []) as any[] };
    },
  });

  const invoice = data?.invoice;
  const lines = data?.lines ?? [];
  const services = useMemo(() => parseServiceCostsFromNotes(invoice?.notes), [invoice?.notes]);

  const totals = useMemo(() => {
    const byKind = (k: string) => lines.filter((l) => l.kind === k).reduce((s, l) => s + n(l.line_total), 0);
    const raw = invoice?.raw_cost != null ? n(invoice.raw_cost) : byKind("raw");
    const spice = invoice?.spice_cost != null ? n(invoice.spice_cost) : byKind("spice");
    const packaging = invoice?.packaging_cost != null ? n(invoice.packaging_cost) : byKind("packaging");
    const extra = invoice?.extra_cost != null ? n(invoice.extra_cost) : services.reduce((s, r) => s + n(r.total), 0);
    const total = raw + spice + packaging + extra;
    const q = n(invoice?.finished_qty);
    return { raw, spice, packaging, extra, total, unit: q > 0 ? total / q : 0 };
  }, [lines, invoice, services]);

  if (isLoading) {
    return <DashboardLayout><div className="p-8 text-center text-muted-foreground">جارٍ التحميل...</div></DashboardLayout>;
  }
  if (!invoice) {
    return <DashboardLayout><div className="p-8 text-center text-muted-foreground">الفاتورة غير موجودة</div></DashboardLayout>;
  }

  const cards = [
    { label: "إجمالي الخامات", value: totals.raw },
    { label: "إجمالي التوابل", value: totals.spice },
    { label: "إجمالي التغليف", value: totals.packaging },
    { label: "إجمالي المصاريف", value: totals.extra },
  ];

  return (
    <DashboardLayout>
      <Header title={`فاتورة تصنيع ${invoice.invoice_no ?? ""}`} subtitle={invoice.product_name} />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => navigate("/meat-factory/manufacturing")}>
          <ArrowRight className="w-4 h-4 ml-1" /> فواتير التصنيع
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate(`/meat-cost-variance?product=${encodeURIComponent(invoice.product_name || "")}`)}>
          <Package className="w-4 h-4 ml-1" /> تفاصيل تكلفة الصنف التام
        </Button>
        <Badge variant={invoice.status === "cancelled" ? "destructive" : "secondary"}>
          {STATUS_AR[invoice.status] ?? invoice.status}
        </Badge>
      </div>

      <Card className="glass-card mb-4">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Factory className="w-4 h-4" /> بيانات الفاتورة</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><div className="text-muted-foreground text-xs">المنتج التام</div><div className="font-medium">{invoice.product_name}</div></div>
          <div><div className="text-muted-foreground text-xs">الكمية المنتجة</div><div className="font-medium">{qty(invoice.finished_qty)} {invoice.unit}</div></div>
          <div><div className="text-muted-foreground text-xs">تاريخ الإنشاء</div><div className="font-medium">{new Date(invoice.created_at).toLocaleDateString("ar-EG")}</div></div>
          <div><div className="text-muted-foreground text-xs">تكلفة الوحدة الفعلية</div><div className="font-bold text-primary">{money(totals.unit)}</div></div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {cards.map((c) => (
          <Card key={c.label} className="glass-card"><CardContent className="p-4">
            <div className="text-muted-foreground text-xs">{c.label}</div>
            <div className="text-xl font-bold mt-1">{money(c.value)}</div>
          </CardContent></Card>
        ))}
        <Card className="glass-card border-primary/40"><CardContent className="p-4">
          <div className="text-muted-foreground text-xs">إجمالي تكلفة التصنيع</div>
          <div className="text-xl font-bold mt-1 text-primary">{money(totals.total)}</div>
        </CardContent></Card>
      </div>

      <Card className="glass-card mb-4">
        <CardHeader><CardTitle className="text-base">بنود الفاتورة ({lines.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="text-right">الصنف</TableHead>
              <TableHead className="text-right">النوع</TableHead>
              <TableHead className="text-right">الكمية</TableHead>
              <TableHead className="text-right">الوحدة</TableHead>
              <TableHead className="text-right">سعر الوحدة</TableHead>
              <TableHead className="text-right">الإجمالي</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.item_name}</TableCell>
                  <TableCell><Badge variant="outline">{KIND_AR[l.kind] ?? l.kind}</Badge></TableCell>
                  <TableCell>{qty(l.quantity)}</TableCell>
                  <TableCell>{l.unit}</TableCell>
                  <TableCell>{money(l.unit_cost)}</TableCell>
                  <TableCell className="font-semibold">{money(l.line_total)}</TableCell>
                </TableRow>
              ))}
              {lines.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">لا توجد بنود</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {services.length > 0 && (
        <Card className="glass-card mb-4">
          <CardHeader><CardTitle className="text-base">المصاريف والخدمات ({services.length})</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-right">البند</TableHead>
                <TableHead className="text-right">الكمية</TableHead>
                <TableHead className="text-right">الوحدة</TableHead>
                <TableHead className="text-right">سعر الوحدة</TableHead>
                <TableHead className="text-right">الإجمالي</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {services.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.quantity != null ? qty(s.quantity) : "—"}</TableCell>
                    <TableCell>{s.unit ?? "—"}</TableCell>
                    <TableCell>{s.unit_cost != null ? money(s.unit_cost) : "—"}</TableCell>
                    <TableCell className="font-semibold">{s.total != null ? money(s.total) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {userNotesFromInvoice(invoice.notes) && (
        <Card className="glass-card">
          <CardHeader><CardTitle className="text-base">ملاحظات</CardTitle></CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{userNotesFromInvoice(invoice.notes)}</CardContent>
        </Card>
      )}
    </DashboardLayout>
  );
}
