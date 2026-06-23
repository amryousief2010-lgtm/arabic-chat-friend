import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Wallet, TrendingUp, TrendingDown, ArrowLeftRight, Activity, Clock,
  Plus, Printer, FileSpreadsheet, Trash2, Search, Filter, RefreshCw,
} from "lucide-react";

type Txn = {
  id: string; txn_no: string; txn_date: string;
  direction: "in" | "out"; kind: string; amount: number;
  party: string | null; note: string | null;
  created_at: string;
  created_by?: string | null;
  created_by_name?: string | null;
  ref_table?: string | null;
  ref_id?: string | null;
  status?: string | null;
  cancellation_reason?: string | null;
};

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

const KIND_LABEL: Record<string, string> = {
  sale: "بيع علف", purchase: "شراء خامات",
  loan_from_naam: "سلفة من شركة نعام", loan_to_naam: "إقراض شركة نعام",
  manual_in: "إيداع يدوي", manual_out: "سحب يدوي",
  opening_balance: "رصيد افتتاحي", other: "أخرى",
  custody_shoala: "عهدة كاش شعله",
  custody_gamal: "عهدة كاش أحمد الجمل",
  general_expense: "مصروفات عامة",
  tobacco_expense: "مصروف دخان",
  transport_expense: "مصروف نقل",
};

export default function FeedFactoryTreasuryPanel({
  txns, balance, canManageAll, canTreasury,
  onNew, onDelete, onPrint, onExport, onRefresh,
}: {
  txns: Txn[]; balance: number;
  canManageAll: boolean; canTreasury: boolean;
  onNew: () => void; onDelete: (t: Txn) => void;
  onPrint: () => void; onExport: () => void;
  onRefresh?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [kind, setKind] = useState<string>("all");
  const [party, setParty] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const kindOptions = useMemo(() => {
    const s = new Set<string>();
    txns.forEach((t) => s.add(t.kind));
    return Array.from(s);
  }, [txns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const p = party.trim().toLowerCase();
    const fromTs = fromDate ? new Date(fromDate).getTime() : null;
    const toTs = toDate ? new Date(toDate + "T23:59:59").getTime() : null;
    return txns.filter((t) => {
      if (direction !== "all" && t.direction !== direction) return false;
      if (kind !== "all" && t.kind !== kind) return false;
      if (p && !(t.party || "").toLowerCase().includes(p)) return false;
      if (q) {
        const hay = `${t.txn_no} ${t.note || ""} ${KIND_LABEL[t.kind] || t.kind} ${t.party || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const ts = new Date(t.txn_date).getTime();
      if (fromTs && ts < fromTs) return false;
      if (toTs && ts > toTs) return false;
      return true;
    });
  }, [txns, direction, kind, party, search, fromDate, toDate]);

  const summary = useMemo(() => {
    let inSum = 0, outSum = 0, inCount = 0, outCount = 0;
    filtered.forEach((t) => {
      const a = Number(t.amount || 0);
      if (t.direction === "in") { inSum += a; inCount++; }
      else { outSum += a; outCount++; }
    });
    return { inSum, outSum, inCount, outCount, net: inSum - outSum, count: filtered.length };
  }, [filtered]);

  const totals = useMemo(() => {
    let inSum = 0, outSum = 0;
    txns.forEach((t) => {
      if (t.status === "cancelled") return;
      const a = Number(t.amount || 0);
      if (t.direction === "in") inSum += a; else outSum += a;
    });
    return { inSum, outSum };
  }, [txns]);

  const lastTxn = txns[0];

  const resetFilters = () => {
    setSearch(""); setDirection("all"); setKind("all");
    setParty(""); setFromDate(""); setToDate("");
  };

  // Compute running balance ASC, then map by id for the displayed rows (cancelled rows do not affect balance)
  const runningBalance = useMemo(() => {
    const asc = [...txns].sort((a, b) => {
      const d = +new Date(a.txn_date) - +new Date(b.txn_date);
      if (d !== 0) return d;
      return +new Date(a.created_at) - +new Date(b.created_at);
    });
    const map: Record<string, number> = {};
    let bal = 0;
    asc.forEach((t) => {
      if (t.status !== "cancelled") {
        bal += t.direction === "in" ? Number(t.amount || 0) : -Number(t.amount || 0);
      }
      map[t.id] = bal;
    });
    return map;
  }, [txns]);

  return (
    <div dir="rtl" className="space-y-4">
      {/* Header */}
      <Card className="overflow-hidden border-success/30">
        <div className="bg-gradient-to-l from-success/10 via-success/5 to-transparent p-5 flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-success/15 flex items-center justify-center">
              <Wallet className="h-6 w-6 text-success" />
            </div>
            <div>
              <h2 className="text-xl font-bold">خزنة مصنع الأعلاف</h2>
              <p className="text-xs text-muted-foreground">
                الرصيد الحالي
              </p>
              <p className={`text-3xl font-extrabold tabular-nums mt-0.5 ${balance < 0 ? "text-destructive" : "text-success"}`}>
                {fmt(balance)} <span className="text-lg">ج.م</span>
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {onRefresh && (
              <Button size="sm" variant="outline" onClick={onRefresh}>
                <RefreshCw className="h-4 w-4 ml-1" />تحديث
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onPrint}>
              <Printer className="h-4 w-4 ml-1" />طباعة
            </Button>
            <Button size="sm" variant="outline" onClick={onExport}>
              <FileSpreadsheet className="h-4 w-4 ml-1" />Excel
            </Button>
            {canTreasury && (
              <Button size="sm" onClick={onNew} className="bg-success hover:bg-success/90">
                <Plus className="h-4 w-4 ml-1" />حركة جديدة
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi color="success" icon={<TrendingUp className="h-4 w-4" />}
             label="إجمالي الوارد" value={`${fmt(totals.inSum)} ج.م`} />
        <Kpi color="destructive" icon={<TrendingDown className="h-4 w-4" />}
             label="إجمالي المنصرف" value={`${fmt(totals.outSum)} ج.م`} />
        <Kpi color={(totals.inSum - totals.outSum) < 0 ? "destructive" : "primary"}
             icon={<ArrowLeftRight className="h-4 w-4" />}
             label="صافي الحركة" value={`${fmt(totals.inSum - totals.outSum)} ج.م`} />
        <Kpi color="primary" icon={<Wallet className="h-4 w-4" />}
             label="الرصيد الحالي" value={`${fmt(balance)} ج.م`} />
        <Kpi color="muted" icon={<Activity className="h-4 w-4" />}
             label="عدد الحركات" value={txns.length.toLocaleString("ar-EG")} />
        <Kpi color="muted" icon={<Clock className="h-4 w-4" />}
             label="آخر حركة"
             value={lastTxn ? lastTxn.txn_date : "—"}
             sub={lastTxn ? (KIND_LABEL[lastTxn.kind] || lastTxn.kind) : undefined} />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="h-4 w-4" />الفلاتر
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2">
            <Label className="text-xs">بحث (الرقم/البيان/الجهة)</Label>
            <div className="relative">
              <Search className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pr-8" value={search} onChange={(e) => setSearch(e.target.value)}
                     placeholder="ابحث..." />
            </div>
          </div>
          <div>
            <Label className="text-xs">النوع</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="in">وارد</SelectItem>
                <SelectItem value="out">منصرف</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">التصنيف</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {kindOptions.map((k) => (
                  <SelectItem key={k} value={k}>{KIND_LABEL[k] || k}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">الجهة</Label>
            <Input value={party} onChange={(e) => setParty(e.target.value)} placeholder="اسم الجهة" />
          </div>
          <div>
            <Label className="text-xs">من تاريخ</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">إلى تاريخ</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button variant="outline" size="sm" onClick={resetFilters} className="w-full">
              إعادة الضبط
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filter summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {direction === "all" ? (
          <>
            <SumCard label="عدد الحركات (حسب الفلتر)" value={summary.count.toLocaleString("ar-EG")} />
            <SumCard label="إجمالي الوارد" value={`${fmt(summary.inSum)} ج.م`} color="success"
                     sub={`${summary.inCount.toLocaleString("ar-EG")} حركة`} />
            <SumCard label="إجمالي المنصرف" value={`${fmt(summary.outSum)} ج.م`} color="destructive"
                     sub={`${summary.outCount.toLocaleString("ar-EG")} حركة`} />
            <SumCard label="الصافي" value={`${fmt(summary.net)} ج.م`}
                     color={summary.net < 0 ? "destructive" : "primary"} />
          </>
        ) : direction === "in" ? (
          <>
            <SumCard label="عدد حركات الوارد" value={summary.inCount.toLocaleString("ar-EG")} color="success" />
            <SumCard label="إجمالي الوارد (حسب الفلتر)" value={`${fmt(summary.inSum)} ج.م`} color="success" />
            <SumCard label="متوسط الحركة"
                     value={summary.inCount ? `${fmt(summary.inSum / summary.inCount)} ج.م` : "—"} />
            <SumCard label="أعلى حركة"
                     value={filtered.length ? `${fmt(Math.max(...filtered.map(t => Number(t.amount || 0))))} ج.م` : "—"} />
          </>
        ) : (
          <>
            <SumCard label="عدد حركات المنصرف" value={summary.outCount.toLocaleString("ar-EG")} color="destructive" />
            <SumCard label="إجمالي المنصرف (حسب الفلتر)" value={`${fmt(summary.outSum)} ج.م`} color="destructive" />
            <SumCard label="متوسط الحركة"
                     value={summary.outCount ? `${fmt(summary.outSum / summary.outCount)} ج.م` : "—"} />
            <SumCard label="أعلى حركة"
                     value={filtered.length ? `${fmt(Math.max(...filtered.map(t => Number(t.amount || 0))))} ج.م` : "—"} />
          </>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">سجل الحركات ({filtered.length})</CardTitle>
          <CardDescription className="hidden md:block text-xs">
            البيع يضيف للخزنة والشراء يخصم منها تلقائيًا
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الرقم</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>التصنيف</TableHead>
                <TableHead>الجهة</TableHead>
                <TableHead>البيان</TableHead>
                <TableHead>بواسطة</TableHead>
                <TableHead className="text-success">وارد</TableHead>
                <TableHead className="text-destructive">منصرف</TableHead>
                <TableHead>الرصيد بعد</TableHead>
                {canManageAll && <TableHead className="w-16">حذف</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => {
                const after = runningBalance[t.id] ?? 0;
                const isCancelled = t.status === "cancelled";
                return (
                  <TableRow key={t.id} className={`hover:bg-muted/40 ${isCancelled ? "opacity-60 line-through" : ""}`}>
                    <TableCell className="font-mono text-xs">
                      {t.txn_no}
                      {isCancelled && (
                        <Badge variant="destructive" className="ml-1 text-[10px] no-underline">ملغاة</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{t.txn_date}</TableCell>
                    <TableCell>
                      {t.direction === "in" ? (
                        <Badge className="bg-success/15 text-success border border-success/30 hover:bg-success/20">
                          <TrendingUp className="h-3 w-3 ml-1" />وارد
                        </Badge>
                      ) : (
                        <Badge className="bg-destructive/15 text-destructive border border-destructive/30 hover:bg-destructive/20">
                          <TrendingDown className="h-3 w-3 ml-1" />منصرف
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {KIND_LABEL[t.kind] || t.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{t.party || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate" title={(t.note || "") + (t.cancellation_reason ? ` | سبب الإلغاء: ${t.cancellation_reason}` : "")}>
                      {t.note || "—"}
                      {isCancelled && t.cancellation_reason && (
                        <div className="text-[10px] text-destructive no-underline">سبب الإلغاء: {t.cancellation_reason}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap" title={t.created_at ? new Date(t.created_at).toLocaleString("ar-EG") : ""}>
                      {t.created_by_name ? (
                        <div className="flex flex-col">
                          <span className="font-medium">{t.created_by_name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {t.ref_table === "feed_raw_purchases" ? "تلقائي من فاتورة شراء"
                              : t.ref_table === "feed_sales" ? "تلقائي من فاتورة بيع"
                              : t.ref_table ? "تلقائي" : "إدخال يدوي"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-success font-bold tabular-nums">
                      {t.direction === "in" ? fmt(t.amount) : "—"}
                    </TableCell>
                    <TableCell className="text-destructive font-bold tabular-nums">
                      {t.direction === "out" ? fmt(t.amount) : "—"}
                    </TableCell>
                    <TableCell className={`tabular-nums font-semibold ${after < 0 ? "text-destructive" : "text-foreground"}`}>
                      {fmt(after)}
                    </TableCell>
                    {canManageAll && (
                      <TableCell>
                        {!isCancelled && t.kind !== "sale" && t.kind !== "purchase" && (
                          <Button size="icon" variant="ghost" className="text-destructive"
                                  onClick={() => onDelete(t)} title="إلغاء الحركة وإرجاع المبلغ للخزنة">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {!filtered.length && (
                <TableRow>
                  <TableCell colSpan={canManageAll ? 11 : 10} className="text-center text-muted-foreground py-10">
                    لا توجد حركات مطابقة للفلاتر الحالية
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon, label, value, sub, color = "primary" }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  color?: "primary" | "success" | "destructive" | "muted";
}) {
  const cls =
    color === "success" ? "border-success/30 bg-success/5 text-success" :
    color === "destructive" ? "border-destructive/30 bg-destructive/5 text-destructive" :
    color === "muted" ? "border-border bg-muted/30 text-foreground" :
    "border-primary/30 bg-primary/5 text-primary";
  return (
    <Card className={`border ${cls}`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-xs opacity-80">{icon}<span>{label}</span></div>
        <div className="text-lg md:text-xl font-bold tabular-nums mt-1">{value}</div>
        {sub && <div className="text-[10px] opacity-70 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function SumCard({ label, value, sub, color = "muted" }: {
  label: string; value: string; sub?: string;
  color?: "primary" | "success" | "destructive" | "muted";
}) {
  const cls =
    color === "success" ? "text-success" :
    color === "destructive" ? "text-destructive" :
    color === "primary" ? "text-primary" :
    "text-foreground";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold tabular-nums mt-1 ${cls}`}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
