import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Truck, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ClosedInvoice {
  id: string;
  invoice_no: string;
  total_amount: number;
  orders_count: number;
  orders_matched: number;
  orders_missing: number;
  first_seen_at: string;
}

interface InvoiceLine {
  id: string;
  bill_no: string;
  cod_amount: number;
  moderator_name: string | null;
  customer_phone: string | null;
  matched: boolean;
  custody_assigned: boolean;
  order_id: string | null;
}

export function ZodexClosedInvoicesCard() {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<ClosedInvoice[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, InvoiceLine[]>>({});
  const [loadingLines, setLoadingLines] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("zodex_closed_invoices")
      .select("id, invoice_no, total_amount, orders_count, orders_matched, orders_missing, first_seen_at")
      .order("first_seen_at", { ascending: false })
      .limit(20);
    setInvoices((data as ClosedInvoice[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleExpand = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!lines[id]) {
      setLoadingLines(id);
      const { data } = await supabase
        .from("zodex_closed_invoice_orders")
        .select("id, bill_no, cod_amount, moderator_name, customer_phone, matched, custody_assigned, order_id")
        .eq("invoice_id", id)
        .order("bill_no");
      setLines((prev) => ({ ...prev, [id]: (data as InvoiceLine[]) || [] }));
      setLoadingLines(null);
    }
  };

  return (
    <Card className="border-emerald-200 bg-emerald-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-emerald-700" />
              فواتير زودكس المقفولة — نعام العاصمة
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              كل فاتورة تسوية بتقفلها زودكس بتظهر هنا. أوردراتها بتتنقل تلقائى لعهدة مندوب العجوزة.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "تحديث"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="text-center py-6 text-sm text-muted-foreground">جارى التحميل...</div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">مفيش فواتير مقفولة لسه</div>
        ) : (
          <div className="space-y-2">
            {invoices.map((inv) => (
              <div key={inv.id} className="bg-white rounded-md border border-emerald-100 overflow-hidden">
                <button
                  onClick={() => toggleExpand(inv.id)}
                  className="w-full flex items-center justify-between p-3 hover:bg-emerald-50/50 transition"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-emerald-900">#{inv.invoice_no}</span>
                    <span className="text-sm text-gray-600">
                      {new Date(inv.first_seen_at).toLocaleDateString("ar-EG", { day: "numeric", month: "short" })}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {inv.orders_count} أوردر
                    </Badge>
                    {inv.orders_missing > 0 ? (
                      <Badge variant="destructive" className="text-xs flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {inv.orders_missing} مفقود
                      </Badge>
                    ) : (
                      <Badge className="bg-green-600 text-xs flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        مطابقة كاملة
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs flex items-center gap-1">
                      <Truck className="h-3 w-3" />
                      {inv.orders_matched} فى عهدة المندوب
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-emerald-700">{inv.total_amount.toFixed(0)} ج</span>
                    {expanded === inv.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </button>
                {expanded === inv.id && (
                  <div className="border-t border-emerald-100 bg-gray-50/50">
                    {loadingLines === inv.id ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                        جارى التحميل...
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="h-8">
                            <TableHead className="text-xs">بوليصة</TableHead>
                            <TableHead className="text-xs">الموديرتور</TableHead>
                            <TableHead className="text-xs">تليفون</TableHead>
                            <TableHead className="text-xs text-left">المبلغ</TableHead>
                            <TableHead className="text-xs text-center">الحالة</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(lines[inv.id] || []).map((l) => (
                            <TableRow key={l.id} className="h-9">
                              <TableCell className="font-mono text-xs">{l.bill_no}</TableCell>
                              <TableCell className="text-xs">{l.moderator_name || "—"}</TableCell>
                              <TableCell className="text-xs font-mono">{l.customer_phone || "—"}</TableCell>
                              <TableCell className="text-xs text-left">{l.cod_amount.toFixed(0)}</TableCell>
                              <TableCell className="text-xs text-center">
                                {!l.matched ? (
                                  <Badge variant="destructive" className="text-[10px]">مش مسجل</Badge>
                                ) : l.custody_assigned ? (
                                  <Badge className="bg-green-600 text-[10px]">فى العهدة</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px]">مطابق</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
