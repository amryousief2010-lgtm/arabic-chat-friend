import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { PhoneReviewQueueView, type PhoneReviewCustomer, type PhoneReviewItem } from "@/components/chatManagement/PhoneReviewQueueView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { canManageConversations, canReviewPhones } from "@/config/chatManagement";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  composePhoneValue,
  currentReviewMonth,
  ISSUE_LABELS,
  needsDropConfirmation,
  pageCount,
  pageRangeLabel,
  PHONE_FIELD_LABELS,
  PHONE_REVIEW_PAGE_SIZE,
  phoneSaveErrorCode,
  phoneSaveErrorMessage,
  reviewLoadState,
  reviewMonthOptions,
  visiblePhoneParts,
  type PhoneField,
  type PhoneReviewIssue,
} from "@/lib/phoneReview";

const db = supabase as any;

interface MergeRow {
  id: string;
  survivor_customer_id: string;
  merged_customer_id: string;
  merged_at: string;
  undone_at: string | null;
}

const CAN_CORRECT = ["general_manager", "executive_manager", "sales_manager"];

export default function ChatPhoneReview() {
  const { roles } = useAuth() as { roles?: string[] };
  const canManage = canManageConversations(roles);
  const canCorrect = !!roles?.some((role) => CAN_CORRECT.includes(role));
  const canView = canReviewPhones(roles);
  const [month, setMonth] = useState(currentReviewMonth);
  const [issue, setIssue] = useState<"" | PhoneReviewIssue>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<PhoneReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [merges, setMerges] = useState<MergeRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<{ customer: PhoneReviewCustomer; field: PhoneField; parts: string[] } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const [list, mergeRows] = await Promise.all([
      db.rpc("cm_phone_review_list", {
        _month: month === "all" ? null : month,
        _issue: issue || null,
        _search: search || null,
        _page: page,
        _page_size: PHONE_REVIEW_PAGE_SIZE,
      }),
      canView
        ? db.from("cm_customer_merges").select("id,survivor_customer_id,merged_customer_id,merged_at,undone_at").order("merged_at", { ascending: false }).limit(20)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (list.error) {
      setItems([]);
      setTotal(0);
      setError(true);
      setLoading(false);
      return;
    }
    const payload = list.data ?? {};
    const nextItems = (payload.items ?? []) as PhoneReviewItem[];
    setItems(nextItems);
    setTotal(Number(payload.total ?? 0));
    const mg = (mergeRows.data ?? []) as MergeRow[];
    setMerges(mg);
    const known = Object.fromEntries(nextItems.flatMap((item) => item.customers.map((customer) => [customer.id, customer.name ?? customer.id.slice(0, 8)])));
    setNames(known);
    setLoading(false);
  }, [month, issue, search, page, canView]);

  useEffect(() => { load(); }, [load]);

  const state = reviewLoadState(loading, error, items.length);
  const pages = pageCount(total, PHONE_REVIEW_PAGE_SIZE);

  const savePhone = async (confirmDrop: boolean) => {
    if (!edit) return;
    const value = composePhoneValue(edit.parts);
    const originalCount = visiblePhoneParts(edit.field === "phone" ? edit.customer.phone : edit.customer.phone2).length;
    if (!confirmDrop && needsDropConfirmation(originalCount, edit.parts)) {
      if (!window.confirm("سيتم الإبقاء على عدد أقل من الأرقام في هذا الحقل. الرقم المحذوف لن يُنقل إلى طلبات قديمة. هل تريد المتابعة؟")) return;
      confirmDrop = true;
    }
    if (!window.confirm(`حفظ ${PHONE_FIELD_LABELS[edit.field]} بعد التصحيح؟ لن تتغير باقي بيانات العميل ولا أرقام الطلبات القديمة.`)) return;
    setSaving(true);
    const { error: saveError } = await db.rpc("cm_correct_customer_phone", {
      _customer_id: edit.customer.id,
      _field: edit.field,
      _value: value,
      _confirm_drop: confirmDrop,
    });
    setSaving(false);
    if (saveError) {
      const code = phoneSaveErrorCode(saveError.message);
      if (code === "CM_PHONE_DROP_CONFIRM") {
        if (window.confirm("الحقل فيه أكثر من رقم. الحفظ سيبقي الأرقام التي كتبتها فقط. هل تؤكد؟")) {
          await savePhone(true);
        }
        return;
      }
      toast.error(phoneSaveErrorMessage(code));
      return;
    }
    toast.success("تم تصحيح الرقم");
    setEdit(null);
    load();
  };

  const dismiss = async (item: PhoneReviewItem) => {
    const { error: dismissError } = await db.from("cm_phone_review_queue").update({ status: "dismissed", resolution: "dismissed" }).eq("id", item.id);
    if (dismissError) toast.error("تعذّر التجاهل");
    else load();
  };

  const merge = async (item: PhoneReviewItem, survivor: string, merged: string) => {
    const survivorName = names[survivor] ?? "العميل";
    const mergedName = names[merged] ?? "العميل";
    if (!window.confirm(`دمج «${mergedName}» في «${survivorName}»؟ يمكن التراجع لاحقاً.`)) return;
    const { error: mergeError } = await db.rpc("cm_merge_customers", { _survivor: survivor, _merged: merged, _reason: "phone_review", _review_id: item.id });
    if (mergeError) toast.error("تعذّر الدمج");
    else { toast.success("تم الدمج"); load(); }
  };

  const undo = async (row: MergeRow) => {
    if (!window.confirm("التراجع عن هذا الدمج؟")) return;
    const { error: undoError } = await db.rpc("cm_undo_merge", { _merge_id: row.id });
    if (undoError) toast.error("تعذّر التراجع");
    else { toast.success("تم التراجع"); load(); }
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-4">
        <Header title="مراجعة الأرقام ودمج العملاء" subtitle="تصحيح الرقم من حقل العميل نفسه. التجاهل والدمج لمديرة المبيعات والمدير العام، ولا يغيّران طلبات قديمة." />
        {!canCorrect && <Badge variant="secondary">عرض فقط</Badge>}
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>الطابور</CardTitle>
            <CardDescription>{pageRangeLabel(page, PHONE_REVIEW_PAGE_SIZE, total)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-4">
              <label className="text-sm space-y-1">
                <span>الشهر</span>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  value={month}
                  onChange={(event) => { setMonth(event.target.value); setPage(1); }}
                  aria-label="شهر الطلبات"
                >
                  {reviewMonthOptions().map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm space-y-1">
                <span>نوع المشكلة</span>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2"
                  value={issue}
                  onChange={(event) => { setIssue(event.target.value as "" | PhoneReviewIssue); setPage(1); }}
                  aria-label="نوع المشكلة"
                >
                  <option value="">كل الأنواع</option>
                  {(Object.keys(ISSUE_LABELS) as PhoneReviewIssue[]).map((key) => (
                    <option key={key} value={key}>{ISSUE_LABELS[key]}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm space-y-1 md:col-span-2">
                <span>بحث بالاسم أو الرقم أو رقم الطلب</span>
                <div className="flex gap-2">
                  <Input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") { setSearch(searchInput.trim()); setPage(1); }
                    }}
                    aria-label="بحث"
                  />
                  <Button type="button" className="bg-primary" onClick={() => { setSearch(searchInput.trim()); setPage(1); }}>بحث</Button>
                </div>
              </label>
            </div>

            {state === "loading" && <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>}
            {state === "error" && (
              <div className="space-y-2">
                <p className="text-sm text-destructive">تعذّر تحميل الطابور. لم تُعرض نتائج ناقصة.</p>
                <Button type="button" variant="outline" onClick={load}>إعادة المحاولة</Button>
              </div>
            )}
            {state === "empty" && (
              <p className="text-sm text-muted-foreground">لا توجد حالات مطابقة لهذا الشهر أو البحث. جرّب «كل الشهور» أو أزل التصفية.</p>
            )}
            {state === "ready" && (
              <PhoneReviewQueueView
                items={items}
                canCorrect={canCorrect}
                canManage={canManage}
                onEdit={(customer, field) => setEdit({
                  customer,
                  field,
                  parts: visiblePhoneParts(field === "phone" ? customer.phone : customer.phone2),
                })}
                onDismiss={dismiss}
                onMerge={merge}
              />
            )}

            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</Button>
              <span className="text-sm">صفحة {page} من {pages}</span>
              <Button type="button" variant="outline" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>التالي</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>عمليات الدمج</CardTitle></CardHeader>
          <CardContent className="space-y-2" data-testid="merges">
            {merges.length === 0 && <p className="text-sm text-muted-foreground">لا توجد عمليات دمج</p>}
            {merges.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2 border-b pb-2 text-sm">
                <span>دمج عميلين</span>
                {row.undone_at ? <Badge variant="outline">تم التراجع</Badge>
                  : canManage ? <Button size="sm" variant="outline" onClick={() => undo(row)}>تراجع</Button> : <Badge>نشط</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!edit} onOpenChange={(open) => { if (!open) setEdit(null); }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تصحيح {edit ? PHONE_FIELD_LABELS[edit.field] : "الرقم"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {edit?.parts.map((part, index) => (
              <Input
                key={index}
                dir="ltr"
                value={part}
                aria-label={edit.parts.length > 1 ? `الرقم ${index + 1}` : "الرقم"}
                onChange={(event) => setEdit((current) => current && ({
                  ...current,
                  parts: current.parts.map((value, partIndex) => partIndex === index ? event.target.value : value),
                }))}
              />
            ))}
            <p className="text-xs text-muted-foreground">يُحفظ في حقل العميل فقط. أرقام الطلبات القديمة تبقى كما سُجّلت.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEdit(null)}>إلغاء</Button>
            <Button type="button" className="bg-primary" disabled={saving} onClick={() => savePhone(false)}>
              {saving ? "جارٍ الحفظ…" : "حفظ التصحيح"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
