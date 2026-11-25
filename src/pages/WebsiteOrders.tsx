import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import GovernorateSelect from "@/components/shared/GovernorateSelect";
import { FULFILLMENT_OPTIONS, deliveryAddressLine, splitWooAddress } from "@/lib/wooAddress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Globe, Link2, MapPin, RefreshCw, Truck, UserPlus, XCircle } from "lucide-react";
import {
  type InboxItem, type InboxKind, type InboxStatus, type MappedItem, type ProductMapRow,
  KIND_LABELS, STATUS_LABELS, assignBlocker, attributionLabel, formatCairo, mapItems, maskPhone,
  unmappedCount, websiteErrorMessage,
} from "@/lib/websiteOrders";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const BRAND = { primary: "#A4288A", deep: "#662D8C", accent: "#F37346" };

interface InboxRow {
  id: string;
  kind: InboxKind;
  status: InboxStatus;
  woo_order_id: number | null;
  woo_customer_id: number | null;
  woo_status: string | null;
  customer_name: string | null;
  phone_raw: string | null;
  email: string | null;
  address: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city: string | null;
  governorate: string | null;
  items: InboxItem[] | null;
  shipping_total: number | null;
  discount_total: number | null;
  order_total: number | null;
  payment_method_title: string | null;
  customer_note: string | null;
  attribution: Record<string, string> | null;
  site_created_at: string | null;
  created_at: string;
  possible_duplicate: boolean;
  assigned_moderator_user_id: string | null;
  created_order_id: string | null;
  assigned_at: string | null;
  dismiss_reason: string | null;
  site_changed_after_assign: boolean;
}

interface Option { id: string; name: string }
interface Candidate { customer_id: string; name: string; phone_masked: string; total_orders: number; last_order_at: string | null }

const STATUS_FILTERS: { value: InboxStatus | "all"; label: string }[] = [
  { value: "new", label: "الجديدة" },
  { value: "assigned", label: "تم إسنادها" },
  { value: "cancelled_on_site", label: "ملغاة على الموقع" },
  { value: "dismissed", label: "مُتجاهَلة" },
  { value: "all", label: "الكل" },
];

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} ج.م`);

export default function WebsiteOrders() {
  const [kind, setKind] = useState<InboxKind>("order");
  const [statusFilter, setStatusFilter] = useState<InboxStatus | "all">("new");
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [maps, setMaps] = useState<ProductMapRow[]>([]);
  const [products, setProducts] = useState<Option[]>([]);
  const [boxes, setBoxes] = useState<Option[]>([]);
  const [moderators, setModerators] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = db.from("website_inbox").select("*").eq("kind", kind).order("created_at", { ascending: false }).limit(200);
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    const [inbox, mapRes] = await Promise.all([q, db.from("woo_product_map").select("woo_product_id, woo_variation_id, kind, product_id, offer_box_id")]);
    if (inbox.error) toast.error("تعذّر تحميل طلبات الموقع");
    setRows((inbox.data ?? []) as InboxRow[]);
    setMaps(((mapRes.data ?? []) as ProductMapRow[]).map((m) => ({ ...m, woo_product_id: Number(m.woo_product_id), woo_variation_id: Number(m.woo_variation_id) })));
    setLoading(false);
  }, [kind, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    (async () => {
      const [p, b, r] = await Promise.all([
        db.from("products").select("id, name").eq("is_active", true).order("name"),
        db.from("offer_boxes").select("id, name").eq("is_active", true).order("name"),
        db.from("user_roles").select("user_id").eq("role", "sales_moderator"),
      ]);
      setProducts((p.data ?? []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
      setBoxes((b.data ?? []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
      const ids = Array.from(new Set((r.data ?? []).map((x: { user_id: string }) => x.user_id)));
      if (ids.length) {
        const { data: profs } = await db.from("profile_directory").select("id, full_name").in("id", ids);
        setModerators(((profs ?? []) as { id: string; full_name: string }[])
          .map((x) => ({ id: x.id, name: x.full_name }))
          .sort((a, c) => a.name.localeCompare(c.name, "ar")));
      }
    })();
  }, []);

  const moderatorName = useCallback((id: string | null) => moderators.find((m) => m.id === id)?.name ?? "—", [moderators]);

  return (
    <DashboardLayout>
      <div dir="rtl" className="font-cairo space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <Header title="طلبات الموقع" subtitle="الطلبات والتسجيلات الواردة من الموقع الإلكتروني، تُسند إلى مودريتور ليُنشأ الطلب باسمها" />
          <Button variant="outline" size="sm" onClick={load} disabled={loading} aria-label="تحديث">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={kind} onValueChange={(v) => setKind(v as InboxKind)}>
            <TabsList>
              <TabsTrigger value="order">طلبات الموقع</TabsTrigger>
              <TabsTrigger value="registration">تسجيلات العملاء</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f) => (
              <Button key={f.value} size="sm" variant={statusFilter === f.value ? "default" : "outline"}
                style={statusFilter === f.value ? { backgroundColor: BRAND.primary } : undefined}
                onClick={() => setStatusFilter(f.value)}>
                {f.label}
              </Button>
            ))}
          </div>
        </div>

        {!loading && rows.length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد سجلات في هذا التصنيف</CardContent></Card>
        )}

        {rows.map((row) => (
          <InboxCard key={row.id} row={row} maps={maps} products={products} boxes={boxes}
            moderators={moderators} moderatorName={moderatorName} onChanged={load} />
        ))}
      </div>
    </DashboardLayout>
  );
}

function InboxCard({ row, maps, products, boxes, moderators, moderatorName, onChanged }: {
  row: InboxRow; maps: ProductMapRow[]; products: Option[]; boxes: Option[]; moderators: Option[];
  moderatorName: (id: string | null) => string; onChanged: () => void;
}) {
  const items: MappedItem[] = useMemo(() => mapItems(row.items, maps), [row.items, maps]);
  const [moderatorId, setModeratorId] = useState<string | null>(null);
  const [customerChoice, setCustomerChoice] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [showPhone, setShowPhone] = useState(false);
  const [dismissReason, setDismissReason] = useState("");
  const [busy, setBusy] = useState(false);
  const split = useMemo(
    () => splitWooAddress({ address_1: row.address_1, address_2: row.address_2, address: row.address, city: row.city, state: row.governorate }),
    [row.address_1, row.address_2, row.address, row.city, row.governorate],
  );
  const [gov, setGov] = useState(split.governorate);
  const [city, setCity] = useState(split.city);
  const [area, setArea] = useState(split.area);
  const [street, setStreet] = useState(split.address);
  const [fKey, setFKey] = useState<string>("later");
  const [shipCo, setShipCo] = useState("");
  const [updateCustomer, setUpdateCustomer] = useState(false);

  useEffect(() => {
    if (row.kind !== "order" || !row.possible_duplicate || row.status !== "new") return;
    db.rpc("website_inbox_customer_candidates", { _inbox_id: row.id }).then(({ data }: { data: Candidate[] | null }) => setCandidates(data ?? []));
  }, [row.id, row.kind, row.possible_duplicate, row.status]);

  const blocker = assignBlocker({ kind: row.kind, status: row.status, items, moderatorId, possibleDuplicate: row.possible_duplicate, customerChoice });

  const assign = async () => {
    if (blocker || !moderatorId) return;
    if (!window.confirm(`تأكيد إسناد ${KIND_LABELS[row.kind]} الموقع إلى ${moderatorName(moderatorId)}؟`)) return;
    setBusy(true);
    if (row.kind === "order" && fKey === "shipping_company" && !shipCo.trim()) {
      setBusy(false);
      return toast.error("اكتبي اسم شركة الشحن أو اتركي طريقة التسليم للمودريتور");
    }
    const existing = customerChoice && customerChoice !== "new" ? customerChoice : null;
    const { error } = await db.rpc("website_inbox_assign_v2", {
      _inbox_id: row.id,
      _moderator_user_id: moderatorId,
      _customer_id: existing,
      _create_new_customer: customerChoice === "new",
      _governorate: gov || null,
      _city: city.trim() || null,
      _area: area.trim() || null,
      _street: street.trim() || null,
      _fulfillment_key: row.kind === "order" && fKey !== "later" ? fKey : null,
      _shipping_company: fKey === "shipping_company" ? shipCo.trim() : null,
      _update_customer_address: !!existing && updateCustomer,
    });
    setBusy(false);
    if (error) return toast.error(websiteErrorMessage(error.message));
    toast.success(row.kind === "order" ? "تم إنشاء الطلب وإسناده" : "تم إسناد العميل للمتابعة");
    onChanged();
  };

  const dismiss = async () => {
    if (dismissReason.trim().length < 3) return toast.error(websiteErrorMessage("WEB_REASON_REQUIRED"));
    setBusy(true);
    const { error } = await db.rpc("website_inbox_dismiss", { _inbox_id: row.id, _reason: dismissReason.trim() });
    setBusy(false);
    if (error) return toast.error(websiteErrorMessage(error.message));
    toast.success("تم تجاهل السجل");
    onChanged();
  };

  const itemsTotal = items.reduce((s, i) => s + (Number(i.line_total ?? (i.unit_price ?? 0) * i.quantity) || 0), 0);
  const isNew = row.status === "new";

  return (
    <Card className="border-r-4" style={{ borderRightColor: isNew ? BRAND.accent : BRAND.deep }}>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Globe className="w-4 h-4" style={{ color: BRAND.primary }} />
          <span className="font-bold" style={{ color: BRAND.deep }}>
            {row.kind === "order" ? `طلب الموقع رقم ${row.woo_order_id}` : `تسجيل عميل رقم ${row.woo_customer_id}`}
          </span>
          <Badge style={{ backgroundColor: isNew ? BRAND.accent : BRAND.deep }}>{STATUS_LABELS[row.status]}</Badge>
          {row.possible_duplicate && <Badge variant="outline" className="border-amber-500 text-amber-700">عميل محتمل التكرار</Badge>}
          {row.site_changed_after_assign && (
            <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" />تغيّرت حالته على الموقع بعد الإسناد ({row.woo_status})</Badge>
          )}
          <span className="text-xs text-muted-foreground ms-auto">{formatCairo(row.site_created_at ?? row.created_at)}</span>
        </div>

        <div className="grid gap-1 text-sm md:grid-cols-2">
          <div><span className="text-muted-foreground">العميل: </span>{row.customer_name ?? "—"}</div>
          <div>
            <span className="text-muted-foreground">الهاتف: </span>
            <span dir="ltr">{showPhone ? row.phone_raw : maskPhone(row.phone_raw)}</span>
            {row.phone_raw && (
              <button type="button" className="text-xs underline ms-2" style={{ color: BRAND.primary }} onClick={() => setShowPhone((v) => !v)}>
                {showPhone ? "إخفاء" : "إظهار"}
              </button>
            )}
          </div>
          <div><span className="text-muted-foreground">العنوان على الموقع: </span>{[row.address, row.city, row.governorate].filter(Boolean).join("، ") || "—"}</div>
          <div><span className="text-muted-foreground">المصدر: </span>{attributionLabel(row.attribution)}</div>
          {row.kind === "order" && <div><span className="text-muted-foreground">الدفع على الموقع: </span>{row.payment_method_title ?? "—"}</div>}
          {row.customer_note && <div className="md:col-span-2"><span className="text-muted-foreground">ملاحظة العميل: </span>{row.customer_note}</div>}
        </div>

        {row.kind === "order" && (
          <div className="rounded-md border">
            {items.map((it, idx) => (
              <ItemRow key={`${it.woo_product_id}-${it.woo_variation_id ?? 0}-${idx}`} item={it} products={products} boxes={boxes}
                canMap={isNew} onMapped={onChanged} />
            ))}
            <div className="flex flex-wrap gap-4 p-2 text-sm bg-muted/40">
              <span>إجمالي البنود: {money(itemsTotal)}</span>
              <span>شحن الموقع: {money(row.shipping_total)}</span>
              {Number(row.discount_total) > 0 && <span>خصم الموقع: {money(row.discount_total)}</span>}
              <span className="font-bold">إجمالي الموقع: {money(row.order_total)}</span>
            </div>
            {Number(row.shipping_total) > 0 && isNew && (
              <div className="p-2 text-xs text-amber-700 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                شحن العروض يُحتسب من بيانات العرض في النظام؛ أما شحن المنتجات المنفردة فيُضبط مع العميل عند المكالمة، لذا قد يختلف الإجمالي عن إجمالي الموقع.
              </div>
            )}
          </div>
        )}

        {row.status === "assigned" && (
          <div className="text-sm flex flex-wrap items-center gap-3">
            <span>أُسند إلى: <b>{moderatorName(row.assigned_moderator_user_id)}</b> — {formatCairo(row.assigned_at)}</span>
            {row.created_order_id && (
              <Link to={`/orders/${row.created_order_id}`} className="underline" style={{ color: BRAND.primary }}>فتح الطلب في النظام</Link>
            )}
          </div>
        )}
        {row.status === "dismissed" && row.dismiss_reason && <div className="text-sm text-muted-foreground">سبب التجاهل: {row.dismiss_reason}</div>}

        {isNew && (
          <div className="space-y-3 border-t pt-3">
            {row.kind === "order" && row.possible_duplicate && (
              <div className="space-y-1">
                <div className="text-sm font-semibold">يوجد عميل مسجّل بنفس الرقم، يُرجى اختيار العميل الصحيح (لا يتم الدمج تلقائياً):</div>
                {(candidates ?? []).map((c) => (
                  <label key={c.customer_id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name={`cust-${row.id}`} checked={customerChoice === c.customer_id} onChange={() => setCustomerChoice(c.customer_id)} />
                    {c.name} — <span dir="ltr">{c.phone_masked}</span> — {c.total_orders} طلب — آخر طلب {formatCairo(c.last_order_at)}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name={`cust-${row.id}`} checked={customerChoice === "new"} onChange={() => setCustomerChoice("new")} />
                  <UserPlus className="w-4 h-4" /> عميل جديد
                </label>
              </div>
            )}
            {row.kind === "order" && (
              <div className="rounded-xl border bg-muted/20 p-3 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold" style={{ color: BRAND.deep }}>
                  <MapPin className="w-4 h-4" />
                  العنوان وطريقة التسليم
                  <span className="text-xs font-normal text-muted-foreground">(معبأة من بيانات الموقع وقابلة للتعديل)</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">المحافظة</div>
                    <GovernorateSelect value={gov} onChange={setGov} />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">المدينة</div>
                    <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="اختياري" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">المنطقة</div>
                    <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="اختياري" />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">العنوان (الشارع والمبنى والشقة)</div>
                  <Textarea rows={2} value={street} onChange={(e) => setStreet(e.target.value)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground flex items-center gap-1"><Truck className="w-3.5 h-3.5" />طريقة التسليم</div>
                    <Select value={fKey} onValueChange={setFKey}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="later">تحددها المودريتور بعد المكالمة</SelectItem>
                        {FULFILLMENT_OPTIONS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {fKey === "shipping_company" && (
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">اسم شركة الشحن</div>
                      <Input value={shipCo} onChange={(e) => setShipCo(e.target.value)} placeholder="مثل: بوسطة / أرامكس" />
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  عنوان التوصيل على الطلب: <span className="text-foreground">{deliveryAddressLine({ governorate: gov, city, area, address: street }) || "—"}</span>
                </div>
                {customerChoice && customerChoice !== "new" && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={updateCustomer} onCheckedChange={(v) => setUpdateCustomer(!!v)} />
                    تحديث عنوان العميل المختار بهذه البيانات (لن يتغير عنوانه بدون هذا الاختيار)
                  </label>
                )}
                <div className="text-xs text-muted-foreground">تستطيع المودريتور تغيير طريقة التسليم والمنفذ من الطلب بعد المكالمة.</div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={moderatorId ?? undefined} onValueChange={setModeratorId}>
                <SelectTrigger className="w-56"><SelectValue placeholder="اختيار المودريتور" /></SelectTrigger>
                <SelectContent>
                  {moderators.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={assign} disabled={!!blocker || busy} style={{ backgroundColor: BRAND.primary }}>
                {row.kind === "order" ? "إسناد وإنشاء الطلب" : "إسناد للمتابعة"}
              </Button>
              {blocker && moderatorId && <span className="text-xs text-destructive">{blocker}</span>}
              {row.kind === "order" && unmappedCount(items) > 0 && !moderatorId && (
                <span className="text-xs text-destructive">{`يوجد ${unmappedCount(items)} بند غير مربوط`}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input className="w-72" placeholder="سبب التجاهل (طلب تجريبي، مكرر...)" value={dismissReason} onChange={(e) => setDismissReason(e.target.value)} />
              <Button variant="outline" onClick={dismiss} disabled={busy} className="gap-1"><XCircle className="w-4 h-4" />تجاهل</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ItemRow({ item, products, boxes, canMap, onMapped }: {
  item: MappedItem; products: Option[]; boxes: Option[]; canMap: boolean; onMapped: () => void;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mappedName = item.map
    ? (item.map.kind === "offer_box" ? boxes.find((b) => b.id === item.map?.offer_box_id)?.name : products.find((p) => p.id === item.map?.product_id)?.name)
    : null;

  const save = async () => {
    if (!target) return;
    const [kind, id] = target.split(":");
    setSaving(true);
    const { error } = await db.rpc("website_inbox_map_product", {
      _woo_product_id: item.woo_product_id,
      _woo_variation_id: Number(item.woo_variation_id || 0),
      _product_id: kind === "p" ? id : null,
      _offer_box_id: kind === "b" ? id : null,
      _woo_name: item.name,
    });
    setSaving(false);
    if (error) return toast.error(websiteErrorMessage(error.message));
    toast.success("تم ربط المنتج");
    onMapped();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 text-sm border-b last:border-b-0">
      <span className="font-medium">{item.name}</span>
      <span className="text-muted-foreground">× {item.quantity}</span>
      <span className="text-muted-foreground">{money(item.unit_price)}</span>
      {item.map ? (
        <Badge variant="outline" className="gap-1" style={{ borderColor: BRAND.deep, color: BRAND.deep }}>
          <Link2 className="w-3 h-3" />{item.map.kind === "offer_box" ? "عرض: " : "منتج: "}{mappedName ?? "—"}
        </Badge>
      ) : (
        <>
          <Badge variant="destructive">غير مربوط</Badge>
          {canMap && (
            <>
              <Select value={target ?? undefined} onValueChange={setTarget}>
                <SelectTrigger className="w-56 h-8"><SelectValue placeholder="ربط بمنتج أو عرض" /></SelectTrigger>
                <SelectContent>
                  {boxes.map((b) => <SelectItem key={`b:${b.id}`} value={`b:${b.id}`}>عرض: {b.name}</SelectItem>)}
                  {products.map((p) => <SelectItem key={`p:${p.id}`} value={`p:${p.id}`}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" disabled={!target || saving} onClick={save}>ربط</Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
