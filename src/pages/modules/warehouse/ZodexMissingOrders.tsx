import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  ExternalLink, RefreshCw, Check, X, Loader2, ChevronDown, ChevronUp,
  Link2, Search,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface MissingRow {
  id: string;
  bill_no: string;
  customer_name: string | null;
  customer_phone: string | null;
  region: string | null;
  cod_amount: number | null;
  moderator_name: string | null;
  zodex_status: string | null;
  operation_type: string | null;
  shipment_date: string | null;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
}

interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  total_rows: number;
  delivered_matched: number;
  returned_matched: number;
  missing_created: number;
  missing_updated: number;
  error_message: string | null;
}

interface Candidate {
  id: string;
  order_number: string;
  total: number | null;
  created_at: string;
  moderator: string | null;
  shipping_bill_no: string | null;
  status: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_phone2: string | null;
  score: number;
  reasons: string[];
}

const normPhone = (v?: string | null) =>
  (v || "").replace(/\D+/g, "").replace(/^20/, "").slice(-11);

const phoneCloseness = (a?: string | null, b?: string | null) => {
  const x = normPhone(a);
  const y = normPhone(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // last 9 digits equal (single leading typo)
  if (x.slice(-9) === y.slice(-9) && x.length >= 10 && y.length >= 10) return 0.85;
  // hamming distance on equal-length
  if (x.length === y.length) {
    let diff = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff++;
    if (diff === 1) return 0.7;
    if (diff === 2) return 0.4;
  }
  return 0;
};

const nameCloseness = (a?: string | null, b?: string | null) => {
  const x = (a || "").trim().toLowerCase();
  const y = (b || "").trim().toLowerCase();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.7;
  const xs = new Set(x.split(/\s+/));
  const ys = new Set(y.split(/\s+/));
  let inter = 0;
  xs.forEach((t) => { if (ys.has(t)) inter++; });
  const uni = new Set([...xs, ...ys]).size || 1;
  return inter / uni;
};

function scoreCandidate(row: MissingRow, o: any): Candidate {
  const reasons: string[] = [];
  let score = 0;

  const pc = Math.max(
    phoneCloseness(row.customer_phone, o.customer?.phone),
    phoneCloseness(row.customer_phone, o.customer?.phone2),
  );
  if (pc === 1) { score += 60; reasons.push("الموبايل مطابق"); }
  else if (pc >= 0.85) { score += 40; reasons.push("الموبايل قريب جداً"); }
  else if (pc >= 0.7) { score += 25; reasons.push("الموبايل فيه فرق رقم"); }
  else if (pc >= 0.4) { score += 10; reasons.push("الموبايل فيه فرق رقمين"); }

  const cod = Number(row.cod_amount || 0);
  const total = Number(o.total || 0);
  if (cod > 0 && total > 0) {
    const diff = Math.abs(cod - total);
    if (diff < 0.5) { score += 25; reasons.push("المبلغ مطابق"); }
    else if (diff <= Math.max(5, cod * 0.02)) { score += 15; reasons.push(`المبلغ قريب (فرق ${diff.toFixed(0)})`); }
    else if (diff <= Math.max(20, cod * 0.05)) { score += 5; reasons.push(`المبلغ متقارب (فرق ${diff.toFixed(0)})`); }
  }

  const mod = nameCloseness(row.moderator_name, o.moderator);
  if (mod === 1) { score += 10; reasons.push("المندوبة مطابقة"); }
  else if (mod >= 0.5) { score += 5; reasons.push("المندوبة قريبة"); }

  const nm = nameCloseness(row.customer_name, o.customer?.name);
  if (nm === 1) { score += 10; reasons.push("الاسم مطابق"); }
  else if (nm >= 0.5) { score += 5; reasons.push("الاسم قريب"); }

  // cap at 100
  score = Math.min(100, score);

  return {
    id: o.id,
    order_number: o.order_number,
    total: o.total,
    created_at: o.created_at,
    moderator: o.moderator,
    shipping_bill_no: o.shipping_bill_no,
    status: o.status,
    customer_name: o.customer?.name ?? null,
    customer_phone: o.customer?.phone ?? null,
    customer_phone2: o.customer?.phone2 ?? null,
    score,
    reasons,
  };
}

export default function ZodexMissingOrders() {
  const [rows, setRows] = useState<MissingRow[]>([]);
  const [lastRun, setLastRun] = useState<RunRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [ignoreDialog, setIgnoreDialog] = useState<MissingRow | null>(null);
  const [ignoreReason, setIgnoreReason] = useState("");

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({});
  const [loadingCands, setLoadingCands] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");

  const [linkDialog, setLinkDialog] = useState<{ row: MissingRow; cand: Candidate } | null>(null);
  const [linking, setLinking] = useState(false);

  const [searchDialog, setSearchDialog] = useState<MissingRow | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: missing }, { data: runs }] = await Promise.all([
      supabase.from("zodex_missing_orders").select("*").eq("status", "pending").order("shipment_date", { ascending: false }).limit(500),
      supabase.from("zodex_sync_runs").select("*").order("started_at", { ascending: false }).limit(1),
    ]);
    setRows((missing as MissingRow[]) || []);
    setLastRun((runs?.[0] as RunRow) || null);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const runSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-zodex-deliveries", {
        body: { lookback_days: 14, max_pages: 5 },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "فشلت المزامنة");
      toast.success(`تمت المزامنة: ${data.delivered_matched} تسليم • ${data.missing_created} مفقود جديد`);
      load();
    } catch (e: any) {
      toast.error(`فشلت المزامنة: ${e.message || e}`);
    } finally {
      setSyncing(false);
    }
  };

  const doIgnore = async () => {
    if (!ignoreDialog) return;
    const { error } = await supabase.from("zodex_missing_orders")
      .update({ status: "ignored", ignored_reason: ignoreReason || null, resolved_at: new Date().toISOString() })
      .eq("id", ignoreDialog.id);
    if (error) return toast.error(error.message);
    toast.success("تم التجاهل");
    setIgnoreDialog(null);
    setIgnoreReason("");
    load();
  };

  const fetchCandidatesFor = async (row: MissingRow) => {
    setLoadingCands((s) => ({ ...s, [row.id]: true }));
    try {
      const phone = normPhone(row.customer_phone);
      const last9 = phone.slice(-9);
      // Find customers by phone patterns
      const orClauses: string[] = [];
      if (phone) {
        orClauses.push(`phone.ilike.%${last9}`);
        orClauses.push(`phone2.ilike.%${last9}`);
      }
      if (row.customer_name) {
        const nm = row.customer_name.trim().slice(0, 20).replace(/[%,]/g, " ");
        if (nm) orClauses.push(`name.ilike.%${nm}%`);
      }
      let customerIds: string[] = [];
      if (orClauses.length) {
        const { data: custs } = await supabase.from("customers").select("id").or(orClauses.join(",")).limit(50);
        customerIds = (custs || []).map((c: any) => c.id);
      }
      // Query orders: null bill AND (matching customer OR near amount within recent 90 days)
      let query = supabase.from("orders")
        .select("id, order_number, total, created_at, moderator, shipping_bill_no, status, customer:customers(name, phone, phone2)")
        .is("shipping_bill_no", null)
        .order("created_at", { ascending: false })
        .limit(80);

      if (customerIds.length) {
        query = query.in("customer_id", customerIds);
      } else {
        // fallback: match by amount ±5 in the last 60 days
        const cod = Number(row.cod_amount || 0);
        if (cod > 0) {
          query = query.gte("total", cod - 5).lte("total", cod + 5);
        } else {
          setCandidates((s) => ({ ...s, [row.id]: [] }));
          return;
        }
      }
      const { data: orders, error } = await query;
      if (error) throw error;

      const scored = (orders || [])
        .map((o: any) => scoreCandidate(row, o))
        .filter((c) => c.score >= 20)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      setCandidates((s) => ({ ...s, [row.id]: scored }));
    } catch (e: any) {
      toast.error(`تعذر جلب الاقتراحات: ${e.message || e}`);
      setCandidates((s) => ({ ...s, [row.id]: [] }));
    } finally {
      setLoadingCands((s) => ({ ...s, [row.id]: false }));
    }
  };

  const toggleExpand = async (row: MissingRow) => {
    const willOpen = !expanded[row.id];
    setExpanded((s) => ({ ...s, [row.id]: willOpen }));
    if (willOpen && !candidates[row.id]) {
      fetchCandidatesFor(row);
    }
  };

  const doLink = async () => {
    if (!linkDialog) return;
    setLinking(true);
    try {
      const { data, error } = await supabase.rpc("link_zodex_bill_to_order", {
        p_bill_no: linkDialog.row.bill_no,
        p_order_id: linkDialog.cand.id,
        p_missing_id: linkDialog.row.id,
        p_match_score: linkDialog.cand.score,
        p_match_reason: linkDialog.cand.reasons.join(" • "),
      });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) throw new Error(res.error || "فشل الربط");
      toast.success(`تم ربط البوليصة ${linkDialog.row.bill_no} بالأوردر ${linkDialog.cand.order_number}`);
      setLinkDialog(null);
      load();
    } catch (e: any) {
      toast.error(`فشل الربط: ${e.message || e}`);
    } finally {
      setLinking(false);
    }
  };

  const runManualSearch = async (row: MissingRow, term: string) => {
    setSearching(true);
    try {
      const t = term.trim();
      if (!t) { setSearchResults([]); return; }
      // Try direct order number match first
      let q = supabase.from("orders")
        .select("id, order_number, total, created_at, moderator, shipping_bill_no, status, customer:customers(name, phone, phone2)")
        .order("created_at", { ascending: false }).limit(30);

      const looksLikeOrder = /ord[-_]?\d/i.test(t) || /^\d{4,}$/.test(t);
      if (looksLikeOrder) {
        q = q.ilike("order_number", `%${t}%`);
      } else if (/^\d{6,}$/.test(t.replace(/\D+/g, ""))) {
        // phone
        const last9 = normPhone(t).slice(-9);
        const { data: custs } = await supabase.from("customers").select("id").or(`phone.ilike.%${last9},phone2.ilike.%${last9}`).limit(50);
        const ids = (custs || []).map((c: any) => c.id);
        if (!ids.length) { setSearchResults([]); return; }
        q = q.in("customer_id", ids);
      } else {
        // name or moderator
        const nm = t.slice(0, 30).replace(/[%,]/g, " ");
        const { data: custs } = await supabase.from("customers").select("id").ilike("name", `%${nm}%`).limit(50);
        const ids = (custs || []).map((c: any) => c.id);
        if (ids.length) {
          q = q.in("customer_id", ids);
        } else {
          q = q.ilike("moderator", `%${nm}%`);
        }
      }
      const { data: orders, error } = await q;
      if (error) throw error;
      const scored = (orders || []).map((o: any) => scoreCandidate(row, o));
      setSearchResults(scored);
    } catch (e: any) {
      toast.error(`فشل البحث: ${e.message || e}`);
    } finally {
      setSearching(false);
    }
  };

  const filtered = useMemo(() => {
    const t = filter.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      [r.bill_no, r.customer_name, r.customer_phone, r.moderator_name, r.region]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(t))
    );
  }, [rows, filter]);

  const scoreColor = (s: number) =>
    s >= 80 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      : s >= 60 ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
        : "bg-muted text-muted-foreground";

  return (
    <div className="container mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">البوالص غير المربوطة (زودكس)</h1>
          <p className="text-sm text-muted-foreground">
            بوالص زودكس ملهاش أوردر مربوط عندنا — اضغط على أي بوليصة لعرض الأوردرات المحتملة وربطها بضغطة واحدة.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRun && (
            <span className="text-xs text-muted-foreground">
              آخر مزامنة: {format(new Date(lastRun.started_at), "yyyy-MM-dd HH:mm")}
              {" • "}تسليم: {lastRun.delivered_matched} • مفقود: {lastRun.missing_created}
            </span>
          )}
          <Button size="sm" onClick={runSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <RefreshCw className="h-4 w-4 ml-1" />}
            مزامنة الآن
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">القائمة ({filtered.length})</CardTitle>
          <Input
            placeholder="فلترة سريعة: بوليصة / اسم / موبايل / موديريتور"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-sm"
          />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">جارِ التحميل...</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">🎉 مفيش بوالص مفقودة</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>رقم البوليصة</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>الموبايل</TableHead>
                  <TableHead>الموديريتور</TableHead>
                  <TableHead>المنطقة</TableHead>
                  <TableHead className="text-left">القيمة</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>تاريخ الشحن</TableHead>
                  <TableHead className="text-center">إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const isOpen = !!expanded[r.id];
                  const cands = candidates[r.id];
                  const loadingC = !!loadingCands[r.id];
                  return (
                    <>
                      <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => toggleExpand(r)}>
                        <TableCell className="px-2">
                          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          <a href={`https://zodex-eg.com/admin-area/shippings.php?action=details&waybill=${r.bill_no}`}
                             target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                             className="inline-flex items-center gap-1 text-primary hover:underline">
                            {r.bill_no}<ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                        <TableCell>{r.customer_name || "—"}</TableCell>
                        <TableCell className="font-mono">{r.customer_phone || "—"}</TableCell>
                        <TableCell>{r.moderator_name || "—"}</TableCell>
                        <TableCell>{r.region || "—"}</TableCell>
                        <TableCell className="text-left tabular-nums">{Number(r.cod_amount || 0).toLocaleString("ar-EG")}</TableCell>
                        <TableCell>
                          <Badge variant={r.operation_type === "مرتجعات" ? "destructive" : "secondary"}>
                            {r.operation_type || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {r.shipment_date ? format(new Date(r.shipment_date), "yyyy-MM-dd HH:mm") : "—"}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-center">
                            <Button size="sm" variant="ghost" className="h-7 gap-1"
                              onClick={() => { setSearchDialog(r); setSearchTerm(""); setSearchResults([]); }}
                              title="بحث يدوي">
                              <Search className="h-3.5 w-3.5" />بحث
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setIgnoreDialog(r)} title="تجاهل / تمت المراجعة">
                              <X className="h-3.5 w-3.5" />تجاهل
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow key={r.id + "-cands"}>
                          <TableCell colSpan={10} className="bg-muted/20 p-3">
                            {loadingC ? (
                              <div className="text-sm text-muted-foreground text-center py-3">
                                <Loader2 className="h-4 w-4 animate-spin inline ml-1" /> جارِ البحث عن أوردرات مطابقة...
                              </div>
                            ) : !cands || cands.length === 0 ? (
                              <div className="text-sm text-muted-foreground text-center py-3">
                                مفيش اقتراحات تلقائية — جرّب البحث اليدوي.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <div className="text-xs text-muted-foreground">أفضل الاقتراحات:</div>
                                {cands.map((c) => (
                                  <div key={c.id} className="flex items-center gap-3 rounded-lg border bg-background p-3 flex-wrap">
                                    <Badge variant="outline" className={scoreColor(c.score) + " font-mono"}>
                                      {c.score}%
                                    </Badge>
                                    <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-sm">
                                      <div><span className="text-muted-foreground">رقم الأوردر:</span> <span className="font-mono">{c.order_number}</span></div>
                                      <div><span className="text-muted-foreground">العميل:</span> {c.customer_name || "—"}</div>
                                      <div><span className="text-muted-foreground">موبايل:</span> <span className="font-mono">{c.customer_phone || "—"}{c.customer_phone2 ? ` / ${c.customer_phone2}` : ""}</span></div>
                                      <div><span className="text-muted-foreground">المبلغ:</span> <span className="tabular-nums">{Number(c.total || 0).toLocaleString("ar-EG")}</span></div>
                                      <div><span className="text-muted-foreground">الموديريتور:</span> {c.moderator || "—"}</div>
                                      <div><span className="text-muted-foreground">تاريخ الأوردر:</span> {format(new Date(c.created_at), "yyyy-MM-dd")}</div>
                                      <div className="col-span-2 md:col-span-4 text-xs text-muted-foreground">
                                        {c.reasons.join(" • ")}
                                      </div>
                                    </div>
                                    <Button size="sm" className="h-8 gap-1" onClick={() => setLinkDialog({ row: r, cand: c })}>
                                      <Link2 className="h-3.5 w-3.5" /> ربط
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Confirm link dialog */}
      <Dialog open={!!linkDialog} onOpenChange={(o) => !o && setLinkDialog(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تأكيد ربط البوليصة</DialogTitle>
            <DialogDescription>
              هل أنت متأكد من ربط بوليصة <span className="font-mono font-bold">{linkDialog?.row.bill_no}</span> بالأوردر <span className="font-mono font-bold">{linkDialog?.cand.order_number}</span>؟
            </DialogDescription>
          </DialogHeader>
          {linkDialog && (
            <div className="text-sm space-y-2 border rounded p-3 bg-muted/30">
              <div className="flex justify-between"><span className="text-muted-foreground">العميل بزودكس:</span><span>{linkDialog.row.customer_name || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">العميل عندنا:</span><span>{linkDialog.cand.customer_name || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">موبايل زودكس:</span><span className="font-mono">{linkDialog.row.customer_phone || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">موبايل عندنا:</span><span className="font-mono">{linkDialog.cand.customer_phone || "—"}{linkDialog.cand.customer_phone2 ? ` / ${linkDialog.cand.customer_phone2}` : ""}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">مبلغ زودكس:</span><span className="tabular-nums">{Number(linkDialog.row.cod_amount || 0).toLocaleString("ar-EG")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">مبلغ الأوردر:</span><span className="tabular-nums">{Number(linkDialog.cand.total || 0).toLocaleString("ar-EG")}</span></div>
              <div className="text-xs text-muted-foreground pt-1">درجة التطابق: {linkDialog.cand.score}% — {linkDialog.cand.reasons.join(" • ")}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialog(null)} disabled={linking}>إلغاء</Button>
            <Button onClick={doLink} disabled={linking}>
              {linking && <Loader2 className="h-4 w-4 animate-spin ml-1" />}
              تأكيد الربط
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual search dialog */}
      <Dialog open={!!searchDialog} onOpenChange={(o) => !o && setSearchDialog(null)}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>بحث يدوي عن أوردر</DialogTitle>
            <DialogDescription>
              بوليصة <span className="font-mono">{searchDialog?.bill_no}</span> — ابحث برقم أوردر / اسم / موبايل / موديريتور
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              placeholder="اكتب رقم الأوردر أو الاسم أو الموبايل..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && searchDialog) runManualSearch(searchDialog, searchTerm); }}
            />
            <Button onClick={() => searchDialog && runManualSearch(searchDialog, searchTerm)} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          <div className="max-h-[50vh] overflow-y-auto space-y-2">
            {searchResults.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">لا توجد نتائج بعد.</div>
            ) : searchResults.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border p-3 flex-wrap">
                <Badge variant="outline" className={scoreColor(c.score) + " font-mono"}>{c.score}%</Badge>
                <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-sm">
                  <div><span className="text-muted-foreground">أوردر:</span> <span className="font-mono">{c.order_number}</span></div>
                  <div><span className="text-muted-foreground">العميل:</span> {c.customer_name || "—"}</div>
                  <div><span className="text-muted-foreground">موبايل:</span> <span className="font-mono">{c.customer_phone || "—"}</span></div>
                  <div><span className="text-muted-foreground">المبلغ:</span> <span className="tabular-nums">{Number(c.total || 0).toLocaleString("ar-EG")}</span></div>
                  <div><span className="text-muted-foreground">الموديريتور:</span> {c.moderator || "—"}</div>
                  <div><span className="text-muted-foreground">التاريخ:</span> {format(new Date(c.created_at), "yyyy-MM-dd")}</div>
                  {c.shipping_bill_no && (
                    <div className="col-span-2 md:col-span-3 text-xs text-destructive">⚠️ عليها بوليصة بالفعل: {c.shipping_bill_no}</div>
                  )}
                </div>
                <Button size="sm" disabled={!!c.shipping_bill_no}
                  onClick={() => { if (searchDialog) { setLinkDialog({ row: searchDialog, cand: c }); setSearchDialog(null); } }}
                >
                  <Link2 className="h-3.5 w-3.5 ml-1" /> ربط
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSearchDialog(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ignore dialog */}
      <Dialog open={!!ignoreDialog} onOpenChange={(o) => !o && setIgnoreDialog(null)}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تجاهل البوليصة</DialogTitle></DialogHeader>
          <p className="text-sm">بوليصة {ignoreDialog?.bill_no}</p>
          <Textarea placeholder="السبب (اختياري)" value={ignoreReason} onChange={(e) => setIgnoreReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoreDialog(null)}>إلغاء</Button>
            <Button onClick={doIgnore}>تأكيد التجاهل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
