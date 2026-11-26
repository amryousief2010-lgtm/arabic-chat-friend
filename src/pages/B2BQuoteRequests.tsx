import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  AlertTriangle, Building2, ChefHat, Coffee, Eye, Hotel, Link2, Phone, RefreshCw, Search, UserPlus, UtensilsCrossed,
} from "lucide-react";
import { canManageB2BQuotes } from "@/config/b2bQuotes";
import {
  type B2BStatus, type FacilityType, type QuoteFilters, FACILITY_LABELS, STATUS_LABELS, STATUS_ORDER, STATUS_STYLES,
  b2bErrorMessage, filterQuotes, formatCairo, money, productLabel, refLabel, statusChangeBlocker, statusCounts,
} from "@/lib/b2bQuotes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const BRAND = { primary: "#A4288A", deep: "#662D8C", accent: "#F37346" };

/** Explicit columns: the full mobile is not readable from the table (column grant). */
const COLUMNS = [
  "id", "ref_no", "facility_name", "facility_type", "contact_name", "phone_masked", "governorate",
  "requested_products", "weekly_qty", "notes", "source", "attribution", "status", "assigned_to", "assigned_at",
  "quote_amount", "quote_notes", "status_reason", "possible_match", "match_customer_ids", "linked_customer_id",
  "linked_at", "site_submitted_at", "status_changed_at", "created_at",
].join(", ");

export interface QuoteRow {
  id: string;
  ref_no: number;
  facility_name: string;
  facility_type: FacilityType;
  contact_name: string;
  phone_masked: string;
  governorate: string;
  requested_products: string[];
  weekly_qty: string | null;
  notes: string | null;
  source: string;
  attribution: Record<string, string> | null;
  status: B2BStatus;
  assigned_to: string | null;
  assigned_at: string | null;
  quote_amount: number | null;
  quote_notes: string | null;
  status_reason: string | null;
  possible_match: boolean;
  match_customer_ids: string[];
  linked_customer_id: string | null;
  linked_at: string | null;
  site_submitted_at: string | null;
  status_changed_at: string;
  created_at: string;
}

interface Person { id: string; name: string }
interface Candidate { customer_id: string; name: string; phone_masked: string; governorate: string | null; total_orders: number }
interface AuditRow { id: string; action: string; actor: string | null; details: Record<string, unknown> | null; created_at: string }

const TYPE_ICON: Record<FacilityType, typeof Hotel> = { hotel: Hotel, restaurant: UtensilsCrossed, cafe: Coffee, catering: ChefHat };

const AUDIT_LABELS: Record<string, string> = {
  received: "وصل من الموقع",
  assigned: "إسناد",
  updated: "تحديث الحالة / العرض",
  customer_linked: "ربط بعميل موجود",
  customer_created: "إنشاء عميل شركة",
  phone_revealed: "إظهار رقم الموبايل",
};

export function StatusPill({ status }: { status: B2BStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span className="inline-flex items-center rounded-full px-3 py-0.5 text-xs font-bold whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.fg, border: `1px solid ${s.border}` }}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function TypeTag({ type }: { type: FacilityType }) {
  const Icon = TYPE_ICON[type] ?? Building2;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: BRAND.deep }}>
      <Icon className="w-3.5 h-3.5" />{FACILITY_LABELS[type] ?? type}
    </span>
  );
}

export default function B2BQuoteRequests() {
  const { user, roles } = useAuth();
  const canManage = canManageB2BQuotes(roles);
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filters, setFilters] = useState<QuoteFilters>({
    status: "all", type: "all", governorate: "all", search: "", matchOnly: false, mineOnly: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db.from("b2b_quote_requests").select(COLUMNS)
      .order("created_at", { ascending: false }).limit(500);
    if (error) toast.error("تعذّر تحميل طلبات عروض الأسعار");
    setRows(((data ?? []) as QuoteRow[]).map((r) => ({ ...r, quote_amount: r.quote_amount == null ? null : Number(r.quote_amount) })));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!canManage) return;
    (async () => {
      const r = await db.from("user_roles").select("user_id, role").in("role", ["sales_moderator", "sales_manager"]);
      const ids = Array.from(new Set(((r.data ?? []) as { user_id: string }[]).map((x) => x.user_id)));
      if (!ids.length) return;
      const { data: profs } = await db.from("profile_directory").select("id, full_name").in("id", ids);
      setPeople(((profs ?? []) as { id: string; full_name: string }[])
        .map((x) => ({ id: x.id, name: x.full_name })).sort((a, b) => a.name.localeCompare(b.name, "ar")));
    })();
  }, [canManage]);

  const personName = useCallback((id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? "—" : "غير مُسند"), [people]);
  const counts = useMemo(() => statusCounts(rows), [rows]);
  const governorates = useMemo(() => Array.from(new Set(rows.map((r) => r.governorate))).sort((a, b) => a.localeCompare(b, "ar")), [rows]);
  const visible = useMemo(() => filterQuotes(rows, { ...filters, userId: user?.id ?? null }), [rows, filters, user?.id]);
  const open = rows.find((r) => r.id === openId) ?? null;
  const set = (p: Partial<QuoteFilters>) => setFilters((f) => ({ ...f, ...p }));

  return (
    <DashboardLayout>
      <div dir="rtl" className="font-cairo space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <Header title="طلبات عروض الأسعار"
            subtitle="الفنادق والمطاعم — من الموقع، منفصلة عن طلبات التجزئة. التسعير بعرض سعر لكل منشأة." />
          <Button variant="outline" size="sm" onClick={load} disabled={loading} aria-label="تحديث">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* شريط الحالات */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2" role="tablist" aria-label="تصفية بالحالة">
          {(["all", ...STATUS_ORDER] as const).map((s) => {
            const active = filters.status === s;
            return (
              <button key={s} role="tab" aria-selected={active} onClick={() => set({ status: s })}
                className="rounded-xl border px-3 py-2 text-right transition-colors"
                style={active ? { backgroundColor: BRAND.primary, borderColor: BRAND.primary, color: "#fff" } : { backgroundColor: "#fff" }}>
                <div className="text-[11px] opacity-80">{s === "all" ? "الكل" : STATUS_LABELS[s]}</div>
                <div className="text-xl font-extrabold tabular-nums" dir="ltr" style={{ textAlign: "right" }}>{counts[s]}</div>
              </button>
            );
          })}
        </div>

        {/* الفلاتر */}
        <Card>
          <CardContent className="p-3 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-muted-foreground" />
              <Input value={filters.search} onChange={(e) => set({ search: e.target.value })}
                placeholder="بحث باسم المنشأة أو المسؤول أو رقم الطلب" className="pr-9" />
            </div>
            <Select value={filters.type} onValueChange={(v) => set({ type: v as FacilityType | "all" })}>
              <SelectTrigger className="w-[140px]" aria-label="نوع المنشأة"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                {(Object.keys(FACILITY_LABELS) as FacilityType[]).map((t) => <SelectItem key={t} value={t}>{FACILITY_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.governorate} onValueChange={(v) => set({ governorate: v })}>
              <SelectTrigger className="w-[150px]" aria-label="المحافظة"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المحافظات</SelectItem>
                {governorates.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={filters.matchOnly} onCheckedChange={(v) => set({ matchOnly: v === true })} />
              عميل محتمل مطابق فقط
            </label>
            {canManage && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={!!filters.mineOnly} onCheckedChange={(v) => set({ mineOnly: v === true })} />
                المُسندة إليّ
              </label>
            )}
          </CardContent>
        </Card>

        {!loading && visible.length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            {rows.length === 0 ? (canManage ? "لا توجد طلبات عروض أسعار بعد" : "لا توجد طلبات مُسندة إليك") : "لا توجد طلبات مطابقة للفلاتر"}
          </CardContent></Card>
        )}

        {/* جدول — شاشات كبيرة */}
        {visible.length > 0 && (
          <Card className="hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: "#F7F3ED" }}>
                <tr className="text-right text-xs text-muted-foreground">
                  <th className="p-3 font-semibold">رقم الطلب</th>
                  <th className="p-3 font-semibold">المنشأة</th>
                  <th className="p-3 font-semibold">المسؤول</th>
                  <th className="p-3 font-semibold">المحافظة</th>
                  <th className="p-3 font-semibold">المنتجات</th>
                  <th className="p-3 font-semibold">المسؤول بالمبيعات</th>
                  <th className="p-3 font-semibold">الحالة</th>
                  <th className="p-3 font-semibold">وصل</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} data-testid="quote-row" onClick={() => setOpenId(r.id)}
                    className="border-t cursor-pointer hover:bg-[#FBF7FA]">
                    <td className="p-3 font-bold tabular-nums" dir="ltr" style={{ color: BRAND.primary, textAlign: "right" }}>{refLabel(r.ref_no)}</td>
                    <td className="p-3">
                      <div className="font-bold flex items-center gap-2">{r.facility_name}
                        {r.possible_match && <AlertTriangle className="w-4 h-4" style={{ color: BRAND.accent }} aria-label="عميل محتمل مطابق" />}
                      </div>
                      <TypeTag type={r.facility_type} />
                    </td>
                    <td className="p-3">{r.contact_name}<div className="text-xs text-muted-foreground" dir="ltr" style={{ textAlign: "right" }}>{r.phone_masked}</div></td>
                    <td className="p-3">{r.governorate}</td>
                    <td className="p-3 max-w-[220px]"><span className="line-clamp-2 text-xs">{r.requested_products.map(productLabel).join("، ") || "—"}</span></td>
                    <td className="p-3 text-xs">{personName(r.assigned_to)}</td>
                    <td className="p-3"><StatusPill status={r.status} />
                      {r.quote_amount != null && <div className="text-xs mt-1 tabular-nums">{money(r.quote_amount)}</div>}
                    </td>
                    <td className="p-3 text-xs tabular-nums" dir="ltr" style={{ textAlign: "right" }}>{formatCairo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {/* كروت — موبايل */}
        <div className="md:hidden space-y-3">
          {visible.map((r) => (
            <Card key={r.id} data-testid="quote-card" onClick={() => setOpenId(r.id)} className="cursor-pointer">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold flex items-center gap-2">{r.facility_name}
                      {r.possible_match && <AlertTriangle className="w-4 h-4" style={{ color: BRAND.accent }} />}
                    </div>
                    <TypeTag type={r.facility_type} />
                  </div>
                  <StatusPill status={r.status} />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{r.contact_name} • {r.governorate}</span>
                  <span className="font-bold tabular-nums" dir="ltr" style={{ color: BRAND.primary }}>{refLabel(r.ref_no)}</span>
                </div>
                <div className="text-xs line-clamp-1">{r.requested_products.map(productLabel).join("، ") || "—"}</div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{personName(r.assigned_to)}</span>
                  <span dir="ltr" className="tabular-nums">{formatCairo(r.created_at)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent side="left" dir="rtl" className="font-cairo w-full sm:max-w-[560px] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
          {open && (
            <QuoteDetail key={open.id} row={open} canManage={canManage} people={people} personName={personName}
              onChanged={load} />
          )}
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{children}</div>
    </div>
  );
}

function QuoteDetail({ row, canManage, people, personName, onChanged }: {
  row: QuoteRow; canManage: boolean; people: Person[]; personName: (id: string | null) => string; onChanged: () => void;
}) {
  const [phone, setPhone] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [linkedName, setLinkedName] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [assignee, setAssignee] = useState<string>(row.assigned_to ?? "none");
  const [next, setNext] = useState<B2BStatus>(row.status);
  const [amount, setAmount] = useState<string>(row.quote_amount != null ? String(row.quote_amount) : "");
  const [quoteNotes, setQuoteNotes] = useState(row.quote_notes ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    db.from("b2b_quote_request_audit").select("id, action, actor, details, created_at").eq("request_id", row.id)
      .order("created_at", { ascending: false }).then(({ data }: { data: AuditRow[] | null }) => setAudit(data ?? []));
    if (canManage && row.possible_match && !row.linked_customer_id)
      db.rpc("b2b_quote_customer_candidates", { _id: row.id }).then(({ data }: { data: Candidate[] | null }) => setCandidates(data ?? []));
    if (row.linked_customer_id)
      db.from("customers").select("name").eq("id", row.linked_customer_id).maybeSingle()
        .then(({ data }: { data: { name: string } | null }) => setLinkedName(data?.name ?? null));
  }, [row.id, row.possible_match, row.linked_customer_id, canManage]);

  const parsedAmount = amount.trim() === "" ? null : Number(amount.replace(/,/g, ""));
  const blocker = statusChangeBlocker({ next, amount: parsedAmount, existingAmount: row.quote_amount, reason });
  const dirty = next !== row.status || (parsedAmount ?? null) !== (row.quote_amount ?? null) || quoteNotes !== (row.quote_notes ?? "") || reason.trim() !== "";

  const run = async (fn: () => Promise<{ error: { message?: string } | null }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) return toast.error(b2bErrorMessage(error));
    toast.success(ok);
    onChanged();
  };

  const reveal = async () => {
    const { data, error } = await db.rpc("b2b_quote_reveal_phone", { _id: row.id });
    if (error) return toast.error(b2bErrorMessage(error));
    setPhone(data as string);
  };

  const save = () => run(() => db.rpc("b2b_quote_update", {
    _id: row.id, _status: next, _quote_amount: parsedAmount, _quote_notes: quoteNotes || null, _reason: reason || null,
  }), "تم حفظ التحديث");

  const assign = () => run(() => db.rpc("b2b_quote_assign", { _id: row.id, _user_id: assignee === "none" ? null : assignee }), "تم الإسناد");

  const link = (customerId: string | null) => {
    const msg = customerId
      ? "ربط هذا الطلب بالعميل المختار؟ لن تتغير بيانات العميل ولن يتم دمج أي سجلات."
      : `إنشاء عميل شركة جديد باسم «${row.facility_name}» وربطه بهذا الطلب؟`;
    if (!window.confirm(msg)) return;
    void run(() => db.rpc("b2b_quote_link_customer", { _id: row.id, _customer_id: customerId }),
      customerId ? "تم الربط بالعميل" : "تم إنشاء عميل الشركة وربطه");
  };

  return (
    <div className="space-y-5 pt-2">
      <SheetHeader className="text-right sm:text-right space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-extrabold tabular-nums" dir="ltr" style={{ color: BRAND.primary }}>{refLabel(row.ref_no)}</span>
          <StatusPill status={row.status} />
        </div>
        <SheetTitle className="text-xl font-extrabold">{row.facility_name}</SheetTitle>
        <SheetDescription asChild><div><TypeTag type={row.facility_type} /> <span className="text-xs">• {row.governorate}</span></div></SheetDescription>
      </SheetHeader>

      <section className="grid grid-cols-2 gap-4 rounded-xl border p-4" style={{ backgroundColor: "#FCFAF7" }}>
        <Field label="اسم المسؤول">{row.contact_name}</Field>
        <Field label="الموبايل">
          <span className="inline-flex items-center gap-2">
            <span dir="ltr" className="tabular-nums">{phone ?? row.phone_masked}</span>
            {phone
              ? <a href={`tel:${phone}`} className="text-xs underline" style={{ color: BRAND.primary }}><Phone className="w-3.5 h-3.5 inline" /> اتصال</a>
              : <button type="button" onClick={reveal} className="text-xs underline" style={{ color: BRAND.primary }}><Eye className="w-3.5 h-3.5 inline" /> إظهار</button>}
          </span>
        </Field>
        <Field label="وصل في"><span dir="ltr" className="tabular-nums">{formatCairo(row.created_at)}</span></Field>
        <Field label="المصدر">الموقع — للفنادق والمطاعم{row.attribution?.utm_source ? ` (${row.attribution.utm_source})` : ""}</Field>
        <div className="col-span-2">
          <Field label="المنتجات المطلوبة">
            <div className="flex flex-wrap gap-1.5 mt-1">
              {row.requested_products.length === 0 && <span className="text-muted-foreground">لم يحدد</span>}
              {row.requested_products.map((p) => (
                <Badge key={p} variant="outline" className="font-semibold" style={{ borderColor: "#E3B8D9", color: BRAND.deep }}>{productLabel(p)}</Badge>
              ))}
            </div>
          </Field>
        </div>
        <div className="col-span-2"><Field label="الكمية الأسبوعية المتوقعة">{row.weekly_qty ?? "—"}</Field></div>
        <div className="col-span-2"><Field label="ملاحظات العميل"><span className="font-normal whitespace-pre-wrap">{row.notes ?? "—"}</span></Field></div>
      </section>

      {/* العميل — ربط يدوي فقط */}
      <section className="space-y-2">
        <h3 className="text-sm font-extrabold" style={{ color: BRAND.deep }}>العميل في السيستم</h3>
        {row.linked_customer_id ? (
          <div className="rounded-lg border p-3 text-sm flex items-center justify-between">
            <span><Link2 className="w-4 h-4 inline ml-1" style={{ color: BRAND.primary }} />مربوط بالعميل: <b>{linkedName ?? "—"}</b></span>
            <Link to="/customers" className="text-xs underline" style={{ color: BRAND.primary }}>فتح العملاء</Link>
          </div>
        ) : (
          <>
            {row.possible_match && (
              <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "#F8C3A8", backgroundColor: "#FDF3EE" }}>
                <div className="flex items-center gap-2 font-bold" style={{ color: "#B4521F" }}>
                  <AlertTriangle className="w-4 h-4" />عميل محتمل مطابق بنفس رقم الموبايل — راجِع قبل الربط (لا دمج تلقائي)
                </div>
                {canManage && candidates && candidates.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {candidates.map((c) => (
                      <li key={c.customer_id} className="flex items-center justify-between gap-2 rounded-md bg-white border px-2 py-1.5">
                        <span className="text-xs"><b>{c.name}</b> • <span dir="ltr">{c.phone_masked}</span> • {c.governorate ?? "—"} • <span className="tabular-nums">{c.total_orders}</span> طلب</span>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => link(c.customer_id)}>ربط</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {canManage ? (
              <Button variant="outline" disabled={busy} onClick={() => link(null)} className="gap-2" style={{ borderColor: BRAND.primary, color: BRAND.primary }}>
                <UserPlus className="w-4 h-4" />إنشاء عميل شركة جديد من الطلب
              </Button>
            ) : <p className="text-xs text-muted-foreground">الربط بعميل يتم بواسطة مدير المبيعات.</p>}
          </>
        )}
      </section>

      {canManage && (
        <section className="space-y-2">
          <h3 className="text-sm font-extrabold" style={{ color: BRAND.deep }}>الإسناد</h3>
          <div className="flex gap-2">
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger className="flex-1" aria-label="إسناد إلى"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">غير مُسند</SelectItem>
                {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button disabled={busy || assignee === (row.assigned_to ?? "none")} onClick={assign} style={{ backgroundColor: BRAND.deep }}>إسناد</Button>
          </div>
          <p className="text-xs text-muted-foreground">الحالي: {personName(row.assigned_to)}</p>
        </section>
      )}

      <section className="space-y-3 rounded-xl border p-4">
        <h3 className="text-sm font-extrabold" style={{ color: BRAND.deep }}>الحالة وعرض السعر</h3>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_ORDER.map((s) => (
            <button key={s} type="button" onClick={() => setNext(s)} aria-pressed={next === s}
              className="rounded-full border px-3 py-1 text-xs font-bold"
              style={next === s ? { backgroundColor: BRAND.primary, borderColor: BRAND.primary, color: "#fff" } : { backgroundColor: "#fff" }}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">قيمة العرض (ج.م)</span>
            <Input inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </label>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">القيمة الحالية</span>
            <div className="h-10 flex items-center text-sm font-bold tabular-nums">{money(row.quote_amount)}</div>
          </div>
        </div>
        <label className="space-y-1 block">
          <span className="text-xs text-muted-foreground">ملاحظات العرض (الأصناف، الكميات، مدة السريان، التوريد)</span>
          <Textarea rows={3} value={quoteNotes} onChange={(e) => setQuoteNotes(e.target.value)} />
        </label>
        {(next === "rejected" || reason) && (
          <label className="space-y-1 block">
            <span className="text-xs text-muted-foreground">سبب الرفض</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: السعر أعلى من الميزانية" />
          </label>
        )}
        {row.status_reason && <p className="text-xs text-muted-foreground">السبب المسجل: {row.status_reason}</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs" style={{ color: "#B4521F" }}>{dirty ? blocker ?? "" : ""}</span>
          <Button disabled={busy || !dirty || !!blocker} onClick={save} style={{ backgroundColor: BRAND.primary }}>حفظ</Button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-extrabold" style={{ color: BRAND.deep }}>سجل الطلب</h3>
        <ol className="space-y-1.5 border-r-2 pr-3" style={{ borderColor: "#E3B8D9" }}>
          {audit.map((a) => (
            <li key={a.id} className="text-xs">
              <span className="font-bold">{AUDIT_LABELS[a.action] ?? a.action}</span>
              {a.details && typeof a.details.to_status === "string" && <> — {STATUS_LABELS[a.details.to_status as B2BStatus] ?? ""}</>}
              {a.actor && <> • {personName(a.actor)}</>}
              <span className="text-muted-foreground"> — </span><span className="text-muted-foreground tabular-nums inline-block" dir="ltr">{formatCairo(a.created_at)}</span>
            </li>
          ))}
          {audit.length === 0 && <li className="text-xs text-muted-foreground">—</li>}
        </ol>
      </section>
    </div>
  );
}
