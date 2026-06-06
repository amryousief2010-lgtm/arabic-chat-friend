import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, History } from "lucide-react";

export default function HatchBatchEditAudit() {
  const [q, setQ] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["hatch_batch_edit_audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hatch_batch_edit_audit" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data as any[];
    },
  });

  const filtered = rows.filter((r: any) => {
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return (
      (r.batch_number || "").toLowerCase().includes(s) ||
      (r.operational_batch_no || "").toLowerCase().includes(s) ||
      (r.customer_name || "").toLowerCase().includes(s) ||
      (r.actor_name || "").toLowerCase().includes(s) ||
      (r.reason || "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div className="flex items-center gap-2">
        <History className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold">سجل تعديلات الدفعات</h1>
        <Badge variant="outline" className="mr-2">{filtered.length}</Badge>
      </div>

      <Card className="p-3">
        <div className="relative max-w-md">
          <Search className="absolute right-2 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="بحث: رقم دفعة / عميل / مستخدم / سبب..."
            className="pr-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الوقت</TableHead>
              <TableHead>المستخدم</TableHead>
              <TableHead>رقم الدفعة</TableHead>
              <TableHead>العميل</TableHead>
              <TableHead>الحقول المعدلة</TableHead>
              <TableHead>السبب</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={6} className="text-center py-8">جاري التحميل...</TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">لا توجد تعديلات</TableCell></TableRow>
            )}
            {filtered.map((r: any) => {
              const ch = r.changes || {};
              const keys = Object.keys(ch);
              return (
                <TableRow key={r.id}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("ar-EG")}
                  </TableCell>
                  <TableCell className="text-xs font-medium">{r.actor_name || "—"}</TableCell>
                  <TableCell className="text-xs font-mono">
                    {r.operational_batch_no || r.batch_number || "—"}
                  </TableCell>
                  <TableCell className="text-xs">{r.customer_name || "—"}</TableCell>
                  <TableCell className="text-xs">
                    <div className="space-y-1">
                      {keys.map((k) => {
                        const v = ch[k];
                        return (
                          <div key={k} className="flex items-center gap-1 flex-wrap">
                            <span className="font-mono text-[10px] bg-slate-100 px-1 rounded">{k}</span>
                            <span className="text-muted-foreground">{String(v.before ?? "—")}</span>
                            <span>→</span>
                            <b>{String(v.after ?? "—")}</b>
                            {v.critical && <span className="text-red-600">⚠</span>}
                          </div>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs max-w-xs">{r.reason || <span className="text-muted-foreground">—</span>}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
