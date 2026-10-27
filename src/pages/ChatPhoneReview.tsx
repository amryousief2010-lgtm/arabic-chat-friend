import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { canManageConversations } from "@/config/chatManagement";

const db = supabase as any;
interface Review { id: string; issue: "malformed" | "two_numbers" | "multi_customer"; customer_id: string | null; phone_raw: string | null; phone_norm: string | null; related_customer_ids: string[]; created_at: string }
interface Merge { id: string; survivor_customer_id: string; merged_customer_id: string; merged_at: string; undone_at: string | null; reason: string | null }
interface Cust { id: string; name: string | null; phone: string | null; total_orders: number | null }

const ISSUE_LABELS: Record<Review["issue"], string> = {
  malformed: "رقم غير صحيح", two_numbers: "رقمان في حقل واحد", multi_customer: "نفس الرقم لأكثر من عميل",
};

/** طابور مراجعة الأرقام + دمج العملاء المكررين والتراجع. الدمج لا يمسّ customers ولا orders (طبقة cm_ فقط). */
export default function ChatPhoneReview() {
  const { roles } = useAuth() as { roles?: string[] };
  const canManage = canManageConversations(roles);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [merges, setMerges] = useState<Merge[]>([]);
  const [customers, setCustomers] = useState<Record<string, Cust>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, m] = await Promise.all([
      db.from("cm_phone_review_queue").select("*").eq("status", "open").order("created_at").limit(300),
      db.from("cm_customer_merges").select("id,survivor_customer_id,merged_customer_id,merged_at,undone_at,reason").order("merged_at", { ascending: false }).limit(100),
    ]);
    if (r.error || m.error) toast.error(`تعذّر التحميل: ${(r.error ?? m.error).message}`);
    const rv: Review[] = r.data ?? []; const mg: Merge[] = m.data ?? [];
    const ids = [...new Set([...rv.flatMap((x) => [x.customer_id, ...(x.related_customer_ids ?? [])]),
      ...mg.flatMap((x) => [x.survivor_customer_id, x.merged_customer_id])].filter(Boolean))] as string[];
    const c = ids.length ? await db.from("customers").select("id,name,phone,total_orders").in("id", ids) : { data: [] };
    setReviews(rv); setMerges(mg);
    setCustomers(Object.fromEntries((c.data ?? []).map((x: Cust) => [x.id, x])));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const name = (id: string | null) => (id ? customers[id]?.name ?? id.slice(0, 8) : "—");
  const merge = async (rev: Review, survivor: string, merged: string) => {
    if (!window.confirm(`دمج «${name(merged)}» في «${name(survivor)}»؟ يمكن التراجع لاحقاً.`)) return;
    const { error } = await db.rpc("cm_merge_customers", { _survivor: survivor, _merged: merged, _reason: "phone_review", _review_id: rev.id });
    if (error) toast.error(`تعذّر الدمج: ${error.message}`); else { toast.success("تم الدمج"); load(); }
  };
  const undo = async (m: Merge) => {
    if (!window.confirm("التراجع عن هذا الدمج؟")) return;
    const { error } = await db.rpc("cm_undo_merge", { _merge_id: m.id });
    if (error) toast.error(`تعذّر التراجع: ${error.message}`); else { toast.success("تم التراجع"); load(); }
  };
  const dismiss = async (rev: Review) => {
    const { error } = await db.from("cm_phone_review_queue").update({ status: "dismissed", resolution: "dismissed" }).eq("id", rev.id);
    if (error) toast.error(error.message); else load();
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-4">
        <Header title="مراجعة الأرقام ودمج العملاء" subtitle="الدمج والتراجع لمديرة المبيعات والمدير العام فقط — لا يغيّر بيانات العملاء ولا الطلبات" />
        {!canManage && <Badge variant="secondary">عرض فقط</Badge>}
        <Card><CardHeader><CardTitle>طابور المراجعة</CardTitle><CardDescription>{loading ? "جارٍ التحميل…" : `${reviews.length} مفتوحة`}</CardDescription></CardHeader>
          <CardContent className="space-y-3" data-testid="review-queue">
            {reviews.map((r) => (
              <div key={r.id} className="border rounded-md p-3 space-y-2">
                <div className="flex gap-2 items-center flex-wrap"><Badge>{ISSUE_LABELS[r.issue]}</Badge>
                  <span dir="ltr">{r.phone_norm ?? r.phone_raw}</span>{r.customer_id && <span>— {name(r.customer_id)}</span>}</div>
                {r.issue === "multi_customer" && (
                  <div className="space-y-1">
                    {r.related_customer_ids.map((id) => (
                      <div key={id} className="flex justify-between gap-2 text-sm">
                        <span>{name(id)} · {customers[id]?.total_orders ?? 0} طلب</span>
                        {canManage && r.related_customer_ids.length === 2 && (
                          <Button size="sm" variant="outline" onClick={() => merge(r, id, r.related_customer_ids.find((x) => x !== id)!)}>إبقاء هذا ودمج الآخر فيه</Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {canManage && <Button size="sm" variant="ghost" onClick={() => dismiss(r)}>تجاهل</Button>}
              </div>
            ))}
          </CardContent></Card>
        <Card><CardHeader><CardTitle>عمليات الدمج</CardTitle></CardHeader>
          <CardContent className="space-y-2" data-testid="merges">
            {merges.length === 0 && <p className="text-sm text-muted-foreground">لا توجد عمليات دمج</p>}
            {merges.map((m) => (
              <div key={m.id} className="flex justify-between items-center gap-2 border-b pb-2 text-sm">
                <span>«{name(m.merged_customer_id)}» ← «{name(m.survivor_customer_id)}»</span>
                {m.undone_at ? <Badge variant="outline">تم التراجع</Badge>
                  : canManage ? <Button size="sm" variant="outline" onClick={() => undo(m)}>تراجع</Button> : <Badge>نشط</Badge>}
              </div>
            ))}
          </CardContent></Card>
      </div>
    </DashboardLayout>
  );
}
